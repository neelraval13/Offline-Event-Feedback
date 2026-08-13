/*
 * The offline application shell: registration, readiness, and updates.
 *
 * This module owns the whole service-worker lifecycle for the app. Nothing here
 * touches IndexedDB. Cache Storage holds application code; IndexedDB holds
 * participant records; installing, updating or resetting one must never disturb
 * the other, and keeping the two concerns in separate modules is the first line
 * of that defence.
 *
 * Nothing here logs anything about a participant. The only values that reach a
 * log or a URL are asset paths.
 */

/**
 * How ready this device is to run with no server reachable.
 *
 * `navigator.onLine` is deliberately absent from this model. It reports whether
 * a network interface thinks it has a link, which answers a different question
 * entirely — a device can be online and completely unprepared, or offline and
 * perfectly ready. Readiness means *the shell is cached*, and only the service
 * worker can say that.
 */
export type OfflineReadiness =
  /** No service worker available: a dev build, or an unsupported browser. */
  | 'unsupported'
  /** Registering, or precaching not yet confirmed complete. */
  | 'preparing'
  /** The shell is precached and a worker is controlling this page. */
  | 'ready'
  /** Registration or precaching failed. This device is not field-safe. */
  | 'failed'

export interface OfflineShellState {
  readonly readiness: OfflineReadiness
  /** A new version has downloaded and is waiting for an operator to apply it. */
  readonly updateAvailable: boolean
  /** Set when registration failed; wording is for staff, not developers. */
  readonly errorMessage: string | null
  /** True between pressing Apply update and the reload. */
  readonly applyingUpdate: boolean
}

/** The subset of `virtual:pwa-register` this module depends on. */
export interface RegisterSwOptions {
  onNeedRefresh?: () => void
  onOfflineReady?: () => void
  onRegisteredSW?: (
    swUrl: string,
    registration: ServiceWorkerRegistration | undefined,
  ) => void
  onRegisterError?: (error: unknown) => void
}

export type UpdateSw = (reloadPage?: boolean) => Promise<void>
export type RegisterSw = (options: RegisterSwOptions) => UpdateSw

export interface OfflineShellDependencies {
  readonly registerSw: RegisterSw
  /** Whether the browser exposes a service worker at all. */
  readonly isSupported: () => boolean
  /** Whether a worker is already controlling this page. */
  readonly hasController: () => boolean
  /** Subscribes to controller changes; returns an unsubscribe function. */
  readonly onControllerChange?: (listener: () => void) => () => void
}

const INITIAL: OfflineShellState = {
  readiness: 'preparing',
  updateAvailable: false,
  errorMessage: null,
  applyingUpdate: false,
}

export interface OfflineShell {
  getState(): OfflineShellState
  subscribe(listener: () => void): () => void
  /**
   * Applies a waiting update. Reloads the page, by design — which is why it is
   * only ever called from an explicit operator action on the Admin screen.
   */
  applyUpdate(): Promise<void>
}

/**
 * Wires up service-worker registration and exposes its state as a store.
 *
 * Dependencies are injected so the whole lifecycle is testable: jsdom has no
 * service worker, and pretending otherwise would test nothing.
 */
export function createOfflineShell(
  dependencies: OfflineShellDependencies,
): OfflineShell {
  let state: OfflineShellState = INITIAL
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const setState = (patch: Partial<OfflineShellState>) => {
    const next = { ...state, ...patch }
    if (
      next.readiness === state.readiness &&
      next.updateAvailable === state.updateAvailable &&
      next.errorMessage === state.errorMessage &&
      next.applyingUpdate === state.applyingUpdate
    ) {
      return
    }
    state = next
    emit()
  }

  if (!dependencies.isSupported()) {
    // A development build or a browser without service workers. Everything
    // still works — it simply cannot survive losing the server.
    state = { ...INITIAL, readiness: 'unsupported' }

    return {
      getState: () => state,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      applyUpdate: async () => {},
    }
  }

  let updateSw: UpdateSw | null = null

  /**
   * A worker already controlling this page means the shell is being served
   * from the cache right now — the strongest evidence of readiness there is,
   * and the only signal available on repeat visits, where `onOfflineReady`
   * fires once and never again.
   */
  const reconcileController = () => {
    if (state.readiness !== 'failed' && dependencies.hasController()) {
      setState({ readiness: 'ready' })
    }
  }

  updateSw = dependencies.registerSw({
    onOfflineReady: () => {
      // Workbox's signal that precaching completed. This is the authoritative
      // "the shell is on disk" event.
      setState({ readiness: 'ready', errorMessage: null })
    },
    onNeedRefresh: () => {
      // A new worker has installed and is waiting. Nothing reloads: the running
      // terminal keeps its form state and its half-finished participant.
      setState({ updateAvailable: true })
    },
    onRegisteredSW: () => {
      reconcileController()
    },
    onRegisterError: (error) => {
      setState({
        readiness: 'failed',
        errorMessage:
          error instanceof Error
            ? error.message
            : 'The offline application could not be prepared.',
      })
    },
  })

  dependencies.onControllerChange?.(reconcileController)
  reconcileController()

  return {
    getState: () => state,

    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    applyUpdate: async () => {
      if (!state.updateAvailable || updateSw === null) {
        return
      }
      setState({ applyingUpdate: true })
      // `true` tells the waiting worker to take over and reloads the page.
      await updateSw(true)
    },
  }
}

/** Staff-facing wording for a readiness state. */
export function describeReadiness(readiness: OfflineReadiness): string {
  switch (readiness) {
    case 'ready':
      return 'Ready for offline use'
    case 'preparing':
      return 'Preparing — keep this device online until it is ready'
    case 'failed':
      return 'Not ready — connect this device to the Internet before the event'
    case 'unsupported':
      return 'Not available in this browser or build'
  }
}
