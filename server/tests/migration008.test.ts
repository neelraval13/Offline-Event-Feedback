import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres, { type Sql } from 'postgres'

/*
 * Migration 008, applied to a schema that already holds an event's records.
 *
 * This is the only migration in the project that adds a CHECK constraint
 * validating rows that are already there, and the only one that relaxes a NOT
 * NULL. Both are the kind of change that is fine in every rehearsal and fails
 * once, on the one database that matters, because it holds a row nobody
 * remembered.
 *
 * So this suite does what a rehearsal cannot: it builds a database through
 * migration 007, fills it with representative qr and manual rows exactly as the
 * previous build wrote them, and only then applies 008. What it proves is that
 * the migration is safe to run *before* the new application is deployed, which
 * is the order an operator will actually use.
 *
 * Skipped unless a scratch database is configured. It creates and drops
 * schemas, so never point it at a database holding an event:
 *
 *   MIGRATION_TEST_DATABASE_URL=postgres://localhost:5432/oef_migration_test \
 *     pnpm server:test
 */

const DATABASE_URL = process.env['MIGRATION_TEST_DATABASE_URL']
const describeDb = DATABASE_URL === undefined ? describe.skip : describe

if (DATABASE_URL === undefined) {
  console.info(
    'migration 008 tests: skipped (set MIGRATION_TEST_DATABASE_URL to run)',
  )
}

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const EVENT_ID = 'evt-migration-008'
const DEVICE = '11111111-2222-4333-8444-555555555555'

let sql: Sql

/** Every migration file up to and including `last`, in order. */
function migrationsThrough(last: string): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => name <= last)
}

