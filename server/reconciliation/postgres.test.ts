import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres, { type Sql } from 'postgres'
import {
  getDuplicateCandidates,
  getFeedbackResults,
  getLatestCompletedRun,
  getRegistrationResults,
  listRuns,
  runReconciliation,
} from './postgres.js'

/*
 * Reconciliation against a real Postgres.
 *
 * Unit tests over the pure engine prove the classification rules; only a real
 * database proves the schema, the constraints, the REPEATABLE READ snapshot and
 * that a failed run leaves nothing behind.
 *
 * Skipped when no database is configured, so a checkout without Postgres can
 * still run the rest of the suite:
 *
 *   DATABASE_URL=postgres://localhost:5432/oef_recon_test pnpm server:test
 */

const DATABASE_URL = process.env['RECONCILIATION_TEST_DATABASE_URL']
const describeDb = DATABASE_URL === undefined ? describe.skip : describe

if (DATABASE_URL === undefined) {
  console.info(
    'reconciliation Postgres tests: skipped (set RECONCILIATION_TEST_DATABASE_URL to run)',
  )
}

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
)

const EVENT_ID = 'evt-test-recon'
const OTHER_EVENT = 'evt-test-other'
const DEVICE = '11111111-2222-4333-8444-555555555555'

let sql: Sql

