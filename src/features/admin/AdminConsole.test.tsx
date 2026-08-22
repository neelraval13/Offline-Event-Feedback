import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DatabaseStatus } from '../../lib/storage'
import type { SyncActivity, SyncCredential, SyncOutcome } from '../../lib/sync'
import type { OfflineShell, OfflineShellState } from '../../lib/pwa/offlineShell'

/*
 * The V2 Device Admin console, end to end.
 *
 * The suites beside this one own their own subjects: readiness and the update
 * lifecycle, backup cryptography and the restore flows, the device identity.
 * This one owns the console as a whole: the operational overview, the states
 * central sync can be in, and the rule the screen is built around, which is
 * that offline readiness and local-storage health are separate facts that must
 * never be derived from each other.
 *
 * Two seams are controlled rather than provoked. A store that refuses to open
 * and a server that refuses a token cannot be produced honestly in jsdom, and
 * breaking the real local database to manufacture one would be a worse test
 * than a stubbed status. Everything else runs against the real modules.
 */

/* ------------------------------------------------------------------------- *
 * Controlled seams
 * ------------------------------------------------------------------------- */

/** The identity the enrolment server hands back. Never rendered. */
const DEVICE_ID = '11111111-2222-3333-4444-555555555555'

/** Set to a message to make local storage report itself unusable. */
let databaseFailure: string | null = null

let syncConfigured = true
let secureEndpoint = true
let credential: SyncCredential | null = null
let syncOutcome: SyncOutcome = {
  attempted: 0,
  synced: 0,
  failed: 0,
  batches: 0,
  enrolled: true,
}
let syncActivity: SyncActivity | null = null
let enrollment: Awaited<ReturnType<typeof import('../../lib/sync').enrollDevice>> =
  {
    ok: true,
    value: {
      eventId: 'flying-flea-2026',
      deviceId: DEVICE_ID,
      deviceToken: 'a-token',
    },
  }

const enrollSpy = vi.fn<(request: { enrollmentSecret: string }) => void>()
const storeCredentialSpy = vi.fn<(credential: SyncCredential) => void>()
/** Resolves the in-flight sync, so the busy state can be observed. */
let releaseSync: (() => void) | null = null

vi.mock('../../lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/storage')>()
  return {
    ...actual,
    getDatabaseStatus: async (database: Parameters<typeof actual.getDatabaseStatus>[0]) => {
      if (databaseFailure === null) {
        return actual.getDatabaseStatus(database)
      }
      const failed: DatabaseStatus = {
        name: 'offline-event-feedback',
        expectedVersion: 1,
        openVersion: null,
        state: 'unavailable',
        message: databaseFailure,
      }
      return failed
    },
    /*
     * A store that will not open answers nothing, so the counts fail with it.
     * Stubbing only the status would produce a device that reports itself
     * unusable and then cheerfully counts its records.
     */
    getLocalCounts: async (database: Parameters<typeof actual.getLocalCounts>[0]) => {
      if (databaseFailure !== null) {
        throw new Error(databaseFailure)
      }
      return actual.getLocalCounts(database)
    },
  }
})

vi.mock('../../lib/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/sync')>()
  return {
    ...actual,
    isSyncConfigured: () => syncConfigured,
    isSecureEndpoint: () => secureEndpoint,
    readSyncCredential: async () => {
      if (databaseFailure !== null) {
        throw new Error(databaseFailure)
      }
      return credential
    },
    readSyncActivity: async () => syncActivity,
    runSync: async () => {
      if (releaseSync !== null) {
        await new Promise<void>((resolve) => {
          releaseSync = resolve
        })
      }
      return syncOutcome
    },
    enrollDevice: async (request: { enrollmentSecret: string }) => {
      enrollSpy(request)
      return enrollment
    },
    storeSyncCredential: async (next: SyncCredential) => {
      storeCredentialSpy(next)
      credential = next
    },
  }
})

const { AdminScreen } = await import('./AdminScreen')
const { ROUTES } = await import('../../app/routes')
const { db } = await import('../../lib/storage')
const { setOfflineShell } = await import('../../lib/pwa/shellInstance')
const { makeRegistration } = await import('../../lib/backup/testFixtures')

/* ------------------------------------------------------------------------- *
 * Harness
 * ------------------------------------------------------------------------- */

/** A shell in a fixed state. The snapshot is by reference, as the real one is. */
function fakeShell(state: Partial<OfflineShellState> = {}): OfflineShell {
  const snapshot: OfflineShellState = {
    readiness: 'ready',
    updateAvailable: false,
    errorMessage: null,
    applyingUpdate: false,
    ...state,
  }
  return {
    getState: () => snapshot,
    subscribe: () => () => {},
    applyUpdate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }
}

