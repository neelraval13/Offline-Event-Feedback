import { describe, expect, it, vi } from 'vitest'
import {
  createOfflineShell,
  describeReadiness,
  type OfflineShellDependencies,
  type RegisterSwOptions,
  type UpdateSw,
} from './offlineShell'

/*
 * jsdom has no service worker, and pretending otherwise would test nothing.
 * These tests drive the lifecycle callbacks the browser would fire, which is
 * where all the decisions actually live.
 */

interface Harness {
  readonly callbacks: RegisterSwOptions
  readonly updateSw: ReturnType<typeof vi.fn>
  controller: boolean
  fireControllerChange: () => void
}

function harness(
  overrides: Partial<OfflineShellDependencies> = {},
): { shell: ReturnType<typeof createOfflineShell>; io: Harness } {
  let captured: RegisterSwOptions = {}
  let controllerListener: (() => void) | null = null

  const io: Harness = {
    get callbacks() {
      return captured
    },
    updateSw: vi.fn<UpdateSw>().mockResolvedValue(undefined),
    controller: false,
    fireControllerChange: () => controllerListener?.(),
  }

  const shell = createOfflineShell({
    registerSw: (options) => {
      captured = options
      return io.updateSw as unknown as UpdateSw
    },
    isSupported: () => true,
    hasController: () => io.controller,
    onControllerChange: (listener) => {
      controllerListener = listener
      return () => {
        controllerListener = null
      }
    },
    ...overrides,
  })

  return { shell, io }
}

describe('offline readiness', () => {
  it('starts out preparing, not ready', () => {
    // A device must never claim readiness merely because registration began.
    const { shell } = harness()

    expect(shell.getState().readiness).toBe('preparing')
  })

  it('becomes ready once precaching completes', () => {
    const { shell, io } = harness()

    io.callbacks.onOfflineReady?.()

    expect(shell.getState().readiness).toBe('ready')
  })

  it('is ready on a repeat visit, where offline-ready never fires again', () => {
    // Workbox reports onOfflineReady once, on first install. On every later
    // load the only evidence is that a worker is controlling the page — which
    // means the shell is being served from cache right now.
    const { shell, io } = harness()
    io.controller = true

    io.callbacks.onRegisteredSW?.('./sw.js', undefined)

    expect(shell.getState().readiness).toBe('ready')
  })

  it('becomes ready when a worker takes control later', () => {
    const { shell, io } = harness()
    expect(shell.getState().readiness).toBe('preparing')

    io.controller = true
    io.fireControllerChange()

    expect(shell.getState().readiness).toBe('ready')
  })

  it('reports failure when registration fails', () => {
    const { shell, io } = harness()

    io.callbacks.onRegisterError?.(new Error('quota exceeded'))

    expect(shell.getState().readiness).toBe('failed')
    expect(shell.getState().errorMessage).toBe('quota exceeded')
  })

  it('does not silently recover from a failure', () => {
    const { shell, io } = harness()
    io.callbacks.onRegisterError?.(new Error('quota exceeded'))

    io.controller = true
    io.fireControllerChange()

    expect(shell.getState().readiness).toBe('failed')
  })

  it('reports unsupported when the browser has no service worker', () => {
    const registerSw = vi.fn()
    const shell = createOfflineShell({
      registerSw: registerSw as unknown as OfflineShellDependencies['registerSw'],
      isSupported: () => false,
      hasController: () => false,
    })

    expect(shell.getState().readiness).toBe('unsupported')
    // Nothing is registered, and nothing pretends to be ready.
    expect(registerSw).not.toHaveBeenCalled()
  })

  it('ignores connectivity entirely', () => {
    // `navigator.onLine` answers a different question: a device can be online
    // and unprepared, or offline and perfectly ready.
    const { shell, io } = harness()
    io.callbacks.onOfflineReady?.()

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    })

    expect(shell.getState().readiness).toBe('ready')
    Reflect.deleteProperty(navigator, 'onLine')
  })
})

describe('updates wait for an operator', () => {
  it('records an available update without applying it', () => {
    const { shell, io } = harness()
    io.callbacks.onOfflineReady?.()

    io.callbacks.onNeedRefresh?.()

    expect(shell.getState().updateAvailable).toBe(true)
    // The decisive assertion: nothing reloaded, nothing activated. A terminal
    // mid-registration keeps its form.
    expect(io.updateSw).not.toHaveBeenCalled()
  })

  it('keeps the current version running and ready', () => {
    const { shell, io } = harness()
    io.callbacks.onOfflineReady?.()
    io.callbacks.onNeedRefresh?.()

    expect(shell.getState().readiness).toBe('ready')
  })

  it('applies the update only when asked', async () => {
    const { shell, io } = harness()
    io.callbacks.onNeedRefresh?.()

    await shell.applyUpdate()

    expect(io.updateSw).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('does nothing when there is no update waiting', async () => {
    const { shell, io } = harness()

    await shell.applyUpdate()

    expect(io.updateSw).not.toHaveBeenCalled()
  })

  it('surfaces a failure to apply without losing the running version', async () => {
    const { shell, io } = harness()
    io.callbacks.onOfflineReady?.()
    io.callbacks.onNeedRefresh?.()
    io.updateSw.mockRejectedValue(new Error('worker gone'))

    await expect(shell.applyUpdate()).rejects.toThrow('worker gone')

    // Still ready, still on the version that was working.
    expect(shell.getState().readiness).toBe('ready')
    expect(shell.getState().updateAvailable).toBe(true)
  })
})

describe('subscriptions', () => {
  it('notifies subscribers when state changes', () => {
    const { shell, io } = harness()
    const listener = vi.fn()
    shell.subscribe(listener)

    io.callbacks.onOfflineReady?.()

    expect(listener).toHaveBeenCalled()
  })

  it('does not notify when nothing actually changed', () => {
    const { shell, io } = harness()
    io.callbacks.onOfflineReady?.()

    const listener = vi.fn()
    shell.subscribe(listener)
    io.callbacks.onOfflineReady?.()

    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe', () => {
    const { shell, io } = harness()
    const listener = vi.fn()
    const unsubscribe = shell.subscribe(listener)

    unsubscribe()
    io.callbacks.onOfflineReady?.()

    expect(listener).not.toHaveBeenCalled()
  })

  it('returns a stable snapshot object between changes', () => {
    // useSyncExternalStore re-renders on every new object identity.
    const { shell, io } = harness()
    io.callbacks.onOfflineReady?.()

    const first = shell.getState()
    io.callbacks.onOfflineReady?.()

    expect(shell.getState()).toBe(first)
  })
})

describe('describeReadiness', () => {
  it('speaks to staff, not developers', () => {
    expect(describeReadiness('ready')).toBe('Ready for offline use')
    expect(describeReadiness('failed')).toContain('connect this device')

    for (const readiness of [
      'ready',
      'preparing',
      'failed',
      'unsupported',
    ] as const) {
      const wording = describeReadiness(readiness)
      expect(wording).not.toMatch(
        /service worker|workbox|precache|cache storage|sw\.js/i,
      )
    }
  })
})
