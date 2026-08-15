import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { createApp } from '../app.js'
import { createMemoryStore, type MemoryStore } from './memoryStore.js'
import { batch, DEVICE_A, EVENT_ID, feedback, registration } from './fixtures.js'
import { SYNC_PROTOCOL_VERSION } from '../../shared/sync/protocol.js'
import type { Sql } from 'postgres'

/*
 * The API as it is mounted for Vercel, tested without deploying anything.
 *
 * The deployment serves the central app under `/api`, because that is where
 * Vercel routes a function, and the mount is the part most likely to be got
 * wrong in a way nothing local would notice: routes that answer on the developer
 * machine and 404 in production, or a double prefix that turns
 * `/api/v1/reporting` into `/api/api/v1/reporting`.
 *
 * This reproduces the mount over a memory store and asks whether the production
 * URLs answer. It never touches a real database and never starts a listener.
 *
 * What it deliberately does NOT prove is that Vercel routes those URLs to the
 * function at all. Every assertion here calls Hono directly, which is exactly
 * why a production `/api/v1/sync/enroll` could return the platform's own 404
 * while this file stayed green. That gap is covered by
 * `vercelRouting.test.ts` (the generated route table) and
 * `scripts/verify-vercel-build.mjs` (the generated function artifact).
 */

const ENROLLMENT_SECRET = 'vercel-mount-enrolment-secret'
const REPORTING_SECRET = randomBytes(32).toString('hex')

/*
 * A database handle that refuses to be used.
 *
 * Reporting is only mounted when the app is given one, so the mount test needs
 * something to pass, and a stub that throws proves the other half of what these
 * tests are for: an unauthenticated reporting request is refused before anything
 * reaches the database.
 */
const unusableSql = new Proxy({} as Sql, {
  get() {
    throw new Error('the database must not be reached in this test')
  },
  apply() {
    throw new Error('the database must not be reached in this test')
  },
})

let store: MemoryStore
let mounted: Hono

beforeEach(() => {
  store = createMemoryStore()

  const central = createApp({
    store,
    enrollmentSecret: ENROLLMENT_SECRET,
    // Production is same-origin, so nothing is allow-listed. This is the
    // configuration a Vercel deployment actually runs with.
    allowedOrigins: [],
    sql: unusableSql,
    reportingSecret: REPORTING_SECRET,
    log: () => {},
  })

  /*
   * The same URL shape the function serves. The function itself resolves the
   * prefix explicitly rather than mounting (see `api/index.ts`); this is the
   * simplest thing that produces the same public paths, and the real entry
   * point is exercised at the bottom of this file.
   */
  mounted = new Hono().route('/api', central)
})

async function enrolledToken(): Promise<string> {
  const response = await mounted.request('/api/v1/sync/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: EVENT_ID,
      deviceId: DEVICE_A,
      enrollmentSecret: ENROLLMENT_SECRET,
    }),
  })
  const body = (await response.json()) as { deviceToken: string }
  return body.deviceToken
}

describe('the production URL shape', () => {
  it('answers GET /api/health', async () => {
    const response = await mounted.request('/api/health')
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body['status']).toBe('ok')
    expect(body['protocolVersion']).toBe(SYNC_PROTOCOL_VERSION)
  })

  it('says nothing about the database beyond whether it answered', async () => {
    const withCheck = new Hono().route(
      '/api',
      createApp({
        store,
        enrollmentSecret: ENROLLMENT_SECRET,
        allowedOrigins: [],
        log: () => {},
        checkDatabase: async () => true,
      }),
    )

    const response = await withCheck.request('/api/health')
    const text = await response.text()

    expect(JSON.parse(text)).toEqual({
      status: 'ok',
      protocolVersion: SYNC_PROTOCOL_VERSION,
      database: true,
    })
    // No host, no database name, no connection string, no pool size.
    for (const leak of ['postgres://', 'neon', 'password', 'host', 'pool']) {
      expect(text.toLowerCase()).not.toContain(leak)
    }
  })

  it('answers POST /api/v1/sync/enroll', async () => {
    const response = await mounted.request('/api/v1/sync/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: EVENT_ID,
        deviceId: DEVICE_A,
        enrollmentSecret: ENROLLMENT_SECRET,
      }),
    })
    const body = (await response.json()) as { deviceToken?: string }

    expect(response.status).toBe(200)
    expect(typeof body.deviceToken).toBe('string')
  })

  it('answers POST /api/v1/sync/batch', async () => {
    const token = await enrolledToken()
    const records = [registration(), feedback()]

    const response = await mounted.request('/api/v1/sync/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(batch(records)),
    })
    const body = (await response.json()) as { results: { status: string }[] }

    expect(response.status).toBe(200)
    expect(body.results.map((result) => result.status)).toEqual([
      'accepted',
      'accepted',
    ])
    expect(store.registrations.size).toBe(1)
    expect(store.feedback.size).toBe(1)
  })

  it('refuses reporting without the credential, before touching the database', async () => {
    /*
     * The reporting router is reachable at the production path, a 404 here
     * would mean the mount had lost it, and it answers 401 without the database
     * handle being used at all, which the stub would otherwise throw on.
     */
    const response = await mounted.request(
      `/api/v1/reporting/overview?eventId=${EVENT_ID}`,
    )

    expect(response.status).toBe(401)
    // The no-store guarantee survives the mount.
    expect(response.headers.get('Cache-Control')).toBe('no-store, private')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})