beforeEach(async () => {
  await db.open()
  await Promise.all([
    db.registrations.clear(),
    db.feedback.clear(),
    db.sequences.clear(),
    db.deviceConfig.clear(),
  ])

  databaseFailure = null
  syncConfigured = true
  secureEndpoint = true
  credential = null
  syncActivity = null
  syncOutcome = { attempted: 0, synced: 0, failed: 0, batches: 0, enrolled: true }
  enrollment = {
    ok: true,
    value: {
      eventId: 'flying-flea-2026',
      deviceId: DEVICE_ID,
      deviceToken: 'a-token',
    },
  }
  releaseSync = null
  enrollSpy.mockClear()
  storeCredentialSpy.mockClear()
  setOfflineShell(fakeShell())
})

afterEach(() => {
  cleanup()
  setOfflineShell(null)
})

/** Renders the console and waits for its first reads to land. */
async function openConsole() {
  render(<AdminScreen />)
  const user = userEvent.setup()
  // Every fact starts as "Checking"; waiting for the storage read to land is
  // what separates "not known yet" from the answer under test.
  await waitFor(() =>
    expect(screen.getByTestId('overview-storage').textContent).not.toContain(
      'Checking',
    ),
  )
  return user
}

/** Waits for one overview cell to settle on a value. */
async function factSettles(name: string, value: string) {
  await waitFor(() => expect(fact(name).textContent).toContain(value))
}

/** The overview cell for one fact, by its label. */
function fact(name: string) {
  return screen.getByTestId(`overview-${name}`)
}

/** Adds pending records, and one that the server has refused. */
async function seed({ pending = 0, errored = 0 } = {}) {
  const records = Array.from({ length: pending + errored }, (_, i) =>
    makeRegistration(i + 1),
  )
  await db.registrations.bulkAdd(
    records.map((record, index) =>
      index < pending
        ? record
        : { ...record, syncStatus: 'error' as const },
    ),
  )
}

/* ------------------------------------------------------------------------- *
 * A, B. The surface the console asks for
 * ------------------------------------------------------------------------- */

describe('the shell Device Admin asks for', () => {
  it('keeps full chrome, unlike the two stations', () => {
    /*
     * The opposite decision from Point A and Point B. Those are one-task
     * surfaces where a row of links is a mis-tap away from losing work; this
     * is the screen somebody navigates around, usually while on the phone to
     * whoever is running the event.
     */
    const admin = ROUTES.find((route) => route.path === '/admin')

    expect(admin?.chrome ?? 'full').toBe('full')
    expect(admin?.showInNav).toBe(true)
  })

  it('uses the wide workspace', async () => {
    await openConsole()

    // Five facts across a row, and readiness beside sync, need the 88rem
    // measure; the station width would stack all of it.
    const surface = document.querySelector('.max-w-wide')
    expect(surface).not.toBeNull()
  })
})

/* ------------------------------------------------------------------------- *
 * C, D, E, F. The overview, and the independence rule
 * ------------------------------------------------------------------------- */

