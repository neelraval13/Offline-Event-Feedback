import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolveApiPath } from '../../api/index.js'

/*
 * The deployed public contract, at the layer that actually broke.
 *
 * Two things failed in production that no test here could see, and they failed
 * for unrelated reasons:
 *
 *   1. The function crashed on import, because `vercel build` emits the
 *      TypeScript specifiers verbatim and Node ESM will not resolve an
 *      extensionless one. Covered by `scripts/verify-vercel-build.mjs`, which
 *      loads the built artifact rather than the source.
 *
 *   2. `/api/v1/sync/enroll` never reached the function at all. Vercel's
 *      zero-config `/api` handling read `api/[...path].ts` as a route matching
 *      exactly ONE segment:
 *
 *        "src": "^/api/([^/]+)$", "dest": "/api/[...path]?...path=$1"
 *        "src": "^/api(/.*)?$",   "status": 404
 *
 *      so `/api/health` worked and every nested path got the platform's own
 *      404, before any application code ran. That is what this file covers.
 *
 * The route-table assertions read `.vercel/output/config.json`, which is what
 * `vercel build` generates and what the platform routes from. They skip when it
 * is absent, because a plain `pnpm test` has not run a Vercel build; the
 * command that produces it is in `docs/architecture.md` and in the script
 * above. What never skips is the entry point's own behaviour, below.
 */

const ENROLLMENT_SECRET = 'vercel-routing-enrolment-secret'
const UNREACHABLE_DATABASE = 'postgres://user:pw@127.0.0.1:1/nothing'

/** The paths the browser and the reporting client actually call. */
const PUBLIC_CONTRACT = [
  '/api/health',
  '/api/v1/sync/enroll',
  '/api/v1/sync/batch',
  '/api/v1/reporting/overview',
  '/api/v1/reporting/export/registrations',
] as const

