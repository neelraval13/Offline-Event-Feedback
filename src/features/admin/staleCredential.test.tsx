import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EVENT_CONFIG } from '../../config/event'
import { db, createRegistration } from '../../lib/storage'
import { storeSyncCredential } from '../../lib/sync/syncCredentials'
import { testContext } from '../../test/db'

/*
 * A device that still holds the previous event's sync credential.
 *
 * Credentials are event-bound, and the server enforces it twice: `authenticate`
 * resolves a token against the event named in the batch, and `ingestRecord`
 * refuses any record whose own event differs from the batch's, with
 * `wrongEvent`. A tablet that ran the August event and is opened on the
 * September build therefore holds something that cannot upload anything.
 *
 * Reporting that as "Enrolled" was the dangerous part. It is the single word
 * that tells an operator to stop worrying, and behind it the panel's
 * opportunistic sync would fire on every visit against an event the token does
 * not cover.
 *
 * The tests below pin the three things that have to be true: the status is not
 * "Enrolled", nothing is attempted automatically, and re-enrolling is guarded
 * rather than offered blindly while records from the old event are still
 * undelivered.
 */

const PREVIOUS_EVENT = 'ff-rc-2026-08-23'

const runSync = vi.fn()

vi.mock('../../lib/sync', async () => {
  const actual = await vi.importActual<typeof import('../../lib/sync')>(
    '../../lib/sync',
  )
  return {
    ...actual,
    // Configured, so the panel renders its real body rather than the
    // "not configured in this build" note.
    isSyncConfigured: () => true,
    isSecureEndpoint: () => true,
    runSync: (...args: unknown[]) => runSync(...args),
    enrollDevice: vi.fn(),
  }
})

// Imported after the mock so the panel picks it up.
const { SyncPanel } = await import('./SyncPanel')

beforeEach(async () => {
  runSync.mockReset()
  runSync.mockResolvedValue({
    attempted: 0,
    synced: 0,
    failed: 0,
    batches: 0,
    enrolled: true,
  })

  await db.open()
  await Promise.all([
    db.registrations.clear(),
    db.feedback.clear(),
    db.deviceConfig.clear(),
  ])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function seedPendingRegistration() {
  await createRegistration(db, {
    ...testContext(),
    name: 'Ada Lovelace',
    phone: '9876543210',
    email: 'ada@example.com',
  })
}

describe('a credential belonging to a different event', () => {
  it('is never reported as Enrolled', async () => {
    await storeSyncCredential({ eventId: PREVIOUS_EVENT, token: 'old-token' }, db)
    render(<SyncPanel />)

    const status = await screen.findByTestId('sync-status')
    await waitFor(() =>
      expect(status.textContent).toBe('Enrolled for a different event'),
    )
    expect(status.textContent).not.toBe('Enrolled')
  })

  it('explains that nothing can be uploaded with it', async () => {
    await storeSyncCredential({ eventId: PREVIOUS_EVENT, token: 'old-token' }, db)
    render(<SyncPanel />)

    const notice = await screen.findByTestId('sync-event-mismatch')
    expect(notice.textContent).toContain(EVENT_CONFIG.eventId)
    expect(notice.textContent).toContain('different event')
  })

  it('attempts no sync of its own accord', async () => {
    /*
     * The panel syncs opportunistically on open and when connectivity returns.
     * With a stale credential every one of those is a guaranteed rejection
     * against an event the token does not cover, and the only visible result
     * would be a red banner on a screen where nothing is yet wrong.
     */
    await storeSyncCredential({ eventId: PREVIOUS_EVENT, token: 'old-token' }, db)
    render(<SyncPanel />)

    await screen.findByTestId('sync-event-mismatch')
    // Given a moment for the opportunistic attempt that must not happen.
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(runSync).not.toHaveBeenCalled()
  })

  it('offers no Sync now button', async () => {
    await storeSyncCredential({ eventId: PREVIOUS_EVENT, token: 'old-token' }, db)
    render(<SyncPanel />)

    await screen.findByTestId('sync-event-mismatch')
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull()
  })
})

describe('guarding re-enrolment while old records are undelivered', () => {
  it('states the count and withholds the form until it is acknowledged', async () => {
    /*
     * These records were captured for the previous event and carry its event
     * ID. This build cannot upload them at all: the server answers `wrongEvent`
     * and the client parks each one with a permanent error. They are not lost,
     * but the only ways out are the previous build or an encrypted backup, and
     * the operator has to know that before enrolling rather than after.
     */
    await seedPendingRegistration()
    await storeSyncCredential({ eventId: PREVIOUS_EVENT, token: 'old-token' }, db)
    render(<SyncPanel />)

    const warning = await screen.findByTestId('sync-stale-pending')
    expect(warning.textContent).toContain('1 record(s)')

    // The enrolment field is withheld until the operator ticks the box.
    expect(screen.queryByLabelText('Enrollment code')).toBeNull()

    await userEvent.setup().click(screen.getByTestId('sync-stale-acknowledge'))

    expect(await screen.findByLabelText('Enrollment code')).toBeDefined()
  })

  it('does not destroy the old credential on its own', async () => {
    // Nothing about visiting this screen may discard the one credential that
    // could still deliver those records from the previous build.
    await seedPendingRegistration()
    await storeSyncCredential({ eventId: PREVIOUS_EVENT, token: 'old-token' }, db)
    render(<SyncPanel />)

    await screen.findByTestId('sync-stale-pending')

    expect(await db.deviceConfig.get('syncDeviceToken')).toBeDefined()
    expect((await db.deviceConfig.get('syncEventId'))?.value).toBe(
      PREVIOUS_EVENT,
    )
  })

  it('lets a clean device enrol without ceremony', async () => {
    // Nothing pending and nothing in error: there is nothing to lose, so the
    // warning says so and the form is there.
    await storeSyncCredential({ eventId: PREVIOUS_EVENT, token: 'old-token' }, db)
    render(<SyncPanel />)

    const clean = await screen.findByTestId('sync-stale-clean')
    expect(clean.textContent).toContain('safe to enrol')
    expect(screen.getByLabelText('Enrollment code')).toBeDefined()
    expect(screen.queryByTestId('sync-stale-acknowledge')).toBeNull()
  })
})

describe('the ordinary cases still behave', () => {
  it('reports a device with no credential as Not enrolled', async () => {
    render(<SyncPanel />)

    const status = await screen.findByTestId('sync-status')
    await waitFor(() => expect(status.textContent).toBe('Not enrolled'))
    expect(screen.queryByTestId('sync-event-mismatch')).toBeNull()
    expect(screen.getByLabelText('Enrollment code')).toBeDefined()
  })

  it('reports a credential for this event as Enrolled, and syncs', async () => {
    await storeSyncCredential(
      { eventId: EVENT_CONFIG.eventId, token: 'current-token' },
      db,
    )
    render(<SyncPanel />)

    const status = await screen.findByTestId('sync-status')
    await waitFor(() => expect(status.textContent).toBe('Enrolled'))

    expect(screen.queryByTestId('sync-event-mismatch')).toBeNull()
    expect(await screen.findByRole('button', { name: 'Sync now' })).toBeDefined()
    // The opportunistic attempt is exactly the behaviour a stale credential
    // suppresses, so it is asserted here rather than merely assumed.
    await waitFor(() => expect(runSync).toHaveBeenCalled())
  })
})