describe('the operational overview', () => {
  it('renders five independent facts and invents no master verdict', async () => {
    await seed({ pending: 2 })
    await openConsole()

    expect(fact('readiness').textContent).toContain('Ready for offline use')
    await factSettles('sync', 'Not enrolled')
    expect(fact('storage').textContent).toContain('Healthy')
    await waitFor(() => expect(fact('pending').textContent).toContain('2'))
    expect(fact('errors').textContent).toContain('0')

    /*
     * There is no truthful definition of a single "device healthy" boolean,
     * and a green tick averaging five different facts would be the most
     * dangerous thing on the page: it would read as fine on a device that is
     * perfectly prepared and cannot write a record.
     */
    for (const verdict of [
      'Event ready',
      'Device healthy',
      'All good',
      'All systems',
    ]) {
      expect(document.body.textContent).not.toContain(verdict)
    }
  })

  it('keeps readiness and storage health independent', async () => {
    /*
     * The rule the console is built around. These come from different systems
     * (the service worker's precache, and whether IndexedDB opens), and each
     * of the four combinations has to render its own two answers.
     */
    const cases = [
      { readiness: 'ready' as const, failure: null, expect: 'Ready for offline use' },
      { readiness: 'ready' as const, failure: 'Quota exceeded', expect: 'Ready for offline use' },
      { readiness: 'preparing' as const, failure: null, expect: 'Preparing' },
      { readiness: 'preparing' as const, failure: 'Quota exceeded', expect: 'Preparing' },
    ]

    for (const scenario of cases) {
      databaseFailure = scenario.failure
      setOfflineShell(fakeShell({ readiness: scenario.readiness }))
      await openConsole()

      expect(fact('readiness').textContent).toContain(scenario.expect)
      expect(fact('storage').textContent).toContain(
        scenario.failure === null ? 'Healthy' : 'Cannot write',
      )
      // The one answer a broken store must never produce.
      expect(fact('readiness').textContent).not.toContain('Unknown')

      cleanup()
    }
  })

  it('says Unknown only when readiness itself is unknowable', async () => {
    // A browser with no service worker at all: nothing has an opinion about
    // whether this device is prepared, so the console does not pretend to.
    setOfflineShell(fakeShell({ readiness: 'unsupported' }))
    await openConsole()

    expect(fact('readiness').textContent).toContain('Unknown')
    expect(fact('storage').textContent).toContain('Healthy')
  })

  it('stays ready and refuses to take records when the store fails', async () => {
    databaseFailure = 'IndexedDB is unavailable in this browser'
    setOfflineShell(fakeShell({ readiness: 'ready' }))
    await openConsole()

    const alert = (
      await screen.findByText(/must not take registrations or feedback/)
    ).closest('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain('IndexedDB is unavailable')
    // The reason the alert exists at all: nowhere to put what is collected.
    expect(alert?.textContent).toContain('would be lost')
    // And it says so without contradicting the readiness fact beside it.
    expect(alert?.textContent).toContain('separate from offline readiness')
    expect(fact('readiness').textContent).toContain('Ready for offline use')
  })

  it('stops promising counts that are never coming', async () => {
    /*
     * A store that refused to open will not answer later either. "Counting…"
     * is a promise that a number is on its way, and leaving it up tells an
     * operator to keep waiting instead of to stop taking registrations.
     */
    databaseFailure = 'Site data is blocked in this browser'
    await openConsole()

    await waitFor(() =>
      expect(fact('pending').textContent).toContain('Unavailable'),
    )
    expect(fact('errors').textContent).toContain('Unavailable')
    expect(fact('sync').textContent).toContain('Unavailable')

    for (const cell of ['pending', 'errors', 'sync']) {
      expect(fact(cell).textContent).not.toContain('Counting')
      expect(fact(cell).textContent).not.toContain('Checking')
    }

    // And the same in the sections below, which read from the same store.
    expect(document.body.textContent).not.toContain('Counting…')
    expect(document.body.textContent).not.toContain('Checking…')
  })

  it('renders no blocking alert when the store is fine', async () => {
    await openConsole()

    expect(screen.queryByText(/must not take registrations or feedback/)).toBeNull()
  })
})

/* ------------------------------------------------------------------------- *
 * J to P. Central sync, one state at a time
 * ------------------------------------------------------------------------- */

describe('central sync', () => {
  it('reports an enrolled device that has nothing waiting', async () => {
    credential = { eventId: 'flying-flea-2026', token: 'a-token' }
    syncActivity = {
      lastAttemptAt: '2026-08-20T09:00:00.000Z',
      lastSuccessAt: '2026-08-20T09:00:00.000Z',
      lastError: null,
    }
    await openConsole()

    await waitFor(() =>
      expect(screen.getByTestId('sync-status').textContent).toBe('Enrolled'),
    )
    await factSettles('sync', 'Enrolled')
    expect(screen.getByTestId('sync-last-success').textContent).not.toBe('Never')
    // Idle again after the opportunistic attempt that runs on open.
    expect(await screen.findByRole('button', { name: 'Sync now' })).toBeDefined()
  })

  it('offers enrolment when the device has no credential', async () => {
    await openConsole()

    await waitFor(() =>
      expect(screen.getByTestId('sync-status').textContent).toBe('Not enrolled'),
    )
    await factSettles('sync', 'Not enrolled')
    // Not an error state: the device collects normally without a credential.
    expect(screen.getByText(/keeps collecting normally/)).toBeDefined()
    expect(screen.getByLabelText(/^Enrollment code/)).toBeDefined()
  })

  it('says nothing is configured when this build has no server', async () => {
    syncConfigured = false
    await openConsole()

    expect(screen.getByTestId('sync-status').textContent).toBe('Not configured')
    expect(fact('sync').textContent).toContain('Not configured')
    expect(screen.getByText(/encrypted backup is the only copy/)).toBeDefined()
  })

  it('clears the enrollment code after a successful attempt', async () => {
    const user = await openConsole()
    await waitFor(() =>
      expect(screen.getByTestId('sync-status').textContent).toBe('Not enrolled'),
    )

    await user.type(screen.getByLabelText(/^Enrollment code/), 'one-time-secret')
    await user.click(screen.getByRole('button', { name: 'Enroll device' }))

    await screen.findByText(/enrolled for central sync/)
    expect(enrollSpy).toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentSecret: 'one-time-secret' }),
    )
    // The code is a one-time secret: it is never persisted, and it does not
    // survive the attempt in component state either.
    expect(screen.queryByDisplayValue('one-time-secret')).toBeNull()
    expect(document.body.textContent).not.toContain('one-time-secret')
  })

  it('clears the enrollment code after a rejected attempt', async () => {
    enrollment = { ok: false, failure: 'unauthorized' }
    const user = await openConsole()
    await waitFor(() =>
      expect(screen.getByTestId('sync-status').textContent).toBe('Not enrolled'),
    )

    await user.type(screen.getByLabelText(/^Enrollment code/), 'wrong-secret')
    await user.click(screen.getByRole('button', { name: 'Enroll device' }))

    await screen.findByText(/Check the enrollment code/)
    expect(screen.getByLabelText(/^Enrollment code/)).toHaveProperty('value', '')
    expect(document.body.textContent).not.toContain('wrong-secret')
  })

  it('never displays the device token it was issued', async () => {
    const user = await openConsole()
    await waitFor(() =>
      expect(screen.getByTestId('sync-status').textContent).toBe('Not enrolled'),
    )

    await user.type(screen.getByLabelText(/^Enrollment code/), 'one-time-secret')
    await user.click(screen.getByRole('button', { name: 'Enroll device' }))

    await screen.findByText(/enrolled for central sync/)
    expect(storeCredentialSpy).toHaveBeenCalledWith({
      eventId: 'flying-flea-2026',
      token: 'a-token',
    })
    expect(document.body.textContent).not.toContain('a-token')
  })

  it('keeps pending-safe language when the server cannot be reached', async () => {
    credential = { eventId: 'flying-flea-2026', token: 'a-token' }
    syncOutcome = {
      attempted: 3,
      synced: 0,
      failed: 0,
      batches: 0,
      transportFailure: 'unreachable',
      enrolled: true,
    }
    await seed({ pending: 3 })
    const user = await openConsole()

    await user.click(await screen.findByRole('button', { name: 'Sync now' }))

    const message = await screen.findByTestId('sync-message')
    /*
     * A transport failure is not data loss, and must never be worded as one.
     * The records are exactly where they were; nothing was sent, so nothing
     * was dropped.
     */
    expect(message.textContent).toContain('local records are safe')
    expect(message.textContent).toContain('remain pending')
    expect(message.textContent).not.toMatch(/lost|deleted|failed to save/i)

    const alert = message.closest('[role="alert"]')
    expect(alert?.textContent).toContain('Central server could not be reached')
    // Amber, not red: a venue's wifi dropping is not a device fault.
    await factSettles('sync', 'Server unreachable')
  })

  it('distinguishes a lost authorisation from an unreachable server', async () => {
    credential = { eventId: 'flying-flea-2026', token: 'a-token' }
    syncOutcome = {
      attempted: 1,
      synced: 0,
      failed: 0,
      batches: 0,
      transportFailure: 'unauthorized',
      enrolled: true,
    }
    await seed({ pending: 1 })
    const user = await openConsole()

    await user.click(await screen.findByRole('button', { name: 'Sync now' }))

    const message = await screen.findByTestId('sync-message')
    expect(message.textContent).toContain('no longer authorised')
    expect(message.closest('[role="alert"]')?.textContent).toContain(
      'This device needs enrolling again',
    )
    // This one is genuinely the device's problem, so it is not the same
    // amber as a venue with no signal.
    await factSettles('sync', 'Re-enrolment needed')
  })

  it('shows a syncing state while a run is in flight', async () => {
    credential = { eventId: 'flying-flea-2026', token: 'a-token' }
    releaseSync = () => {}
    await seed({ pending: 2 })
    const user = await openConsole()

    await user.click(await screen.findByRole('button', { name: 'Syncing…' }))
    await waitFor(() => expect(fact('sync').textContent).toContain('Syncing'))

    releaseSync?.()
  })

  it('reports records the server refused, distinctly from a transport problem', async () => {
    credential = { eventId: 'flying-flea-2026', token: 'a-token' }
    syncOutcome = { attempted: 2, synced: 1, failed: 1, batches: 1, enrolled: true }
    await seed({ pending: 1, errored: 1 })
    const user = await openConsole()

    await user.click(await screen.findByRole('button', { name: 'Sync now' }))

    const refused = await screen.findByTestId('sync-failed-count')
    expect(refused.textContent).toContain('could not be accepted')
    // A refused record is a real error and counts as one; an unreachable
    // server does not.
    await waitFor(() =>
      expect(screen.getByTestId('sync-errors').textContent).toBe('1'),
    )
    expect(fact('errors').textContent).toContain('1')
  })

  it('warns when the configured sync address is not secure', async () => {
    secureEndpoint = false
    credential = { eventId: 'flying-flea-2026', token: 'a-token' }
    await openConsole()

    expect(
      await screen.findByText(/must only be sent over https/),
    ).toBeDefined()
  })
})

