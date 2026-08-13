import { serve } from '@hono/node-server'
import postgres from 'postgres'
import { createApp } from './app'
import { createPostgresStore } from './db/postgresStore'

/*
 * Server entry point.
 *
 * Reads configuration, opens a pool, serves. It deliberately does **not** apply
 * migrations: a process restart must never be able to alter a schema holding an
 * event's records. Migrations run through `pnpm server:migrate`.
 */

function required(name: string): string {
  const value = process.env[name]

  if (value === undefined || value.length === 0) {
    // The name only — never the value, and never the connection string.
    console.error(`Missing required environment variable: ${name}`)
    process.exit(1)
  }

  return value
}

const databaseUrl = required('DATABASE_URL')
const enrollmentSecret = required('SYNC_ENROLLMENT_SECRET')

const allowedOrigins = (process.env['SYNC_ALLOWED_ORIGINS'] ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)

if (allowedOrigins.length === 0) {
  console.error(
    'SYNC_ALLOWED_ORIGINS is empty: no browser origin would be permitted to sync.',
  )
  process.exit(1)
}

const port = Number(process.env['PORT'] ?? 8788)

const sql = postgres(databaseUrl, { max: 10, onnotice: () => {} })

const app = createApp({
  store: createPostgresStore(sql),
  enrollmentSecret,
  allowedOrigins,
  checkDatabase: async () => {
    await sql`SELECT 1`
    return true
  },
})

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `sync server listening on port ${info.port}; origins: ${allowedOrigins.join(', ')}`,
  )
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void sql.end({ timeout: 5 }).finally(() => process.exit(0))
  })
}
