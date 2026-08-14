import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The reporting transport, examined for the things that would leak PII:
 * a search term in a URL, a credential in a URL, a cached response, a cookie.
 *
 * The base URL is stubbed and the module imported fresh, so the suite does not
 * depend on whichever server a developer happens to have in their `.env`.
 */

const BASE = 'https://central.example/api'
const SECRET = 'a'.repeat(64)

type Client = typeof import('./reportingClient')

let client: Client
let fetchMock: ReturnType<typeof vi.fn>

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(async () => {
  vi.stubEnv('VITE_SYNC_API_BASE_URL', BASE)
  vi.resetModules()
  client = await import('./reportingClient')

  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function lastRequest(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1)
  return { url: String(call?.[0]), init: (call?.[1] ?? {}) as RequestInit }
}

describe('configuration', () => {
  it('derives the reporting base from the configured sync server', () => {
    // Same process, same location, but a different credential entirely.
    expect(client.REPORTING_API_BASE_URL).toBe(`${BASE}/v1/reporting`)
    expect(client.isReportingConfigured()).toBe(true)
  })

  it('derives a same-origin base without doubling the prefix', async () => {
    /*
     * Production: the app and the API are one deployment behind `/api`. The
     * mistake this guards against is `/api/api/v1/reporting`, which 404s in a
     * way that looks like the reporting API is missing entirely.
     */
    vi.stubEnv('VITE_SYNC_API_BASE_URL', '/api')
    vi.resetModules()
    const sameOrigin = await import('./reportingClient')

    expect(sameOrigin.REPORTING_API_BASE_URL).toBe('/api/v1/reporting')
    expect(sameOrigin.REPORTING_API_BASE_URL).not.toContain('/api/api')
    expect(sameOrigin.isReportingConfigured()).toBe(true)
  })

  it('requests same-origin paths, and puts no credential in them', async () => {
    vi.stubEnv('VITE_SYNC_API_BASE_URL', '/api')
    vi.resetModules()
    const sameOrigin = await import('./reportingClient')

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ runs: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await sameOrigin.fetchRuns(SECRET, 'evt-dev-001')

    const url = String(fetchSpy.mock.calls.at(-1)?.[0])
    // Relative, so the browser resolves it against the page's own origin.
    expect(url.startsWith('/api/v1/reporting/runs')).toBe(true)
    expect(url).not.toContain('//')
    expect(url).not.toContain(SECRET)
  })

  it('keeps an absolute base absolute', async () => {
    vi.stubEnv('VITE_SYNC_API_BASE_URL', 'http://localhost:8788')
    vi.resetModules()
    const local = await import('./reportingClient')

    expect(local.REPORTING_API_BASE_URL).toBe(
      'http://localhost:8788/v1/reporting',
    )
    expect(local.REPORTING_API_BASE_URL).not.toContain('/api')
  })
})

describe('requests', () => {
  it('sends a search term in the body, never in the URL', async () => {
    fetchMock.mockResolvedValue(ok({ rows: [], nextCursor: null, pageSize: 50 }))

    await client.queryRegistrations(SECRET, {
      eventId: 'evt-dev-001',
      search: '+919876543210',
    })

    const { url, init } = lastRequest()
    expect(init.method).toBe('POST')
    expect(url).not.toContain('9876543210')
    expect(url).not.toContain('search')
    expect(String(init.body)).toContain('+919876543210')
  })

  it('never puts the credential in the URL', async () => {
    fetchMock.mockResolvedValue(ok({ runId: 'r', completedAt: null, counts: {} }))

    await client.requestReconciliation(SECRET, 'evt-dev-001')

    const { url, init } = lastRequest()
    expect(url).not.toContain(SECRET)
    expect(new Headers(init.headers as HeadersInit).get('Authorization')).toBe(
      `Bearer ${SECRET}`,
    )
  })

  it('asks the browser not to cache, and sends no cookies', async () => {
    fetchMock.mockResolvedValue(ok({ rows: [], nextCursor: null, pageSize: 50 }))

    await client.queryRegistrations(SECRET, { eventId: 'evt-dev-001' })

    const { init } = lastRequest()
    expect(init.cache).toBe('no-store')
    expect(init.credentials).toBe('omit')
    expect(init.referrerPolicy).toBe('no-referrer')
  })

  it('classifies a rejected credential separately from a disabled server', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    expect(await client.queryRegistrations(SECRET, { eventId: 'e' })).toEqual({
      ok: false,
      failure: 'unauthorized',
    })

    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }))
    expect(await client.queryRegistrations(SECRET, { eventId: 'e' })).toEqual({
      ok: false,
      failure: 'reporting_disabled',
    })
  })

  it('distinguishes "never reconciled" from "no such record"', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'no_completed_run' }), { status: 404 }),
    )
    expect(await client.queryRegistrations(SECRET, { eventId: 'e' })).toEqual({
      ok: false,
      failure: 'no_run',
    })

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }),
    )
    expect(await client.queryRegistrations(SECRET, { eventId: 'e' })).toEqual({
      ok: false,
      failure: 'not_found',
    })
  })

  it('reports a lost connection rather than throwing', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    expect(await client.queryRegistrations(SECRET, { eventId: 'e' })).toEqual({
      ok: false,
      failure: 'unreachable',
    })
  })
})

describe('downloadExport', () => {
  it('takes the filename from the server and keeps the secret out of the URL', async () => {
    fetchMock.mockResolvedValue(
      new Response('a,b\r\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition':
            'attachment; filename="evt-dev-001-registrations-2026-02-01.csv"',
        },
      }),
    )

    const result = await client.downloadExport(
      SECRET,
      'evt-dev-001',
      'registrations.csv',
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.fileName).toBe('evt-dev-001-registrations-2026-02-01.csv')
    }
    expect(lastRequest().url).not.toContain(SECRET)
  })
})

describe('when no central server is configured', () => {
  it('fails cleanly rather than guessing a URL', async () => {
    vi.stubEnv('VITE_SYNC_API_BASE_URL', '')
    vi.resetModules()
    const unconfigured = await import('./reportingClient')

    expect(unconfigured.isReportingConfigured()).toBe(false)
    expect(await unconfigured.queryRegistrations(SECRET, { eventId: 'e' })).toEqual({
      ok: false,
      failure: 'not_configured',
    })
  })
})