/* ------------------------------------------------------------------------- *
 * O, Q. Local data
 * ------------------------------------------------------------------------- */

describe('local data', () => {
  it('highlights records that exist only on this device', async () => {
    await seed({ pending: 3 })
    await openConsole()

    await waitFor(() =>
      expect(screen.getByTestId('count-registrations-pending').textContent).toBe('3'),
    )
    expect(fact('pending').textContent).toContain('3')
    // A pending record lives on exactly one machine, which is the whole
    // reason the number is worth looking at.
    expect(screen.getByText(/exist only on this device/)).toBeDefined()
  })

  it('says so plainly when nothing is waiting', async () => {
    await openConsole()

    await waitFor(() =>
      expect(screen.getByTestId('count-registrations-pending').textContent).toBe('0'),
    )
    expect(screen.getByText(/has reached the central database/)).toBeDefined()
  })
})

/* ------------------------------------------------------------------------- *
 * R, S, T, AD. The backup sheets
 * ------------------------------------------------------------------------- */

describe('the backup sheets', () => {
  const openers = [
    { name: 'Create encrypted backup', title: 'Create encrypted backup' },
    { name: 'Verify backup file', title: 'Verify backup file' },
    { name: 'Restore backup', title: 'Restore backup' },
  ]

  for (const opener of openers) {
    it(`opens ${opener.name} in a sheet rather than inline`, async () => {
      const user = await openConsole()

      expect(screen.queryByRole('dialog')).toBeNull()
      await user.click(screen.getByRole('button', { name: opener.name }))

      const sheet = await screen.findByRole('dialog')
      expect(
        within(sheet).getByRole('heading', { name: opener.title }),
      ).toBeDefined()
    })
  }

  it('cannot be dismissed in a way that implies a running operation was cancelled', async () => {
    /*
     * `createEncryptedBackup` has no cancellation: it derives a key and
     * encrypts, and there is nothing to abort. So while it runs, the sheet
     * refuses the two gestures that would look like cancelling (escape, and
     * a click on the scrim) rather than closing and leaving the operator to
     * believe they stopped something that is still going.
     */
    const user = await openConsole()
    await user.click(
      screen.getByRole('button', { name: 'Create encrypted backup' }),
    )

    const sheet = await screen.findByRole('dialog')
    await user.type(
      screen.getByLabelText(/^Backup passphrase/),
      'a passphrase of sufficient length',
    )
    await user.type(
      screen.getByLabelText(/^Confirm passphrase/),
      'a passphrase of sufficient length',
    )
    await user.click(
      within(sheet).getByRole('button', { name: 'Create encrypted backup' }),
    )

    // Mid-operation: the close control is disabled and escape does nothing.
    await waitFor(() =>
      expect(
        within(sheet).getByRole('button', { name: 'Creating…' }),
      ).toHaveProperty('disabled', true),
    )
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeDefined()

    await screen.findByTestId('backup-message', undefined, { timeout: 10_000 })
  }, 20_000)

  it('can be dismissed once the operation has finished', async () => {
    const user = await openConsole()
    await user.click(screen.getByRole('button', { name: 'Verify backup file' }))
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

/* ------------------------------------------------------------------------- *
 * AE. Device details
 * ------------------------------------------------------------------------- */

describe('device details', () => {
  it('carries identifiers and no participant details', async () => {
    await seed({ pending: 2 })
    const user = await openConsole()

    await user.click(screen.getByRole('button', { name: /^Device details/ }))

    const deviceId = await screen.findByText(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(deviceId).toBeDefined()
    for (const secret of ['Ada', 'Lovelace', '7946', 'example.com']) {
      expect(document.body.textContent).not.toContain(secret)
    }
  })

  it('stays collapsed until asked for', async () => {
    // The support identifiers are useless to the person holding the tablet,
    // and in V1 the device UUID outranked the readiness line on the screen.
    await openConsole()

    expect(
      screen.queryByText(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      ),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: /^Device details/ }),
    ).toHaveProperty('ariaExpanded', 'false')
  })
})
