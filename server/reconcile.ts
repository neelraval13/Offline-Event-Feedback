import postgres from 'postgres'
import { runReconciliation } from './reconciliation/postgres'
import { formatSummary } from './reconciliation/summary'

/*
 * Reconciliation, invoked deliberately.
 *
 *   pnpm server:reconcile -- --event evt-dev-001
 *
 * Never run automatically after a sync batch. Ingest is a hot path that a
 * device is waiting on; reconciliation is a whole-event analysis that gets
 * slower as the event grows, and coupling them would make every upload pay for
 * it. It is safe to run repeatedly, during QA, after devices sync, after the
 * event closes, before reporting, and each run is its own snapshot.
 */

function argument(name: string): string | null {
  const flag = `--${name}`
  const index = process.argv.indexOf(flag)

  if (index !== -1) {
    return process.argv[index + 1] ?? null
  }

  const inline = process.argv.find((value) => value.startsWith(`${flag}=`))
  return inline === undefined ? null : inline.slice(flag.length + 1)
}

const databaseUrl = process.env['DATABASE_URL']
if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.error('Missing required environment variable: DATABASE_URL')
  process.exit(1)
}

const eventId = argument('event')
if (eventId === null || eventId.length === 0) {
  // Never defaulted: reconciling the wrong event silently would be worse than
  // not reconciling at all.
  console.error(
    'Missing required argument: --event <eventId>\n' +
      '  pnpm server:reconcile -- --event evt-dev-001',
  )
  process.exit(1)
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} })

async function main(): Promise<void> {
  const started = Date.now()
  const { runId, output } = await runReconciliation(sql, eventId as string)

  console.log(formatSummary(runId, eventId as string, output.counts))
  console.log(`Completed in ${Date.now() - started} ms`)
}

main()
  .catch((error: unknown) => {
    /*
     * The message only. A failed run has already rolled back, the raw records
     * are untouched and no partial run is recorded, so there is nothing to
     * clean up and nothing about a participant worth printing.
     */
    console.error(
      `Reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  })
  .finally(() => {
    void sql.end({ timeout: 5 })
  })
