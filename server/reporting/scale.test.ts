import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres, { type Sql } from 'postgres'
import { runReconciliation } from '../reconciliation/postgres'
import { buildWorkbook } from './exportXlsx'
import {
  buildOverview,
  exportFeedbackRows,
  exportRegistrationRows,
  exportDuplicateCandidateRows,
  findRun,
  queryDuplicateCandidates,
  queryFeedback,
  queryRegistrations,
} from './postgres'

/*
 * Reporting at the size of a real event day.
 *
 * 10,000 registrations and 9,000 responses is the stated target, and it is the
 * size at which the interesting mistakes appear: a page that scans the whole
 * table, an export that walks itself a page at a time, a workbook built by
 * concatenating strings.
 *
 * Timings are printed rather than asserted tightly: a CI box is not a server,
 * and a strict threshold here would fail for reasons that have nothing to do
 * with this code. The generous bounds that are asserted exist to catch an
 * order-of-magnitude regression, which is the failure worth blocking on.
 *
 * Skipped unless a database is configured. This suite writes ~19,000 rows, so
 * point it at a scratch database, never at one holding an event's records:
 *
 *   REPORTING_SCALE_DATABASE_URL=postgres://localhost:5432/oef_scale_test \
 *     pnpm server:test
 */

const DATABASE_URL = process.env['REPORTING_SCALE_DATABASE_URL']
const describeScale = DATABASE_URL === undefined ? describe.skip : describe

if (DATABASE_URL === undefined) {
  console.info(
    'reporting scale test: skipped (set REPORTING_SCALE_DATABASE_URL to run)',
  )
}

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const EVENT_ID = 'evt-scale-reporting'
const DEVICE = '11111111-2222-4333-8444-555555555555'

const REGISTRATIONS = 10_000
const RESPONSES = 9_000
/** Participants deliberately given two responses, to exercise the ambiguity. */
const DOUBLE_RESPONSES = 120
/** Registration pairs deliberately sharing a phone number. */
const SHARED_PHONES = 60

let sql: Sql

interface Timing {
  readonly label: string
  readonly ms: number
}

const timings: Timing[] = []

async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now()
  const value = await work()
  timings.push({ label, ms: Date.now() - started })
  return value
}