describe('resolving the path the central app should see', () => {
  /*
   * A rewrite is involved, so the request URL handed to the function could
   * reasonably be either the path the caller asked for or the rewrite's own
   * destination. Vercel's route table carries the captured segments either way,
   * as `?path=v1/sync/enroll`, so both forms are resolvable and the deployment
   * does not depend on which one arrives.
   */

  it('strips the deployment prefix from a real request path', () => {
    expect(resolveApiPath(new URL('https://x.test/api/health'))).toBe('/health')
    expect(resolveApiPath(new URL('https://x.test/api/v1/sync/enroll'))).toBe(
      '/v1/sync/enroll',
    )
    expect(resolveApiPath(new URL('https://x.test/api'))).toBe('/')
  })

  it('recovers the path from the rewrite destination', () => {
    expect(
      resolveApiPath(new URL('https://x.test/api/index?path=v1/sync/enroll')),
    ).toBe('/v1/sync/enroll')
    expect(resolveApiPath(new URL('https://x.test/api/index?path=health'))).toBe(
      '/health',
    )
    expect(resolveApiPath(new URL('https://x.test/api/index?path='))).toBe('/')
  })

  it('keeps the query string that the caller sent', () => {
    // Reporting reads `eventId` and `runId` from the query; losing them while
    // rewriting the path would turn every reporting call into a 400.
    const url = new URL('https://x.test/api/v1/reporting/overview?eventId=e&runId=r')

    expect(resolveApiPath(url)).toBe('/v1/reporting/overview')
    expect(url.searchParams.get('eventId')).toBe('e')
  })

  it('refuses a path that is not under the deployment prefix', () => {
    // Nothing outside `/api` is routed here. Answering it would put a second
    // `/health` on the deployment, beside the static site's own paths.
    expect(resolveApiPath(new URL('https://x.test/health'))).toBeNull()
    expect(resolveApiPath(new URL('https://x.test/'))).toBeNull()
    expect(resolveApiPath(new URL('https://x.test/apifoo'))).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * The generated route table
 * ------------------------------------------------------------------ */

interface BuildRoute {
  readonly src?: string
  readonly dest?: string
  readonly status?: number
  readonly handle?: string
  readonly continue?: boolean
}

const OUTPUT_CONFIG = '.vercel/output/config.json'
const built = existsSync(OUTPUT_CONFIG)

/** Walks the Build Output route table the way the platform does. */
function resolveRoute(
  routes: readonly BuildRoute[],
  path: string,
): { kind: 'function'; dest: string } | { kind: 'status'; status: number } | { kind: 'static' } {
  let phase = 'initial'

  for (const route of routes) {
    if (typeof route.handle === 'string') {
      phase = route.handle
      continue
    }
    // Everything after `error` or `miss` is a fallback for a request that has
    // already failed to route.
    if (phase !== 'initial' && phase !== 'filesystem') {
      continue
    }

    const match = new RegExp(route.src as string).exec(path)
    if (match === null || route.continue === true) {
      continue
    }
    if (typeof route.dest === 'string') {
      return {
        kind: 'function',
        dest: route.dest.replace(/\$(\d)/g, (_, index: string) => match[Number(index)] ?? ''),
      }
    }
    if (route.status !== undefined) {
      return { kind: 'status', status: route.status }
    }
  }

  return { kind: 'static' }
}

describe.skipIf(!built)('the route table `vercel build` generates', () => {
  const routes = built
    ? (JSON.parse(readFileSync(OUTPUT_CONFIG, 'utf8')).routes as BuildRoute[])
    : []

  it.each(PUBLIC_CONTRACT)('sends %s to a function', (path) => {
    const outcome = resolveRoute(routes, path)

    // A `status` outcome here is the production bug: the platform answering
    // 404 for a path the API defines, without invoking anything.
    expect(outcome.kind).toBe('function')
  })

  it('sends every API path to the same function', () => {
    const destinations = new Set(
      PUBLIC_CONTRACT.map((path) => {
        const outcome = resolveRoute(routes, path)
        return outcome.kind === 'function' ? (outcome.dest.split('?')[0] as string) : outcome.kind
      }),
    )

    // One central router, not one function per route.
    expect([...destinations]).toEqual(['/api/index'])
  })

  it('does not depend on a single-segment dynamic route', () => {
    /*
     * The exact shape that broke production. If this reappears, some change has
     * gone back to relying on Vercel inferring a route from a `[...]` filename,
     * which it reads as one segment.
     */
    const inferred = routes.filter(
      (route) => route.src === '^/api/([^/]+)$' && route.dest !== undefined,
    )

    expect(inferred).toEqual([])
  })

  it('leaves the static site alone', () => {
    for (const path of ['/', '/index.html', '/assets/app.js', '/sw.js']) {
      expect(resolveRoute(routes, path).kind).not.toBe('function')
    }
  })
})

/* ------------------------------------------------------------------ *
 * The entry point, called the way the platform calls it
 * ------------------------------------------------------------------ */

type VercelModule = { default: { fetch: (request: Request) => Promise<Response> } }

async function entrypoint(): Promise<VercelModule> {
  vi.stubEnv('DATABASE_URL', UNREACHABLE_DATABASE)
  vi.stubEnv('SYNC_ENROLLMENT_SECRET', ENROLLMENT_SECRET)
  vi.stubEnv('SYNC_ALLOWED_ORIGINS', '')
  vi.stubEnv('REPORTING_ADMIN_SECRET', '')
  vi.resetModules()
  return (await import('../../api/index.js')) as VercelModule
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

describe('the deployed contract, through the entry point', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function call(path: string, init?: RequestInit): Promise<Response> {
    const entry = await entrypoint()
    return entry.default.fetch(new Request(`https://deployment.example${path}`, init))
  }

  it('answers GET /api/health with 200', async () => {
    const response = await call('/api/health')

    expect(response.status).toBe(200)
  })

  it('answers POST /api/v1/sync/enroll {} with 400 invalid_request', async () => {
    const response = await call('/api/v1/sync/enroll', post({}))

    expect(response.status).toBe(400)
    expect((await response.json()) as unknown).toEqual({ error: 'invalid_request' })
  })

  it('answers a valid enrolment with the wrong secret with 401', async () => {
    /*
     * The end of the chain: routing reached the function, the function reached
     * Hono, Hono reached the enrolment handler, and the handler refused the
     * credential. A 404 anywhere earlier would show up here first.
     */
    const response = await call(
      '/api/v1/sync/enroll',
      post({
        eventId: 'ff-rc-2026-08-23',
        deviceId: '11111111-2222-4333-8444-555555555555',
        enrollmentSecret: 'deliberately-wrong',
      }),
    )

    expect(response.status).toBe(401)
    expect((await response.json()) as unknown).toEqual({ error: 'enrollment_rejected' })
  })

  it('reaches Hono for POST /api/v1/sync/batch rather than 404', async () => {
    const response = await call('/api/v1/sync/batch', post({ nonsense: true }))

    expect(response.status).toBe(400)
    expect((await response.json()) as unknown).toEqual({ error: 'invalid_batch' })
  })

  it('reaches the reporting router for /api/v1/reporting/*', async () => {
    for (const path of [
      '/api/v1/reporting/overview?eventId=ff-rc-2026-08-23',
      '/api/v1/reporting/export/registrations?eventId=ff-rc-2026-08-23',
      '/api/v1/reporting/duplicates?eventId=ff-rc-2026-08-23',
    ]) {
      const response = await call(path)

      // Refused because this run configures no reporting secret, which is the
      // reporting router answering. A 404 would mean the mount had lost it.
      expect(response.status).not.toBe(404)
      expect(response.headers.get('Cache-Control')).toBe('no-store, private')
    }
  })

  it('answers the same when the platform hands it the rewrite destination', async () => {
    /*
     * `vercel.json` rewrites `/api/:path*` to `/api/index`, and the captured
     * segments arrive as `?path=`. Whether the function is given the caller's
     * path or that destination is a platform detail; both must work, so neither
     * is something a deployment discovers the hard way.
     */
    const health = await call('/api/index?path=health')
    expect(health.status).toBe(200)

    const enroll = await call('/api/index?path=v1/sync/enroll', post({}))
    expect(enroll.status).toBe(400)
    expect((await enroll.json()) as unknown).toEqual({ error: 'invalid_request' })
  })

  it('still refuses paths the deployment does not route here', async () => {
    expect((await call('/health')).status).toBe(404)
    expect((await call('/api/api/health')).status).toBe(404)
    expect((await call('/v1/sync/enroll', post({}))).status).toBe(404)
  })
})
