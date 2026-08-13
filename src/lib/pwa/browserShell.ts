import { registerSW } from 'virtual:pwa-register'
import { createOfflineShell } from './offlineShell'
import { setOfflineShell } from './shellInstance'

/*
 * Browser wiring for the offline shell.
 *
 * Imported only by the application entry point. Everything else reaches the
 * shell through `shellInstance`, so no other module — and no test — pulls in
 * the generated `virtual:pwa-register` code.
 */

/** Registers the service worker and publishes the shell. Safe to call once. */
export function initOfflineShell(): void {
  setOfflineShell(
    createOfflineShell({
      registerSw: (options) => registerSW(options),

      isSupported: () =>
        typeof navigator !== 'undefined' && 'serviceWorker' in navigator,

      hasController: () =>
        typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator &&
        navigator.serviceWorker.controller !== null,

      onControllerChange: (listener) => {
        navigator.serviceWorker.addEventListener('controllerchange', listener)
        return () => {
          navigator.serviceWorker.removeEventListener(
            'controllerchange',
            listener,
          )
        }
      },
    }),
  )
}
