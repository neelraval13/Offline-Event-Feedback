import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { initOfflineShell } from './lib/pwa/browserShell'
/*
 * One stylesheet entry, which is also where the V1/V2 cascade order is
 * declared. Importing the two sheets separately from here is what let V1's
 * unlayered element selectors outrank the whole design system; see
 * `src/styles/app.css` for the full account.
 */
import './styles/app.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root container #root is missing from index.html')
}

/*
 * Register the service worker before rendering.
 *
 * Deliberately not awaited and deliberately not fatal: a device that cannot
 * cache the shell must still be able to take registrations today. Readiness is
 * reported on the Admin screen, where an operator can act on it before the
 * event rather than discovering it mid-shift.
 */
initOfflineShell()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