async function apply(files: readonly string[]): Promise<void> {
  for (const file of files) {
    await sql.unsafe(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
}

const MIGRATION_008 = '008_feedback_contact_identity.sql'

/**
 * A database as it stood before this change: migrations 001 to 007 only.
 *
 * Rebuilt from nothing for each test rather than rolled back, because the point
 * is to exercise the real DDL against a real prior schema. A mocked "old"
 * schema would prove only that the mock matches the assumption.
 */
async function buildPreviousSchema(): Promise<void> {
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await apply(migrationsThrough('007_campaign_registration_fields.sql'))
}

/** A registration, as the previous build wrote one. */
async function seedRegistration(): Promise<{
  recordId: string
  participantId: string
  publicCode: string
}> {
  const record = {
    recordId: randomUUID(),
    participantId: randomUUID(),
    publicCode: `A1-B8EFD9-${String(Math.floor(Math.random() * 89999) + 10000)}-X`,
  }

  await sql`
    INSERT INTO registrations (
      record_id, participant_id, public_code,
      event_id, event_day, station_id, source_device_id,
      name, phone, email,
      created_at, updated_at, revision,
      first_received_at, last_received_at, last_uploader_device_id,
      content_changed_at
    ) VALUES (
      ${record.recordId}, ${record.participantId}, ${record.publicCode},
      ${EVENT_ID}, '2026-08-23', 'A1', ${DEVICE},
      'Ada Lovelace', '9876543210', 'ada@example.com',
      '2026-08-23T09:00:00Z', '2026-08-23T09:00:00Z', 1,
      now(), now(), ${DEVICE}, now()
    )
  `

  return record
}

/** A response, in the only two shapes the previous build could produce. */
async function seedLegacyFeedback(options: {
  captureMethod: 'qr' | 'manual'
  publicCode: string
  participantId?: string
}): Promise<string> {
  const recordId = randomUUID()

  await sql`
    INSERT INTO feedback (
      record_id, participant_id, public_code, capture_method,
      event_id, event_day, station_id, source_device_id,
      form_version, answers,
      created_at, updated_at, revision,
      first_received_at, last_received_at, last_uploader_device_id,
      content_changed_at
    ) VALUES (
      ${recordId}, ${options.participantId ?? null}, ${options.publicCode},
      ${options.captureMethod},
      ${EVENT_ID}, '2026-08-23', 'B1', ${DEVICE},
      'flying-flea-feedback-v1',
      ${sql.json({
        testRideExperience: 6,
        rotaryKnobUsage: 5,
        rideModesExperience: 6,
        overallExperienceRating: 7,
      })},
      '2026-08-23T11:00:00Z', '2026-08-23T11:00:00Z', 1,
      now(), now(), ${DEVICE}, now()
    )
  `

  return recordId
}

/** Runs one statement and returns the error message, or null on success. */
async function attempt(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describeDb('migration 008 against a populated schema', () => {
  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 2, onnotice: () => {} })
  })

  afterAll(async () => {
    await sql?.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await buildPreviousSchema()
  })

  it('applies cleanly over existing qr and manual rows', async () => {
    /*
     * The scenario the migration will actually meet: an event's records already
     * in the table, written by the build that is still running.
     */
    const rider = await seedRegistration()
    await seedLegacyFeedback({
      captureMethod: 'qr',
      publicCode: rider.publicCode,
      participantId: rider.participantId,
    })
    await seedLegacyFeedback({
      captureMethod: 'manual',
      publicCode: rider.publicCode,
    })

    expect(await attempt(() => apply([MIGRATION_008]))).toBeNull()
  })

  it('rewrites not one existing row', async () => {
    const rider = await seedRegistration()
    const scanned = await seedLegacyFeedback({
      captureMethod: 'qr',
      publicCode: rider.publicCode,
      participantId: rider.participantId,
    })

    const before = await sql`SELECT * FROM feedback WHERE record_id = ${scanned}`
    await apply([MIGRATION_008])
    const after = await sql`SELECT * FROM feedback WHERE record_id = ${scanned}`

    const row = after[0] as Record<string, unknown>
    // Every column that existed before holds exactly what it held.
    for (const [key, value] of Object.entries(before[0] as Record<string, unknown>)) {
      expect(row[key]).toEqual(value)
    }
    // And the new ones are NULL, not defaulted to anything.
    expect(row['respondent_name']).toBeNull()
    expect(row['respondent_phone']).toBeNull()
    expect(row['respondent_email']).toBeNull()
  })

  it('is re-runnable, so a repeated apply is not a failure', async () => {
    // Production applies each file once, through the ledger in migrate.ts. An
    // operator re-running the directory by hand should not be punished for it.
    await apply([MIGRATION_008])

    expect(await attempt(() => apply([MIGRATION_008]))).toBeNull()
  })

  it('is re-runnable against a database that has since collected contact rows', async () => {
    /*
     * The defect this pins, which the first version of this migration had.
     *
     * Its pre-check listed only the two shapes the previous schema could
     * produce, which is correct exactly once. Re-run against a database that
     * had been live for a day, it reported every legitimate contact response as
     * corruption and refused to proceed, with a message telling the operator
     * their data was malformed. Found by re-running the suite against a scratch
     * database that still held rows from the previous run: the second apply is
     * the ordinary case, not the exotic one.
     */
    await apply([MIGRATION_008])
    await sql`
      INSERT INTO feedback (
        record_id, participant_id, public_code, capture_method,
        respondent_name, respondent_phone, respondent_email,
        event_id, event_day, station_id, source_device_id,
        form_version, answers,
        created_at, updated_at, revision,
        first_received_at, last_received_at, last_uploader_device_id,
        content_changed_at
      ) VALUES (
        ${randomUUID()}, NULL, NULL, 'contact',
        'Grace Hopper', '9876543210', 'grace@example.com',
        ${EVENT_ID}, '2026-08-23', 'B1', ${DEVICE},
        'feedback-v1', ${sql.json({ overall_rating: 4 })},
        '2026-08-23T11:00:00Z', '2026-08-23T11:00:00Z', 1,
        now(), now(), ${DEVICE}, now()
      )
    `

    expect(await attempt(() => apply([MIGRATION_008]))).toBeNull()
  })

  it('fails loudly, and changes nothing, if a hybrid row already exists', async () => {
    /*
     * This should be impossible: the wire contract has enforced the identity
     * shape on every record since the first deployment. If it ever happens, the
     * operator needs to know how many rows and what is wrong with them, not a
     * bare constraint-violation message naming one row.
     *
     * The whole migration rolls back, so a failure leaves the schema exactly as
     * it was and the deployment can be stopped rather than half-done.
     */
    const rider = await seedRegistration()
    await sql`
      INSERT INTO feedback (
        record_id, participant_id, public_code, capture_method,
        event_id, event_day, station_id, source_device_id,
        form_version, answers,
        created_at, updated_at, revision,
        first_received_at, last_received_at, last_uploader_device_id,
        content_changed_at
      ) VALUES (
        ${randomUUID()}, NULL, ${rider.publicCode}, 'qr',
        ${EVENT_ID}, '2026-08-23', 'B1', ${DEVICE},
        'feedback-v1', ${sql.json({ overall_rating: 4 })},
        '2026-08-23T11:00:00Z', '2026-08-23T11:00:00Z', 1,
        now(), now(), ${DEVICE}, now()
      )
    `

    const message = await attempt(() => apply([MIGRATION_008]))

    expect(message).toContain('migration 008')
    expect(message).toContain('1 existing feedback row')
    // Nothing changed: the columns were never added.
    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'feedback' AND column_name = 'respondent_name'
    `
    expect(columns).toHaveLength(0)
  })
})

describeDb('the identity shape the database enforces', () => {
  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 2, onnotice: () => {} })
  })

  afterAll(async () => {
    await sql?.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await buildPreviousSchema()
    await apply([MIGRATION_008])
  })

  /** Inserts a feedback row with whatever identity the caller names. */
  async function insertFeedback(identity: {
    participantId?: string | null
    publicCode?: string | null
    captureMethod: string
    respondentName?: string | null
    respondentPhone?: string | null
    respondentEmail?: string | null
  }): Promise<string | null> {
    return attempt(
      () => sql`
        INSERT INTO feedback (
          record_id, participant_id, public_code, capture_method,
          respondent_name, respondent_phone, respondent_email,
          event_id, event_day, station_id, source_device_id,
          form_version, answers,
          created_at, updated_at, revision,
          first_received_at, last_received_at, last_uploader_device_id,
          content_changed_at
        ) VALUES (
          ${randomUUID()}, ${identity.participantId ?? null},
          ${identity.publicCode ?? null}, ${identity.captureMethod},
          ${identity.respondentName ?? null}, ${identity.respondentPhone ?? null},
          ${identity.respondentEmail ?? null},
          ${EVENT_ID}, '2026-08-23', 'B1', ${DEVICE},
          'feedback-v1', ${sql.json({ overall_rating: 4 })},
          '2026-08-23T11:00:00Z', '2026-08-23T11:00:00Z', 1,
          now(), now(), ${DEVICE}, now()
        )
      `,
    )
  }

  const CONTACT = {
    respondentName: 'Grace Hopper',
    respondentPhone: '9876543210',
    respondentEmail: 'grace@example.com',
  }

  it('accepts a contact row', async () => {
    expect(
      await insertFeedback({ captureMethod: 'contact', ...CONTACT }),
    ).toBeNull()
  })

  it('still accepts the two sticker shapes', async () => {
    const rider = await seedRegistration()

    expect(
      await insertFeedback({
        captureMethod: 'qr',
        participantId: rider.participantId,
        publicCode: rider.publicCode,
      }),
    ).toBeNull()
    expect(
      await insertFeedback({
        captureMethod: 'manual',
        publicCode: rider.publicCode,
      }),
    ).toBeNull()
  })

  /*
   * The hybrids. Application validation already refuses all of these twice, on
   * the wire and in the backup validator, and this is deliberately a third
   * copy: those two protect the paths we know about, and this protects the
   * table from a future migration, a manual correction typed into psql at an
   * event, or a bug in a build nobody has written yet.
   */
  it.each([
    [
      'a contact row carrying a public code',
      { captureMethod: 'contact', publicCode: 'A1-B8EFD9-00001-X', ...CONTACT },
    ],
    [
      'a contact row carrying a participant id',
      { captureMethod: 'contact', participantId: randomUUID(), ...CONTACT },
    ],
    [
      'a contact row missing its email',
      {
        captureMethod: 'contact',
        respondentName: CONTACT.respondentName,
        respondentPhone: CONTACT.respondentPhone,
      },
    ],
    [
      'a contact row with no respondent details at all',
      { captureMethod: 'contact' },
    ],
    [
      'a qr row with no participant id',
      { captureMethod: 'qr', publicCode: 'A1-B8EFD9-00001-X' },
    ],
    [
      'a qr row with no public code',
      { captureMethod: 'qr', participantId: randomUUID() },
    ],
    [
      'a qr row carrying respondent details',
      {
        captureMethod: 'qr',
        participantId: randomUUID(),
        publicCode: 'A1-B8EFD9-00001-X',
        ...CONTACT,
      },
    ],
    [
      'a manual row with a participant id',
      {
        captureMethod: 'manual',
        participantId: randomUUID(),
        publicCode: 'A1-B8EFD9-00001-X',
      },
    ],
    [
      'a manual row with no public code',
      { captureMethod: 'manual' },
    ],
    [
      'a capture method the schema has never heard of',
      { captureMethod: 'telepathy', publicCode: 'A1-B8EFD9-00001-X' },
    ],
  ])('refuses %s', async (_label, identity) => {
    const message = await insertFeedback(identity)

    expect(message).toContain('feedback_identity_shape')
  })
})

describeDb('the reconciliation schema after migration 008', () => {
  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 2, onnotice: () => {} })
  })

  afterAll(async () => {
    await sql?.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await buildPreviousSchema()
    await apply([MIGRATION_008])
  })

  async function insertRun(): Promise<string> {
    const runId = randomUUID()
    await sql`
      INSERT INTO reconciliation_runs (run_id, event_id, engine_version, completed_at)
      VALUES (${runId}, ${EVENT_ID}, 'reconciliation-v2', now())
    `
    return runId
  }

  it('accepts the standalone status and the contact match method', async () => {
    const runId = await insertRun()
    const rider = await seedRegistration()
    const feedbackId = await seedLegacyFeedback({
      captureMethod: 'manual',
      publicCode: rider.publicCode,
    })

    expect(
      await attempt(
        () => sql`
          INSERT INTO reconciliation_feedback_results
            (run_id, feedback_record_id, registration_record_id, status, match_method)
          VALUES (${runId}, ${feedbackId}, NULL, 'standalone', NULL)
        `,
      ),
    ).toBeNull()
  })

  it('still accepts every status it accepted before', async () => {
    const runId = await insertRun()
    const rider = await seedRegistration()

    for (const status of [
      'matched',
      'without_registration',
      'identity_conflict',
      'multiple_feedback',
    ]) {
      const feedbackId = await seedLegacyFeedback({
        captureMethod: 'manual',
        publicCode: rider.publicCode,
      })
      expect(
        await attempt(
          () => sql`
            INSERT INTO reconciliation_feedback_results
              (run_id, feedback_record_id, registration_record_id, status, match_method)
            VALUES (${runId}, ${feedbackId}, NULL, ${status}, NULL)
          `,
        ),
      ).toBeNull()
    }
  })

  it('refuses a status nobody has defined', async () => {
    const runId = await insertRun()
    const rider = await seedRegistration()
    const feedbackId = await seedLegacyFeedback({
      captureMethod: 'manual',
      publicCode: rider.publicCode,
    })

    const message = await attempt(
      () => sql`
        INSERT INTO reconciliation_feedback_results
          (run_id, feedback_record_id, registration_record_id, status, match_method)
        VALUES (${runId}, ${feedbackId}, NULL, 'probably_fine', NULL)
      `,
    )

    expect(message).toContain('status_check')
  })

  it('defaults the standalone count to zero on a historical run', async () => {
    /*
     * Historical runs stay valid rows and are never re-classified. They were
     * produced by an engine that could not classify anything as standalone, so
     * zero is the true count for them rather than a placeholder.
     */
    const runId = await insertRun()
    const [row] = await sql<{ standalone_feedback: number }[]>`
      SELECT standalone_feedback FROM reconciliation_runs WHERE run_id = ${runId}
    `

    expect(Number(row?.standalone_feedback)).toBe(0)
  })

  it('exposes the new count through the latest-runs view', async () => {
    /*
     * The view was defined as `SELECT *`, which Postgres expands and freezes at
     * creation time. Without recreating it the column would exist on the table
     * and be invisible through the view, so every latest-run lookup would read
     * `undefined` and report NaN while the table held the right number, and
     * nothing would have failed loudly.
     */
    const runId = await insertRun()
    await sql`
      UPDATE reconciliation_runs SET standalone_feedback = 7 WHERE run_id = ${runId}
    `

    const [row] = await sql<{ standalone_feedback: number }[]>`
      SELECT standalone_feedback FROM reconciliation_latest_runs
      WHERE event_id = ${EVENT_ID}
    `

    expect(Number(row?.standalone_feedback)).toBe(7)
  })
})