describe('the mount does not double the prefix', () => {
  it('does not answer on /api/api/...', async () => {
    const response = await mounted.request('/api/api/health')

    expect(response.status).toBe(404)
  })

  it('does not answer the unprefixed routes', async () => {
    // Under the Vercel mount, `/health` belongs to the static site, not the API.
    expect((await mounted.request('/health')).status).toBe(404)
    expect((await mounted.request('/v1/sync/enroll')).status).toBe(404)
  })
})

describe('same-origin production, with nothing allow-listed', () => {
  it('serves a request that carries no Origin header', async () => {
    /*
     * A same-origin fetch sends no `Origin` on a simple GET, and never needs a
     * preflight. This is why production does not depend on generated Vercel
     * hostnames being added to `SYNC_ALLOWED_ORIGINS`; there is nothing
     * cross-origin about it.
     */
    const response = await mounted.request('/api/health')

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('never answers a foreign origin with a wildcard', async () => {
    const response = await mounted.request('/api/v1/sync/batch', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
      },
    })

    expect(response.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('still allows a configured local development origin', async () => {
    const local = new Hono().route(
      '/api',
      createApp({
        store: createMemoryStore(),
        enrollmentSecret: ENROLLMENT_SECRET,
        allowedOrigins: ['http://localhost:5173'],
        log: () => {},
      }),
    )

    const response = await local.request('/api/v1/sync/batch', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
      },
    })

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173',
    )
  })
})

describe('the function contract', () => {
  it('is a request handler, not a server', async () => {
    /*
     * A Vercel function is handed a Request and returns a Response. The whole
     * app is reachable through `fetch` alone: no port, no listener, nothing to
     * keep alive between invocations.
     */
    const response = await mounted.fetch(
      new Request('https://deployment.example/api/health'),
    )

    expect(response.status).toBe(200)
  })

  it('rejects an unknown API path rather than falling through', async () => {
    const response = await mounted.request(`/api/v1/nonsense/${randomUUID()}`)

    expect(response.status).toBe(404)
  })
})

/* ------------------------------------------------------------------ *
 * The real entry point
 *
 * Everything above builds the mount the way the function does. This exercises
 * the module Vercel will actually import, through the surface Vercel actually
 * uses: the default export's `fetch`.
 *
 * The database is deliberately unreachable (port 1, refused immediately) so
 * these prove routing and nothing else. Every assertion below is on a path that
 * answers before any query runs: an unauthenticated reporting request, a wrong
 * enrolment code, a malformed batch, and a health check whose database probe is
 * caught and reported as `false`.
 * ------------------------------------------------------------------ */

type VercelModule = { default: { fetch: (request: Request) => Promise<Response> } }

const UNREACHABLE_DATABASE = 'postgres://user:pw@127.0.0.1:1/nothing'

async function importEntrypoint(
  env: Record<string, string | undefined>,
): Promise<VercelModule> {
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value ?? '')
  }
  vi.resetModules()
  return (await import('../../api/index.js')) as VercelModule
}

/** Calls the export the way the platform does. */
async function call(
  entry: VercelModule,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return entry.default.fetch(
    new Request(`https://deployment.example${path}`, init),
  )
}