async function applyMigrations(): Promise<void> {
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await sql.unsafe(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
}

let codeSequence = 0

interface SeededRegistration {
  recordId: string
  participantId: string
  publicCode: string
}

async function seedRegistration(
  overrides: { phone?: string; email?: string; eventId?: string } = {},
): Promise<SeededRegistration> {
  codeSequence += 1
  const record = {
    recordId: randomUUID(),
    participantId: randomUUID(),
    publicCode: `A1-B8EFD9-${String(codeSequence).padStart(5, '0')}-X`,
  }

  await sql`
    INSERT INTO registrations (
      record_id, participant_id, public_code,
      event_id, event_day, station_id, source_device_id,
      name, phone, email,
      created_at, updated_at, revision,
      first_received_at, last_received_at, last_uploader_device_id
    ) VALUES (
      ${record.recordId}, ${record.participantId}, ${record.publicCode},
      ${overrides.eventId ?? EVENT_ID}, '2026-01-01', 'A1', ${DEVICE},
      'Ada Lovelace', ${overrides.phone ?? `+44 20 7946 ${1000 + codeSequence}`},
      ${overrides.email ?? `p${codeSequence}@example.com`},
      '2026-01-01T09:00:00Z', '2026-01-01T09:00:00Z', 1,
      now(), now(), ${DEVICE}
    )
  `

  return record
}

async function seedFeedback(options: {
  publicCode: string
  participantId?: string | null
  captureMethod?: 'qr' | 'manual'
  eventId?: string
}): Promise<string> {
  const recordId = randomUUID()

  await sql`
    INSERT INTO feedback (
      record_id, participant_id, public_code, capture_method,
      event_id, event_day, station_id, source_device_id,
      form_version, answers,
      created_at, updated_at, revision,
      first_received_at, last_received_at, last_uploader_device_id
    ) VALUES (
      ${recordId}, ${options.participantId ?? null}, ${options.publicCode},
      ${options.captureMethod ?? 'manual'},
      ${options.eventId ?? EVENT_ID}, '2026-01-01', 'B1', ${DEVICE},
      'feedback-v1',
      ${sql.json({ overall_rating: 4, experience: 'good', recommend: true })},
      '2026-01-01T11:00:00Z', '2026-01-01T11:00:00Z', 1,
      now(), now(), ${DEVICE}
    )
  `

  return recordId
}

describeDb('reconciliation against Postgres', () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 4, onnotice: () => {} })
    await applyMigrations()
  })

  afterAll(async () => {
    await sql?.end({ timeout: 5 })
  })

  beforeEach(async () => {
    // Derived tables first: they reference the raw rows.
    await sql`DELETE FROM reconciliation_duplicate_registration_candidates`
    await sql`DELETE FROM reconciliation_feedback_results`
    await sql`DELETE FROM reconciliation_registration_results`
    await sql`DELETE FROM reconciliation_runs`
    await sql`DELETE FROM feedback`
    await sql`DELETE FROM registrations`
  })

  describe('migration 002', () => {
    it('creates every reconciliation structure', async () => {
      const tables = await sql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name LIKE 'reconciliation%'
        ORDER BY table_name
      `

      expect(tables.map((row) => row.table_name)).toEqual([
        'reconciliation_duplicate_registration_candidates',
        'reconciliation_feedback_results',
        'reconciliation_latest_runs',
        'reconciliation_registration_results',
        'reconciliation_runs',
      ])
    })

    it('constrains statuses at the database level', async () => {
      const registration = await seedRegistration()
      const { runId } = await runReconciliation(sql, EVENT_ID)

      await expect(
        sql`
          INSERT INTO reconciliation_registration_results
            (run_id, registration_record_id, status, valid_feedback_count)
          VALUES (${runId}, ${registration.recordId}, 'invented_status', 0)
        `,
      ).rejects.toThrow()
    })

    it('stores a duplicate pair in one canonical direction only', async () => {
      // The CHECK constraint refuses a reversed pair outright.
      const left = await seedRegistration()
      const right = await seedRegistration()
      const { runId } = await runReconciliation(sql, EVENT_ID)

      const ordered = [left.recordId, right.recordId].sort()
      const first = ordered[0] as string
      const second = ordered[1] as string

      await expect(
        sql`
          INSERT INTO reconciliation_duplicate_registration_candidates
            (run_id, left_registration_record_id, right_registration_record_id, match_basis)
          VALUES (${runId}, ${second}, ${first}, 'phone_only')
        `,
      ).rejects.toThrow()
    })
  })

  describe('persisting a run', () => {
    it('records results and counts', async () => {
      const matched = await seedRegistration()
      const lonely = await seedRegistration()
      await seedFeedback({ publicCode: matched.publicCode })

      const { runId, output } = await runReconciliation(sql, EVENT_ID)

      expect(output.counts.registrationCount).toBe(2)
      expect(output.counts.matchedRegistrations).toBe(1)
      expect(output.counts.registrationsWithoutFeedback).toBe(1)

      const registrationResults = await getRegistrationResults(sql, runId)
      expect(registrationResults).toHaveLength(2)
      expect(
        registrationResults.find((r) => r.registrationRecordId === matched.recordId)
          ?.status,
      ).toBe('matched')
      expect(
        registrationResults.find((r) => r.registrationRecordId === lonely.recordId)
          ?.status,
      ).toBe('without_feedback')

      const feedbackResults = await getFeedbackResults(sql, runId)
      expect(feedbackResults).toHaveLength(1)
      expect(feedbackResults[0]).toMatchObject({
        status: 'matched',
        matchMethod: 'manual_public_code',
        registrationRecordId: matched.recordId,
      })
    })

    it('keeps every run rather than overwriting the last', async () => {
      await seedRegistration()

      const first = await runReconciliation(sql, EVENT_ID)
      const second = await runReconciliation(sql, EVENT_ID)

      const runs = await listRuns(sql, EVENT_ID)
      expect(runs).toHaveLength(2)
      expect(runs.map((run) => run.runId).sort()).toEqual(
        [first.runId, second.runId].sort(),
      )
    })

    it('returns the most recent completed run as latest', async () => {
      await seedRegistration()
      await runReconciliation(sql, EVENT_ID)
      const second = await runReconciliation(sql, EVENT_ID)

      const latest = await getLatestCompletedRun(sql, EVENT_ID)

      expect(latest?.runId).toBe(second.runId)
      expect(latest?.engineVersion).toBe('reconciliation-v2')
    })

    it('never returns an incomplete run as latest', async () => {
      await seedRegistration()
      const completed = await runReconciliation(sql, EVENT_ID)

      // A run that was opened and never finished.
      const abandoned = randomUUID()
      await sql`
        INSERT INTO reconciliation_runs (run_id, event_id, engine_version, started_at)
        VALUES (${abandoned}, ${EVENT_ID}, 'reconciliation-v1', now() + interval '1 hour')
      `

      const latest = await getLatestCompletedRun(sql, EVENT_ID)

      expect(latest?.runId).toBe(completed.runId)
      expect(latest?.runId).not.toBe(abandoned)
    })

    it('keeps runs for different events apart', async () => {
      await seedRegistration()
      await seedRegistration({ eventId: OTHER_EVENT })

      const forEvent = await runReconciliation(sql, EVENT_ID)
      await runReconciliation(sql, OTHER_EVENT)

      expect((await getLatestCompletedRun(sql, EVENT_ID))?.runId).toBe(forEvent.runId)
      expect((await getRegistrationResults(sql, forEvent.runId))).toHaveLength(1)
    })

    it('leaves nothing behind when a run fails', async () => {
      /*
       * A foreign-key violation part-way through the inserts. The run row, the
       * results written before it and the completion stamp all roll back
       * together: a half-written run must never look like a finished one.
       */
      await seedRegistration()
      const before = await listRuns(sql, EVENT_ID)

      const orphanFeedback = randomUUID()
      await expect(
        sql.begin('isolation level repeatable read', async (tx) => {
          const runId = randomUUID()
          await tx`
            INSERT INTO reconciliation_runs (run_id, event_id, engine_version)
            VALUES (${runId}, ${EVENT_ID}, 'reconciliation-v1')
          `
          // References a feedback row that does not exist.
          await tx`
            INSERT INTO reconciliation_feedback_results
              (run_id, feedback_record_id, status)
            VALUES (${runId}, ${orphanFeedback}, 'without_registration')
          `
          await tx`
            UPDATE reconciliation_runs SET completed_at = now() WHERE run_id = ${runId}
          `
        }),
      ).rejects.toThrow()

      expect(await listRuns(sql, EVENT_ID)).toHaveLength(before.length)
    })
  })

  describe('raw records are evidence, never rewritten', () => {
    it('leaves registrations byte-for-byte unchanged', async () => {
      const registration = await seedRegistration()
      await seedFeedback({ publicCode: registration.publicCode })

      const before = await sql`SELECT * FROM registrations ORDER BY record_id`
      await runReconciliation(sql, EVENT_ID)
      const after = await sql`SELECT * FROM registrations ORDER BY record_id`

      expect(after).toEqual(before)
    })

    it('leaves feedback byte-for-byte unchanged', async () => {
      const registration = await seedRegistration()
      await seedFeedback({
        publicCode: registration.publicCode,
        participantId: registration.participantId,
        captureMethod: 'qr',
      })

      const before = await sql`SELECT * FROM feedback ORDER BY record_id`
      await runReconciliation(sql, EVENT_ID)
      const after = await sql`SELECT * FROM feedback ORDER BY record_id`

      expect(after).toEqual(before)
    })

    it('never fills in a manual capture participant id', async () => {
      // Reconciliation discovers the relationship; the raw record keeps saying
      // exactly what the device captured.
      const registration = await seedRegistration()
      const feedbackId = await seedFeedback({ publicCode: registration.publicCode })

      const { runId } = await runReconciliation(sql, EVENT_ID)

      const [row] = await sql<{ participant_id: string | null }[]>`
        SELECT participant_id FROM feedback WHERE record_id = ${feedbackId}
      `
      expect(row?.participant_id).toBeNull()

      // The derived result supplies the link instead.
      const results = await getFeedbackResults(sql, runId)
      expect(results[0]?.registrationRecordId).toBe(registration.recordId)
    })

    it('does not touch revisions or provenance', async () => {
      const registration = await seedRegistration()
      await runReconciliation(sql, EVENT_ID)

      const [row] = await sql<
        { revision: number; source_device_id: string; last_uploader_device_id: string }[]
      >`
        SELECT revision, source_device_id, last_uploader_device_id
        FROM registrations WHERE record_id = ${registration.recordId}
      `

      expect(row?.revision).toBe(1)
      expect(row?.source_device_id).toBe(DEVICE)
      expect(row?.last_uploader_device_id).toBe(DEVICE)
    })
  })

  describe('out-of-order arrival across runs', () => {
    it('resolves on a later run without altering the earlier one', async () => {
      const registration = await seedRegistration()
      const feedbackId = await seedFeedback({ publicCode: registration.publicCode })

      // Hide the registration from the first run by reconciling a different
      // event, then reveal it, simulating Point A syncing later.
      await sql`DELETE FROM registrations WHERE record_id = ${registration.recordId}`
      const first = await runReconciliation(sql, EVENT_ID)
      expect((await getFeedbackResults(sql, first.runId))[0]?.status).toBe(
        'without_registration',
      )

      await seedRegistration()
      await sql`
        UPDATE registrations SET public_code = ${registration.publicCode}
        WHERE public_code != ${registration.publicCode}
      `
      const second = await runReconciliation(sql, EVENT_ID)

      expect((await getFeedbackResults(sql, second.runId))[0]?.status).toBe('matched')
      // The first snapshot still says what was true when it ran.
      const firstResults = await getFeedbackResults(sql, first.runId)
      expect(firstResults[0]?.status).toBe('without_registration')
      expect(firstResults[0]?.feedbackRecordId).toBe(feedbackId)
    })
  })

  describe('duplicate candidates', () => {
    it('persists a candidate pair without copying contact details', async () => {
      const shared = { phone: '+91 98765 43210', email: 'Shared@Example.com' }
      const left = await seedRegistration(shared)
      const right = await seedRegistration({
        phone: '919876543210',
        email: ' shared@example.com ',
      })

      const { runId } = await runReconciliation(sql, EVENT_ID)
      const candidates = await getDuplicateCandidates(sql, runId)

      expect(candidates).toHaveLength(1)
      expect(candidates[0]?.matchBasis).toBe('phone_and_email')
      expect(
        [candidates[0]?.leftRegistrationRecordId, candidates[0]?.rightRegistrationRecordId].sort(),
      ).toEqual([left.recordId, right.recordId].sort())

      // The derived table holds references, not contact values.
      const columns = await sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'reconciliation_duplicate_registration_candidates'
      `
      const names = columns.map((row) => row.column_name)
      expect(names).not.toContain('phone')
      expect(names).not.toContain('email')
      expect(names).not.toContain('name')
    })

    it('keeps both registrations as independent records', async () => {
      const shared = { phone: '5550101234', email: 'dup@example.com' }
      await seedRegistration(shared)
      await seedRegistration(shared)

      await runReconciliation(sql, EVENT_ID)

      // Nothing merged, nothing deleted.
      expect((await sql`SELECT count(*) FROM registrations`)[0]?.['count']).toBe('2')
    })
  })

  describe('derived tables carry no participant data', () => {
    it('has no PII columns anywhere in the reconciliation schema', async () => {
      const columns = await sql<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name LIKE 'reconciliation%'
      `

      const forbidden = ['name', 'phone', 'email', 'answers', 'comments']
      for (const { column_name } of columns) {
        expect(forbidden).not.toContain(column_name)
      }
    })
  })
})
