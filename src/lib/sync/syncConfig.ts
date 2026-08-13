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
 */

const RAW_BASE_URL = import.meta.env['VITE_SYNC_API_BASE_URL']

export const SYNC_API_BASE_URL: string | null =
  typeof RAW_BASE_URL === 'string' && RAW_BASE_URL.length > 0
    ? RAW_BASE_URL.replace(/\/+$/, '')
    : null

export function isSyncConfigured(): boolean {
  return SYNC_API_BASE_URL !== null
}

/**
 * Whether the configured endpoint is safe for real participant data.
 *
 * Registrations carry names, phone numbers and email addresses, so production
 * synchronisation must be HTTPS. `localhost` is exempt because the browser
 * already treats it as a secure context and it is the documented development
 * setup.
 */
export function isSecureEndpoint(url: string | null = SYNC_API_BASE_URL): boolean {
  if (url === null) {
    return false
  }

  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1'
    )
  } catch {
    return false
  }
}

/** How long a single batch may take before it is abandoned and retried later. */
export const SYNC_REQUEST_TIMEOUT_MS = 25_000