describe('the exported Vercel entry point', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('exports a Hono app with a fetch surface, and no per-method adapters', async () => {
    const entry = await importEntrypoint({
      DATABASE_URL: UNREACHABLE_DATABASE,
      SYNC_ENROLLMENT_SECRET: ENROLLMENT_SECRET,
      REPORTING_ADMIN_SECRET: REPORTING_SECRET,
      SYNC_ALLOWED_ORIGINS: '',
    })

    expect(typeof entry.default.fetch).toBe('function')
    // The Next.js Route Handler shape is deliberately absent.
    expect('GET' in entry).toBe(false)
    expect('POST' in entry).toBe(false)
  })

  it('routes GET /api/health', async () => {
    const entry = await importEntrypoint({
      DATABASE_URL: UNREACHABLE_DATABASE,
      SYNC_ENROLLMENT_SECRET: ENROLLMENT_SECRET,
      REPORTING_ADMIN_SECRET: REPORTING_SECRET,
      SYNC_ALLOWED_ORIGINS: '',
    })

    const response = await call(entry, '/api/health')
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body['status']).toBe('ok')
    expect(body['protocolVersion']).toBe(SYNC_PROTOCOL_VERSION)
    // The probe ran and failed against the unreachable database, which is the
    // honest answer rather than an exception.
    expect(body['database']).toBe(false)
  })

  it('routes POST /api/v1/sync/enroll', async () => {
    const entry = await importEntrypoint({
      DATABASE_URL: UNREACHABLE_DATABASE,
      SYNC_ENROLLMENT_SECRET: ENROLLMENT_SECRET,
      REPORTING_ADMIN_SECRET: REPORTING_SECRET,
      SYNC_ALLOWED_ORIGINS: '',
    })

    const response = await call(entry, '/api/v1/sync/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: EVENT_ID,
        deviceId: DEVICE_A,
        enrollmentSecret: 'the-wrong-code',
      }),
    })

    // Reached the enrolment route and was refused on the credential, before any
    // database call. A 404 here would mean the mount had lost the route.
    expect(response.status).toBe(401)
    expect((await response.json()) as unknown).toEqual({
      error: 'enrollment_rejected',
    })
  })

  it('routes POST /api/v1/sync/batch', async () => {
    const entry = await importEntrypoint({
      DATABASE_URL: UNREACHABLE_DATABASE,
      SYNC_ENROLLMENT_SECRET: ENROLLMENT_SECRET,
      REPORTING_ADMIN_SECRET: REPORTING_SECRET,
      SYNC_ALLOWED_ORIGINS: '',
    })

    const response = await call(entry, '/api/v1/sync/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonsense: true }),
    })

    // Rejected by the envelope schema, which runs before authentication and
    // therefore before the database.
    expect(response.status).toBe(400)
    expect((await response.json()) as unknown).toEqual({ error: 'invalid_batch' })
  })

  it('routes /api/v1/reporting/*', async () => {
    const entry = await importEntrypoint({
      DATABASE_URL: UNREACHABLE_DATABASE,
      SYNC_ENROLLMENT_SECRET: ENROLLMENT_SECRET,
      REPORTING_ADMIN_SECRET: REPORTING_SECRET,
      SYNC_ALLOWED_ORIGINS: '',
    })

    const response = await call(
      entry,
      `/api/v1/reporting/overview?eventId=${EVENT_ID}`,
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('no-store, private')
  })

  it('does not answer on a doubled prefix', async () => {
    const entry = await importEntrypoint({
      DATABASE_URL: UNREACHABLE_DATABASE,
      SYNC_ENROLLMENT_SECRET: ENROLLMENT_SECRET,
      REPORTING_ADMIN_SECRET: REPORTING_SECRET,
      SYNC_ALLOWED_ORIGINS: '',
    })

    expect((await call(entry, '/api/api/health')).status).toBe(404)
    expect((await call(entry, '/health')).status).toBe(404)
  })

  it('answers 500 naming the missing variable when misconfigured', async () => {
    /*
     * A deployment with no `DATABASE_URL`. The instance must not crash on
     * import: a crashed function tells an operator only that something failed,
     * while this tells them which variable to set, and never its value.
     */
    const entry = await importEntrypoint({
      DATABASE_URL: '',
      SYNC_ENROLLMENT_SECRET: '',
      REPORTING_ADMIN_SECRET: '',
      SYNC_ALLOWED_ORIGINS: '',
    })

    const response = await call(entry, '/api/health')
    const body = (await response.json()) as Record<string, string>

    expect(response.status).toBe(500)
    expect(body['error']).toBe('server_misconfigured')
    expect(body['message']).toContain('DATABASE_URL')
  })
})
