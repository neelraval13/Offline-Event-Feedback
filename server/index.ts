import { serve } from '@hono/node-server'
import { createCentralApp, describeConfiguration } from './centralApp'
import { readServerConfig } from './config'

/*
 * The local Node runtime.
 *
 * Everything about *what* the API is lives in `centralApp.ts` and is shared with
 * the Vercel function. What is here is what only a long-lived process does:
 * bind a port, log that it did, and close its database connections on the way
 * out.
 *
 * It deliberately does **not** apply migrations. A process restart must never be
 * able to alter a schema holding an event's records; migrations run through
 * `pnpm server:migrate`, deliberately, by an operator.
 */

const result = readServerConfig(process.env)

if (!result.ok) {
  // The problem names the variable that is wrong. It never contains a value.
  console.error(result.problem)
  process.exit(1)
}

const { config } = result

/*
 * A local split-origin setup needs its origins listed: the Vite dev server on
 * :5173 calling this on :8788 is cross-origin, and without an allowlist the
 * browser refuses every request in a way that looks like the server is down.
 *
 * In production the app and the API share an origin and the list is correctly
 * empty, so this is a warning rather than a failure.
 */
if (config.allowedOrigins.length === 0) {
  console.warn(
    'SYNC_ALLOWED_ORIGINS is empty: only same-origin requests will be accepted. ' +
      'Local development usually needs http://localhost:5173,http://localhost:4173',
  )
}

const { app, sql } = createCentralApp({ config, runtime: 'local' })

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `sync server listening on port ${info.port}; ` +
      describeConfiguration(config, 'local'),
  )
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void sql.end({ timeout: 5 }).finally(() => process.exit(0))
  })
}
