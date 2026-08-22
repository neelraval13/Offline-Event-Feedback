import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminScreen } from './AdminScreen'
import { RegistrationScreen } from '../registration/RegistrationScreen'
import { FeedbackScreen } from '../feedback/FeedbackScreen'
import { FakeScanner } from '../feedback/testScanner'
import { setOfflineShell } from '../../lib/pwa/shellInstance'
import type {
  OfflineShell,
  OfflineShellState,
} from '../../lib/pwa/offlineShell'
import { db } from '../../lib/storage'

/**
 * A shell in a fixed state, standing in for a registered service worker.
 *
 * The snapshot is built once and returned by reference. `useSyncExternalStore`
 * compares snapshots with `Object.is`, so a fake that returned a fresh object
 * per call would spin forever: the same contract the real shell keeps.
 */
function fakeShell(state: Partial<OfflineShellState> = {}): OfflineShell & {
  applyUpdate: ReturnType<typeof vi.fn>
} {
  const applyUpdate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
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
    applyUpdate,
  }
}

beforeEach(async () => {
  await db.open()
  await Promise.all([db.registrations.clear(), db.feedback.clear()])
})

afterEach(() => {
  cleanup()
  setOfflineShell(null)
  vi.restoreAllMocks()
})

describe('offline readiness on Admin', () => {
  it('reports a prepared device in plain language', async () => {
    setOfflineShell(fakeShell({ readiness: 'ready' }))
    render(<AdminScreen />)

    expect(await screen.findByTestId('offline-readiness')).toHaveProperty(
      'textContent',
      'Ready for offline use',
    )
  })

  it('warns when the device is not prepared', async () => {
    setOfflineShell(fakeShell({ readiness: 'failed', errorMessage: 'no quota' }))
    render(<AdminScreen />)

    const readiness = await screen.findByTestId('offline-readiness')
    expect(readiness.textContent).toContain(
      'Connect this device to the Internet before the event',
    )
  })

  it('does not claim readiness while still preparing', async () => {
    setOfflineShell(fakeShell({ readiness: 'preparing' }))
    render(<AdminScreen />)

    const readiness = await screen.findByTestId('offline-readiness')
    expect(readiness.textContent).not.toContain('Ready for offline use')
    expect(readiness.textContent).toContain('Keep this device online')
  })

  it('is honest when there is no service worker at all', async () => {
    // A dev build. Everything works; it simply cannot survive losing the server.
    setOfflineShell(null)
    render(<AdminScreen />)

    const readiness = await screen.findByTestId('offline-readiness')
    expect(readiness.textContent).not.toContain('Ready for offline use')
  })

  it('uses no service-worker jargon anywhere', async () => {
    setOfflineShell(fakeShell({ readiness: 'ready', updateAvailable: true }))
    const { container } = render(<AdminScreen />)
    await screen.findByTestId('offline-readiness')

    for (const jargon of [
      'service worker',
      'Workbox',
      'precache',
      'Cache Storage',
      'sw.js',
      'skipWaiting',
    ]) {
      expect(container.textContent?.toLowerCase()).not.toContain(
        jargon.toLowerCase(),
      )
    }
  })
})

describe('application version on Admin', () => {
  it('shows a version an operator can compare between devices', async () => {
    setOfflineShell(fakeShell())
    render(<AdminScreen />)

    const version = await screen.findByTestId('app-version')
    // Injected at build time: package version, then an ISO build timestamp.
    expect(version.textContent).toMatch(
      /^\d+\.\d+\.\d+.*·.*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    )
  })

  it('needs no network to answer the question', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    setOfflineShell(fakeShell())
    render(<AdminScreen />)

    await screen.findByTestId('app-version')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('applying an update', () => {
  it('offers the update without applying it', async () => {
    const shell = fakeShell({ updateAvailable: true })
    setOfflineShell(shell)
    render(<AdminScreen />)

    expect(await screen.findByTestId('update-available')).toBeDefined()
    // Rendering the prompt must never be enough to trigger a reload.
    expect(shell.applyUpdate).not.toHaveBeenCalled()
  })

  it('applies only on an explicit operator action', async () => {
    const shell = fakeShell({ updateAvailable: true })
    setOfflineShell(shell)
    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Apply update' }))

    expect(shell.applyUpdate).toHaveBeenCalledTimes(1)
  })

  it('says the terminal is up to date when it is', async () => {
    setOfflineShell(fakeShell({ updateAvailable: false }))
    render(<AdminScreen />)

    expect(await screen.findByTestId('update-status')).toHaveProperty(
      'textContent',
      'Application update: up to date.',
    )
    expect(screen.queryByRole('button', { name: 'Apply update' })).toBeNull()
  })

  it('keeps the running version when applying fails', async () => {
    const shell = fakeShell({ updateAvailable: true })
    shell.applyUpdate.mockRejectedValue(new Error('worker gone'))
    setOfflineShell(shell)
    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Apply update' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('already on this device is unaffected')
    // Admin is still usable: a lifecycle error does not take the screen down.
    expect(screen.getByTestId('offline-readiness')).toBeDefined()
    expect(screen.getByTestId('app-version')).toBeDefined()
  })

  it('leaves local records untouched', async () => {
    // Cache Storage and IndexedDB are separate concerns; applying an update
    // must never reach into participant data.
    const { createRegistration } = await import('../../lib/storage')
    const { testContext } = await import('../../test/db')
    await createRegistration(db, {
      ...testContext(),
      name: 'Ada Lovelace',
      phone: '+44 20 7946 0958',
      email: 'ada@example.com',
    })

    const shell = fakeShell({ updateAvailable: true })
    setOfflineShell(shell)
    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Apply update' }))

    await waitFor(() => expect(shell.applyUpdate).toHaveBeenCalled())
    expect(await db.registrations.count()).toBe(1)
  })
})

describe('operational screens stay free of update prompts', () => {
  it('Point A shows nothing about updates or readiness', async () => {
    setOfflineShell(fakeShell({ readiness: 'ready', updateAvailable: true }))
    const { container } = render(<RegistrationScreen />)
    await screen.findByLabelText(/^Name/)

    expect(screen.queryByRole('button', { name: 'Apply update' })).toBeNull()
    for (const wording of ['update', 'Ready for offline use', 'version']) {
      expect(container.textContent?.toLowerCase()).not.toContain(
        wording.toLowerCase(),
      )
    }
  })

  it('Point B shows nothing about updates or readiness', async () => {
    setOfflineShell(fakeShell({ readiness: 'ready', updateAvailable: true }))
    const scanner = new FakeScanner()
    const { container } = render(
      <FeedbackScreen createScanner={() => scanner} />,
    )
    await screen.findByRole('button', { name: /^Scan QR/ })

    expect(screen.queryByRole('button', { name: 'Apply update' })).toBeNull()
    for (const wording of ['update', 'Ready for offline use', 'version']) {
      expect(container.textContent?.toLowerCase()).not.toContain(
        wording.toLowerCase(),
      )
    }
  })

  it('a broken PWA lifecycle does not stop Point A working', async () => {
    // If the shell throws on read, registration must still be possible.
    setOfflineShell({
      getState: () => {
        throw new Error('lifecycle exploded')
      },
      subscribe: () => () => {},
      applyUpdate: async () => {},
    })

    render(<RegistrationScreen />)

    expect(await screen.findByLabelText(/^Name/)).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Register & Print' }),
    ).toBeDefined()
  })
})
