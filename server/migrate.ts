import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

/*
 * Migration runner.
 *
 * Deliberate and separate from the server: schema changes to a database holding
 * an event's records should never be a side effect of a process restart or a
 * container redeploy.
 *
 * Applied migrations are tracked in `schema_migrations`, so running this twice
 * is a no-op. It only ever creates; nothing here drops or rewrites, so it is
 * safe to run against a database with data in it.
 *
 *   pnpm server:migrate
 */

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations',
)

const databaseUrl = process.env['DATABASE_URL']
if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.error('Missing required environment variable: DATABASE_URL')
  process.exit(1)
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} })

async function main(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `

  const applied = new Set(
    (
      await sql<{ name: string }[]>`SELECT name FROM schema_migrations`
    ).map((row) => row.name),
  )

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  let count = 0
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`· ${file} (already applied)`)
      continue
    }

    const statements = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')

    // Each migration and its bookkeeping row commit together, so a failure
    // halfway through cannot leave the ledger disagreeing with the schema.
    await sql.begin(async (tx) => {
      await tx.unsafe(statements)
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`
    })

    console.log(`✓ ${file}`)
    count += 1
  }

  console.log(
    count === 0 ? 'Schema already up to date.' : `Applied ${count} migration(s).`,
  )
}

main()
  .catch((error: unknown) => {
    console.error(
      `Migration failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  })
  .finally(() => {
    void sql.end({ timeout: 5 })
  })
