import type { OfflineShell, OfflineShellState } from './offlineShell'

/*
 * The one offline shell for this page.
 *
 * A holder rather than a module that constructs it, so that importing this —
 * which the Admin screen does — never pulls in `virtual:pwa-register`. The
 * browser wiring lives in `browserShell.ts` and is imported only by the
 * application entry point, which keeps the service worker entirely out of the
 * test environment unless a test deliberately puts a fake here.
 */

let instance: OfflineShell | null = null

export function setOfflineShell(shell: OfflineShell | null): void {
  instance = shell
}

export function getOfflineShell(): OfflineShell | null {
  return instance
}

/** What the UI shows before, or without, a registered service worker. */
export const NO_SHELL_STATE: OfflineShellState = {
  readiness: 'unsupported',
  updateAvailable: false,
  errorMessage: null,
  applyingUpdate: false,
}
