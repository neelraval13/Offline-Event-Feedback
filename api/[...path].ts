import { Hono } from 'hono'
import { createCentralApp } from '../server/centralApp'
import { readServerConfig } from '../server/config'

/*
 * The Vercel runtime.
 *
 * A catch-all function: every request to `/api/*` arrives here, and the central
 * Hono app, the same one `pnpm server:start` serves, answers it.
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
 * ## Why the prefix is applied here
 *
 * `server/app.ts` defines `/health` and `/v1/...` and knows nothing about how it
 * is deployed. Vercel's routing puts this file at `/api`, so the app is mounted
 * under that prefix here, which makes the production endpoints `/api/health` and
 * `/api/v1/...` without a single route inside the central app being rewritten.
 * The local server keeps serving the same routes unprefixed on its own port.
 * `/api` is a fact about one deployment, not about the API.
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

  app.route('/api', central)
} else {
  const problem = result.problem

  app.all('/api/*', (context) => {
    console.error(problem)
    return context.json({ error: 'server_misconfigured', message: problem }, 500)
  })
}

export default app
