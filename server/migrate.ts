import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import {
  MISSING_MIGRATION_URL_MESSAGE,
  resolveMigrationDatabaseUrl,
} from './config'

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
 *
 * Never run automatically: not on server start, not on a Vercel build, not on
 * the first request. A schema holding an event's records must only change
 * because someone decided it should.
 */

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations',
)

/*
 * A direct connection, not a pooled one.
 *
 * `MIGRATION_DATABASE_URL` wins because it is the operator's deliberate choice.
 * Neon's own integration exports `DATABASE_URL_UNPOOLED`, so that is next, and
 * `DATABASE_URL` last for a developer with one local Postgres and nothing to
 * disambiguate. See `resolveMigrationDatabaseUrl` for why pooled is wrong here.
 */
const migration = resolveMigrationDatabaseUrl(process.env)
if (migration.url === null) {
  console.error(MISSING_MIGRATION_URL_MESSAGE)
  process.exit(1)
}

// The variable's name, never its value.
console.log(`Applying migrations using ${migration.source}.`)
const databaseUrl = migration.url

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
