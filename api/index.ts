import { Hono } from 'hono'
import { createCentralApp } from '../server/centralApp.js'
import { readServerConfig } from '../server/config.js'

/*
 * The Vercel runtime.
 *
 * One function answers every `/api/*` request, and the central Hono app, the
 * same one `pnpm server:start` serves, answers it.
 *
 * ## The export
 *
 * A Hono application, directly. Vercel Functions accept a Web-standard fetch
 * handler, and a Hono app is one: it exposes `fetch(Request): Response`, which
 * is the whole contract.
 *
 * Deliberately NOT `handle()` from `hono/vercel`. That adapter exists to produce
 * the per-method `GET`/`POST` exports a Next.js Route Handler expects, and this
 * project is a Vite frontend with standalone functions. Wrapping the app in a
 * Next.js-shaped adapter would add a translation layer between two things that
 * already speak the same protocol, and would need one export per method kept in
 * step with the routes.
 *
 * ## Why this file is `index.ts` and not `[...path].ts`
 *
 * It used to be `api/[...path].ts`, on the assumption that Vercel reads that
 * filename as a multi-segment splat the way a framework router would. It does
 * not. Vercel's zero-config `/api` handling turned that name into a route
 * matching exactly ONE segment:
 *
 *   "src": "^/api/([^/]+)$", "dest": "/api/[...path]?...path=$1"
 *   "src": "^/api(/.*)?$",   "status": 404
 *
 * So `/api/health` reached the function and `/api/v1/sync/enroll` never did: it
 * fell through to the platform's own 404, before any of this code ran. That was
 * not visible in any test, because every test called the Hono app directly.
 *
 * A plain filename produces no dynamic-segment inference at all, and the single
 * rewrite in `vercel.json` (`/api/:path*` to `/api/index`) is then the only
 * thing that routes the API. One mechanism, written down, instead of an
 * inferred one that behaved differently from the way its filename read.
 *
 * ## Why the incoming path is resolved rather than assumed
 *
 * The central app defines `/health` and `/v1/...` and knows nothing about how
 * it is deployed. `/api` is a fact about one deployment, not about the API, so
 * the prefix is dealt with here.
 *
 * `resolveApiPath` exists because a rewrite is involved, and the request URL a
 * rewritten function receives could reasonably be either the original path or
 * the rewrite's destination. Vercel's route table passes the captured segments
 * either way, as `?path=v1/sync/enroll`, so both forms carry the truth. Reading
 * the pathname first and falling back to the captured segments means the API
 * answers under either behaviour, and this stops being something a deployment
 * has to discover in production.
 *
 * ## What this file must not do
 *
 * No `serve()`, no `listen()`, no `createServer()`. A function is handed a
 * Request and returns a Response; opening a listener would be a process that
 * never becomes ready.
 *
 * No migrations. Not on cold start, not on first request, not ever: a schema
 * change must be an operator running `pnpm server:migrate` deliberately, never
 * a side effect of traffic arriving.
 *
 * ## Module scope is deliberate
 *
 * Configuration is read and the database client is created once per instance,
 * not once per request. Vercel keeps an instance warm across invocations, so a
 * client built here is reused by every request that instance serves; building
 * one per request would open a connection per request, and a database has a
 * finite number of those. For the same reason nothing here calls `sql.end()`:
 * the next request wants that connection.
 */

/** Where Vercel's rewrite puts this function, before any path substitution. */
const FUNCTION_PATH = '/api/index'

/** The public prefix every deployed route carries. */
const API_PREFIX = '/api'

/**
 * The path inside the central app that a deployed request is asking for.
 *
 * `/api/v1/sync/enroll` becomes `/v1/sync/enroll`, whether the platform handed
 * this function the original path or its own rewrite destination.
 *
 * `null` means the request is not an API request at all. Nothing outside `/api`
 * is routed here, so that can only be reached by calling the function directly,
 * and answering it would put a second copy of `/health` on the deployment,
 * beside the static site's own paths.
 */
export function resolveApiPath(url: URL): string | null {
  const pathname = url.pathname

  // The rewrite destination itself, meaning the platform replaced the path. The
  // captured segments are the request that was actually made.
  if (pathname === FUNCTION_PATH) {
    const captured = url.searchParams.get('path') ?? ''
    return captured.length === 0 ? '/' : `/${captured.replace(/^\/+/, '')}`
  }

  if (pathname === API_PREFIX) {
    return '/'
  }

  if (pathname.startsWith(`${API_PREFIX}/`)) {
    return pathname.slice(API_PREFIX.length)
  }

  return null
}

const result = readServerConfig(process.env)

/*
 * A misconfigured deployment answers 500 with a message naming the variable,
 * rather than crashing the instance on import. A crashed function tells an
 * operator only that something failed; this tells them which variable to set,
 * and it survives being read in a Vercel log without ever containing a value.
 */
const app = new Hono()

if (result.ok) {
  const { app: central } = createCentralApp({
    config: result.config,
    runtime: 'serverless',
    // Vercel captures stdout per invocation. Identifiers, counts and timings
    // only: the central app already guarantees that.
    log: (line) => console.log(line),
  })

  app.all('*', (context) => {
    const url = new URL(context.req.url)
    const inner = resolveApiPath(url)

    if (inner === null) {
      return context.notFound()
    }

    const target = new URL(url)
    target.pathname = inner
    // The captured path is routing metadata, not an argument to any handler.
    target.searchParams.delete('path')

    /*
     * `new Request(url, request)` carries the method, the headers and the body
     * across unchanged; only the URL is replaced. Every query parameter the
     * caller sent survives, which reporting depends on.
     */
    return central.fetch(new Request(target, context.req.raw))
  })
} else {
  const problem = result.problem

  app.all('*', (context) => {
    console.error(problem)
    return context.json({ error: 'server_misconfigured', message: problem }, 500)
  })
}

export default app
