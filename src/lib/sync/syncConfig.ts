/*
 * Where the central server lives.
 *
 * A public location, injected at build time. It is not a secret and must never
 * be used to carry one: server credentials belong on the server, and anything
 * in a `VITE_` variable ships inside a bundle that anyone can read.
 *
 * When unset, synchronisation is cleanly unconfigured rather than broken. Point
 * A and Point B never consult this, so an unconfigured build behaves exactly as
 * every previous phase did.
 *
 * Three shapes are supported, and the first is what production uses:
 *
 *   /api                        same-origin; the app and the API are one
 *                               deployment, and the browser resolves this
 *                               against `window.location.origin`
 *   https://api.example.com     a deliberately separate, encrypted host
 *   http://localhost:8788       local development, where the split-origin
 *                               setup is the whole point
 */

const RAW_BASE_URL = import.meta.env['VITE_SYNC_API_BASE_URL']

export const SYNC_API_BASE_URL: string | null =
  typeof RAW_BASE_URL === 'string' && RAW_BASE_URL.trim().length > 0
    ? // A trailing slash would produce `/api//v1/...`, which some routers treat
      // as a different path entirely.
      RAW_BASE_URL.trim().replace(/\/+$/, '')
    : null

export function isSyncConfigured(): boolean {
  return SYNC_API_BASE_URL !== null
}

/**
 * Whether a configured base is a same-origin path rather than an absolute URL.
 *
 * `/api` carries no scheme and no host, so it inherits both from the page. That
 * is what makes it safe by construction: a page served over HTTPS cannot reach a
 * same-origin path over anything else.
 */
export function isSameOriginBase(url: string | null = SYNC_API_BASE_URL): boolean {
  return url !== null && url.startsWith('/') && !url.startsWith('//')
}

/**
 * Whether the configured endpoint is safe for real participant data.
 *
 * Registrations carry names, phone numbers and email addresses, so anything
 * remote must be HTTPS. Three cases pass, for three different reasons:
 *
 *   - a same-origin path, because it inherits the page's own scheme
 *   - an `https:` URL, because it is encrypted
 *   - `localhost` / `127.0.0.1`, because the browser already treats them as
 *     secure contexts and they are the documented development setup
 *
 * Plain HTTP to any other host fails, and that has not been relaxed: a protocol
 * downgrade on a venue's Wi-Fi is exactly the case this exists to catch.
 */
export function isSecureEndpoint(url: string | null = SYNC_API_BASE_URL): boolean {
  if (url === null) {
    return false
  }

  if (isSameOriginBase(url)) {
    return true
  }

  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1'
    )
  } catch {
    // Not a path and not a URL: not something to send participant data to.
    return false
  }
}

/** How long a single batch may take before it is abandoned and retried later. */
export const SYNC_REQUEST_TIMEOUT_MS = 25_000