async function applyMigrations(): Promise<void> {
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await sql.unsafe(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
}

function publicCodeFor(sequence: number): string {
  return `A1-B8EFD9-${String(sequence).padStart(5, '0')}-X`
}

/** Bulk insert, because 19,000 single-row round trips would dominate the run. */
async function seed(): Promise<void> {
  const registrations: Record<string, unknown>[] = []
  const codes: string[] = []
  const participants: string[] = []

  for (let index = 1; index <= REGISTRATIONS; index += 1) {
    const code = publicCodeFor(index)
    const participantId = randomUUID()
    codes.push(code)
    participants.push(participantId)

    // A shared phone number every so often: the duplicate-candidate detector
    // has to have something to find.
    const phoneIndex = index <= SHARED_PHONES * 2 ? Math.ceil(index / 2) : index

    registrations.push({
      record_id: randomUUID(),
      participant_id: participantId,
      public_code: code,
      event_id: EVENT_ID,
      event_day: '2026-01-01',
      station_id: 'A1',
      source_device_id: DEVICE,
      name: `Participant ${index}`,
      phone: `+9198765${String(10000 + phoneIndex).slice(-5)}`,
      email: `p${index}@example.com`,
      created_at: new Date(Date.UTC(2026, 0, 1, 9, 0, 0) + index * 1000),
      updated_at: new Date(Date.UTC(2026, 0, 1, 9, 0, 0) + index * 1000),
      revision: 1,
      first_received_at: new Date(Date.UTC(2026, 0, 1, 12, 0, 0)),
      last_received_at: new Date(Date.UTC(2026, 0, 1, 12, 0, 0)),
      last_uploader_device_id: DEVICE,
    })
  }

  for (let offset = 0; offset < registrations.length; offset += 1000) {
    await sql`INSERT INTO registrations ${sql(registrations.slice(offset, offset + 1000))}`
  }

  const feedback: Record<string, unknown>[] = []
  for (let index = 0; index < RESPONSES; index += 1) {
    // The first N participants get two responses each; the tail gets one.
    const target = index < DOUBLE_RESPONSES * 2 ? Math.floor(index / 2) : index
    const scanned = index % 2 === 0

    feedback.push({
      record_id: randomUUID(),
      participant_id: scanned ? (participants[target] ?? null) : null,
      public_code: codes[target] ?? publicCodeFor(1),
      capture_method: scanned ? 'qr' : 'manual',
      event_id: EVENT_ID,
      event_day: '2026-01-01',
      station_id: 'B1',
      source_device_id: DEVICE,
      form_version: 'feedback-v1',
      answers: sql.json({
        overall_rating: (index % 5) + 1,
        experience: ['very_poor', 'poor', 'okay', 'good', 'excellent'][index % 5],
        recommend: index % 3 !== 0,
        comments: index % 7 === 0 ? '=SUM(A1:A9)' : 'Good session',
      }),
      created_at: new Date(Date.UTC(2026, 0, 1, 14, 0, 0) + index * 1000),
      updated_at: new Date(Date.UTC(2026, 0, 1, 14, 0, 0) + index * 1000),
      revision: 1,
      first_received_at: new Date(Date.UTC(2026, 0, 1, 18, 0, 0)),
      last_received_at: new Date(Date.UTC(2026, 0, 1, 18, 0, 0)),
      last_uploader_device_id: DEVICE,
    })
  }

  for (let offset = 0; offset < feedback.length; offset += 1000) {
    await sql`INSERT INTO feedback ${sql(feedback.slice(offset, offset + 1000))}`
  }
}

describeScale('reporting at 10,000 registrations', () => {
  let runId: string

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 4, onnotice: () => {} })
    await applyMigrations()

    // A scratch database, emptied for a repeatable measurement.
    await sql`DELETE FROM reconciliation_duplicate_registration_candidates`
    await sql`DELETE FROM reconciliation_feedback_results`
    await sql`DELETE FROM reconciliation_registration_results`
    await sql`DELETE FROM reconciliation_runs`
    await sql`DELETE FROM feedback WHERE event_id = ${EVENT_ID}`
    await sql`DELETE FROM registrations WHERE event_id = ${EVENT_ID}`

    await timed('seed 19,000 records', seed)
    // Planner statistics matter more than the row count at this size: without
    // them Postgres may pick a nested loop where it should hash-join.
    await sql`ANALYZE registrations`
    await sql`ANALYZE feedback`

    const run = await timed('reconciliation run', () =>
      runReconciliation(sql, EVENT_ID),
    )
    runId = run.runId
    await sql`ANALYZE reconciliation_registration_results`
    await sql`ANALYZE reconciliation_feedback_results`
  }, 600_000)

  afterAll(async () => {
    if (timings.length > 0) {
      console.info(
        `\nreporting scale timings (${REGISTRATIONS} registrations, ${RESPONSES} responses):\n` +
          timings.map(({ label, ms }) => `  ${label}: ${ms} ms`).join('\n'),
      )
    }
    await sql?.end({ timeout: 5 })
  })

  it('summarises the event without scanning it page by page', async () => {
    const overview = await timed('overview', () => buildOverview(sql, EVENT_ID, runId))

    expect(overview).not.toBeNull()
    expect(overview?.run.counts.registrationCount).toBe(REGISTRATIONS)
    expect(overview?.run.counts.feedbackCount).toBe(RESPONSES)
    // Ambiguous participants must be excluded from the analytics sample.
    expect(overview?.run.counts.registrationsWithMultipleFeedback).toBe(
      DOUBLE_RESPONSES,
    )
    expect(overview?.analytics.analysedResponses).toBeLessThan(RESPONSES)
    expect(timings.at(-1)?.ms).toBeLessThan(5_000)
  }, 120_000)

  it('returns the first page quickly and keeps its cost flat down the list', async () => {
    const first = await timed('registrations page 1', () =>
      queryRegistrations(sql, { eventId: EVENT_ID, runId, limit: 50 }),
    )
    expect(first.rows).toHaveLength(50)
    expect(first.nextCursor).not.toBeNull()

    // Walk deep into the list. Keyset pagination should not get slower with
    // depth the way OFFSET does.
    let cursor = first.nextCursor
    let pages = 1
    const deepStarted = Date.now()
    while (cursor !== null && pages < 40) {
      const page = await queryRegistrations(sql, {
        eventId: EVENT_ID,
        runId,
        limit: 50,
        cursor,
      })
      cursor = page.nextCursor
      pages += 1
    }
    timings.push({
      label: `registrations pages 2-${pages} (50 each)`,
      ms: Date.now() - deepStarted,
    })

    expect(pages).toBe(40)
    // 39 pages: an average worse than 250 ms each means the query is scanning.
    expect(Date.now() - deepStarted).toBeLessThan(39 * 250)
  }, 120_000)

  it('searches the whole event within a page load', async () => {
    const result = await timed('search by name substring', () =>
      queryRegistrations(sql, {
        eventId: EVENT_ID,
        runId,
        search: 'Participant 9999',
        limit: 50,
      }),
    )

    expect(result.rows.length).toBeGreaterThan(0)
    expect(timings.at(-1)?.ms).toBeLessThan(5_000)
  }, 120_000)

  it('filters to the ambiguous participants', async () => {
    const result = await timed('filter multiple_feedback', () =>
      queryRegistrations(sql, {
        eventId: EVENT_ID,
        runId,
        status: 'multiple_feedback',
        limit: 100,
      }),
    )

    expect(result.rows).toHaveLength(100)
    for (const row of result.rows) {
      // The ambiguity must survive to the row: no answer is attached.
      expect(row.reconciliationStatus).toBe('multiple_feedback')
      expect(row.feedbackSummary).toBeNull()
    }
  }, 120_000)

  it('pages the responses', async () => {
    const page = await timed('feedback page 1', () =>
      queryFeedback(sql, { eventId: EVENT_ID, runId, limit: 50 }),
    )

    expect(page.rows).toHaveLength(50)
    expect(timings.at(-1)?.ms).toBeLessThan(5_000)
  }, 120_000)

  it('lists duplicate candidates a page at a time, and exports all of them', async () => {
    const page = await timed('duplicate candidates page', () =>
      queryDuplicateCandidates(sql, EVENT_ID, runId, 100),
    )
    const everything = await timed('duplicate candidates export', () =>
      exportDuplicateCandidateRows(sql, EVENT_ID, runId),
    )

    expect(page.length).toBeGreaterThan(0)
    // The browse view is capped; the export is the complete list, which is why
    // the API reports the run's own total alongside the page.
    expect(everything.length).toBeGreaterThanOrEqual(SHARED_PHONES)
    expect(everything.length).toBeGreaterThanOrEqual(page.length)
  }, 120_000)

  it('exports every row in one statement per file', async () => {
    const registrations = await timed('export registrations', () =>
      exportRegistrationRows(sql, EVENT_ID, runId),
    )
    const feedback = await timed('export feedback', () =>
      exportFeedbackRows(sql, EVENT_ID, runId),
    )
    const duplicates = await timed('export duplicate candidates', () =>
      exportDuplicateCandidateRows(sql, EVENT_ID, runId),
    )

    expect(registrations).toHaveLength(REGISTRATIONS)
    expect(feedback).toHaveLength(RESPONSES)
    expect(duplicates.length).toBeGreaterThanOrEqual(SHARED_PHONES)

    // A participant with two responses carries no answer columns.
    const ambiguous = registrations.filter((row) => row.status === 'multiple_feedback')
    expect(ambiguous).toHaveLength(DOUBLE_RESPONSES)
    for (const row of ambiguous) {
      expect(row.overallRating).toBeNull()
      expect(row.feedbackRecordId).toBeNull()
    }
  }, 300_000)

  it('builds the whole workbook', async () => {
    const [overview, registrations, feedback, duplicates] = await Promise.all([
      buildOverview(sql, EVENT_ID, runId),
      exportRegistrationRows(sql, EVENT_ID, runId),
      exportFeedbackRows(sql, EVENT_ID, runId),
      exportDuplicateCandidateRows(sql, EVENT_ID, runId),
    ])

    expect(overview).not.toBeNull()

    const workbook = await timed('build XLSX workbook', () =>
      buildWorkbook({
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        overview: overview as NonNullable<typeof overview>,
        registrations,
        feedback,
        duplicates,
        generatedAt: new Date('2026-02-01T08:00:00.000Z'),
      }),
    )

    // 19,000 rows of text cells. Anything approaching a minute would mean the
    // organiser presses Export and assumes it failed.
    expect(workbook.byteLength).toBeGreaterThan(100_000)
    expect(timings.at(-1)?.ms).toBeLessThan(60_000)
  }, 300_000)

  it('reads a page from the index rather than sorting the event', async () => {
    const run = await findRun(sql, EVENT_ID)
    expect(run).not.toBeNull()

    /*
     * The plan of the shape the browser actually issues: driven from the run's
     * results, joined to the registration, ordered by the keyset. The plan is
     * the real evidence: a sort here means every page pays for the whole event.
     */
    const plan = await sql<{ 'QUERY PLAN': string }[]>`
      EXPLAIN (FORMAT TEXT)
      SELECT reg.record_id, res.status
      FROM reconciliation_registration_results res
      JOIN registrations reg ON reg.record_id = res.registration_record_id
      WHERE res.run_id = ${runId} AND reg.event_id = ${EVENT_ID}
      ORDER BY reg.created_at, reg.record_id
      LIMIT 51
    `
    const text = plan.map((row) => row['QUERY PLAN']).join('\n')
    console.info(`\nregistration page plan:\n${text}`)

    // Migration 003 exists for exactly this ordering.
    expect(text).toContain('registrations_event_browse_idx')
  }, 120_000)
})
