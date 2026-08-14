import { useCallback, useSyncExternalStore } from 'react'
import type { OfflineShellState } from './offlineShell'
import { getOfflineShell, NO_SHELL_STATE } from './shellInstance'

/**
 * Subscribes to offline-shell state.
 *
 * Returns a neutral, honest state when no shell has been registered: a dev
 * build, or a browser without service workers. It never claims readiness it
 * cannot substantiate.
 */
export function useOfflineShellState(): OfflineShellState {
  const subscribe = useCallback((listener: () => void) => {
    const shell = getOfflineShell()
    return shell === null ? () => {} : shell.subscribe(listener)
  }, [])

  const getSnapshot = useCallback(
    () => getOfflineShell()?.getState() ?? NO_SHELL_STATE,
    [],
  )

  return useSyncExternalStore(subscribe, getSnapshot, () => NO_SHELL_STATE)
}

/** Applies a waiting update. Reloads the page: operator action only. */
export function applyPendingUpdate(): Promise<void> {
  return getOfflineShell()?.applyUpdate() ?? Promise.resolve()
}
