import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Where this build sends participant data, and whether that is safe.
 *
 * The value is read at module scope from `import.meta.env`, so each case stubs
 * the environment and re-imports. That is deliberate: it is exactly how the real
 * build behaves: the endpoint is baked in at build time and cannot change while
 * the app is running.
 */

type SyncConfig = typeof import('./syncConfig')

async function configuredWith(value: string | undefined): Promise<SyncConfig> {
  if (value === undefined) {
    vi.stubEnv('VITE_SYNC_API_BASE_URL', '')
  } else {
    vi.stubEnv('VITE_SYNC_API_BASE_URL', value)
  }
  vi.resetModules()
  return import('./syncConfig')
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('a same-origin path', () => {
  it('is configured, safe, and kept as a path', async () => {
    /*
     * What a Vercel deployment uses. The browser resolves it against
     * `window.location.origin`, so an app served over HTTPS reaches its API over
     * HTTPS with nothing to configure and nothing to get wrong.
     */
    const config = await configuredWith('/api')

    expect(config.SYNC_API_BASE_URL).toBe('/api')
    expect(config.isSyncConfigured()).toBe(true)
    expect(config.isSameOriginBase()).toBe(true)
    expect(config.isSecureEndpoint()).toBe(true)
  })

  it('strips a trailing slash so paths do not double up', async () => {
    // `/api/` + `/v1/...` would be `/api//v1/...`, which some routers treat as
    // a different path entirely.
    const config = await configuredWith('/api/')

    expect(config.SYNC_API_BASE_URL).toBe('/api')
  })

  it('does not mistake a protocol-relative URL for a path', async () => {
    // `//evil.example` is a URL that inherits only the scheme, not the host.
    const config = await configuredWith('//evil.example')

    expect(config.isSameOriginBase()).toBe(false)
  })
})

describe('an absolute URL', () => {
  it('accepts https', async () => {
    const config = await configuredWith('https://api.example.com')

    expect(config.isSyncConfigured()).toBe(true)
    expect(config.isSecureEndpoint()).toBe(true)
    expect(config.isSameOriginBase()).toBe(false)
  })

  it('accepts localhost over http, for development', async () => {
    const config = await configuredWith('http://localhost:8788')

    expect(config.isSecureEndpoint()).toBe(true)
  })

  it('accepts 127.0.0.1 over http, for development', async () => {
    const config = await configuredWith('http://127.0.0.1:8788')

    expect(config.isSecureEndpoint()).toBe(true)
  })

  it('rejects plain http to a remote host', async () => {
    // The protection this exists for: registrations carry names, phone numbers
    // and email addresses, and a venue's Wi-Fi is not a place to send them in
    // clear text.
    const config = await configuredWith('http://example.com')

    expect(config.isSyncConfigured()).toBe(true)
    expect(config.isSecureEndpoint()).toBe(false)
  })

  it('rejects something that is neither a path nor a URL', async () => {
    const config = await configuredWith('not a url')

    expect(config.isSecureEndpoint()).toBe(false)
  })
})

describe('when nothing is configured', () => {
  it('is cleanly unconfigured rather than broken', async () => {
    const config = await configuredWith(undefined)

    expect(config.SYNC_API_BASE_URL).toBeNull()
    expect(config.isSyncConfigured()).toBe(false)
    expect(config.isSecureEndpoint()).toBe(false)
  })

  it('treats whitespace as unconfigured', async () => {
    const config = await configuredWith('   ')

    expect(config.isSyncConfigured()).toBe(false)
  })
})
