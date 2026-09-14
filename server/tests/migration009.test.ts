import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres, { type Sql } from 'postgres'

/*
 * Migration 009, applied to a schema that already holds the August event.
 *
 * The September event runs in two cities on one day, so a response has to
 * record which one it came from. This migration adds that column, and almost
 * everything that could go wrong with it is about the rows that are already
 * there.
 *
 * Three properties, in order of how badly each would hurt:
 *
 *   1. it does not rewrite a single historical row. `location` is NULL on every
 *      August response and stays NULL, because NULL means "not captured" and a
 *      backfilled venue would be indistinguishable from a recorded one forever
 *      after.
 *   2. it is safe to apply BEFORE the new build is deployed. The column is
 *      nullable with no default, so the running build's INSERT statements, none
 *      of which mention it, keep working.
 *   3. it leaves the identity CHECK from migration 008 exactly as it stands. A
 *      location says where a desk was, not who a rider is, so it is not part of
 *      any identity shape.
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
    'migration 009 tests: skipped (set MIGRATION_TEST_DATABASE_URL to run)',
  )
}

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const EVENT_ID = 'evt-migration-009'
const DEVICE = '11111111-2222-4333-8444-555555555555'
const MIGRATION_009 = '009_feedback_location.sql'

let sql: Sql

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

/**
 * The schema as it stood before this change: migrations 001 to 008 only.
 *
 * Rebuilt from nothing for each test rather than rolled back, because the point
 * is to exercise the real DDL against a real prior schema. A mocked "old"
 * schema would prove only that the mock matches the assumption.
 */
async function buildPreviousSchema(): Promise<void> {
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await apply(migrationsThrough('008_feedback_contact_identity.sql'))
}

/** A response in one of the three shapes the previous build could write. */
async function seedAugustFeedback(
  options:
    | { captureMethod: 'qr'; publicCode: string; participantId: string }
    | { captureMethod: 'manual'; publicCode: string }
    | { captureMethod: 'contact' },
): Promise<string> {
  const recordId = randomUUID()
  const contact = options.captureMethod === 'contact'

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
      ${recordId},
      ${'participantId' in options ? options.participantId : null},
      ${'publicCode' in options ? options.publicCode : null},
      ${options.captureMethod},
      ${contact ? 'Grace Hopper' : null},
      ${contact ? '9876543210' : null},
      ${contact ? 'grace@example.com' : null},
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

function code(): string {
  return `A1-B8EFD9-${String(Math.floor(Math.random() * 89999) + 10000)}-X`
}

describeDb('migration 009 against a populated schema', () => {
  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 2, onnotice: () => {} })
  })

  afterAll(async () => {
    await sql?.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await buildPreviousSchema()
  })

  it('applies cleanly over an event’s existing responses', async () => {
    const publicCode = code()
    await seedAugustFeedback({
      captureMethod: 'qr',
      publicCode,
      participantId: randomUUID(),
    })
    await seedAugustFeedback({ captureMethod: 'manual', publicCode: code() })
    await seedAugustFeedback({ captureMethod: 'contact' })

    await apply([MIGRATION_009])

    const [row] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM feedback`
    expect(row?.n).toBe('3')
  })

  it('leaves every historical row with no location', async () => {
    /*
     * The property that matters most, and the one that is easy to "improve"
     * away. August ran at Richardson & Cruddas, so a backfill would even be
     * true. It would still be a value nobody captured, written into a column
     * whose entire purpose is to say what was captured, and afterwards nothing
     * could tell an inferred venue from a recorded one.
     */
    await seedAugustFeedback({
      captureMethod: 'qr',
      publicCode: code(),
      participantId: randomUUID(),
    })
    await seedAugustFeedback({ captureMethod: 'contact' })

    await apply([MIGRATION_009])

    const rows = await sql<{ location: string | null }[]>`
      SELECT location FROM feedback
    `
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.location).toBeNull()
    }

    // And specifically not the August venue, under any spelling.
    const [invented] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM feedback WHERE location IS NOT NULL
    `
    expect(invented?.n).toBe('0')
  })

  it('adds a nullable column with no default', async () => {
    /*
     * What makes it safe to apply before the new deployment: every INSERT the
     * running build issues, none of which mentions this column, keeps working.
     */
    await apply([MIGRATION_009])

    const [column] = await sql<
      { data_type: string; is_nullable: string; column_default: string | null }[]
    >`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'feedback' AND column_name = 'location'
    `

    expect(column?.data_type).toBe('text')
    expect(column?.is_nullable).toBe('YES')
    expect(column?.column_default).toBeNull()
  })

  it('lets the previous build keep inserting, unchanged', async () => {
    // The literal ordering question: migration first, deployment second.
    await apply([MIGRATION_009])

    const recordId = await seedAugustFeedback({
      captureMethod: 'manual',
      publicCode: code(),
    })

    const [row] = await sql<{ location: string | null }[]>`
      SELECT location FROM feedback WHERE record_id = ${recordId}
    `
    expect(row?.location).toBeNull()
  })

  it('creates the index reporting groups by', async () => {
    await apply([MIGRATION_009])

    const [index] = await sql<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'feedback' AND indexname = 'feedback_event_location_idx'
    `

    // Event first, city second: every location question is asked within one
    // event, and that order also lets the same index serve a plain event scan.
    expect(index?.indexdef).toContain('(event_id, location)')
  })

  it('leaves the identity constraint from migration 008 untouched', async () => {
    /*
     * A location is not identity, so this migration must not go near the CHECK
     * that decides which combinations of identity fields are legal. Asserted by
     * behaviour rather than by reading the definition: the constraint must still
     * refuse the dangerous shape it was added for.
     */
    await apply([MIGRATION_009])

    const [constraint] = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'feedback'::regclass AND conname = 'feedback_identity_shape'
    `
    expect(constraint?.conname).toBe('feedback_identity_shape')

    // A contact row carrying a public code is still refused.
    let message: string | null = null
    try {
      await sql`
        INSERT INTO feedback (
          record_id, participant_id, public_code, capture_method,
          respondent_name, respondent_phone, respondent_email,
          event_id, event_day, station_id, source_device_id,
          form_version, answers, created_at, updated_at, revision,
          first_received_at, last_received_at, last_uploader_device_id,
          content_changed_at, location
        ) VALUES (
          ${randomUUID()}, NULL, ${code()}, 'contact',
          'Grace Hopper', '9876543210', 'grace@example.com',
          ${EVENT_ID}, '2026-09-20', 'B1', ${DEVICE},
          'flying-flea-feedback-v1', ${sql.json({})},
          now(), now(), 1, now(), now(), ${DEVICE}, now(), 'Bengaluru'
        )
      `
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('feedback_identity_shape')
  })

  it('accepts a September response carrying a city, on every capture method', async () => {
    await apply([MIGRATION_009])

    for (const city of ['Bengaluru', 'Hyderabad']) {
      const recordId = randomUUID()
      await sql`
        INSERT INTO feedback (
          record_id, participant_id, public_code, capture_method,
          event_id, event_day, station_id, source_device_id,
          form_version, answers, created_at, updated_at, revision,
          first_received_at, last_received_at, last_uploader_device_id,
          content_changed_at, location
        ) VALUES (
          ${recordId}, NULL, ${code()}, 'manual',
          ${EVENT_ID}, '2026-09-20', 'B1', ${DEVICE},
          'flying-flea-feedback-v1', ${sql.json({})},
          now(), now(), 1, now(), now(), ${DEVICE}, now(), ${city}
        )
      `

      const [row] = await sql<{ location: string | null }[]>`
        SELECT location FROM feedback WHERE record_id = ${recordId}
      `
      expect(row?.location).toBe(city)
    }
  })

  it('is re-runnable, as every migration in this directory is', async () => {
    /*
     * The ledger applies each file once in production, but the test suites
     * replay the whole directory into a scratch database that may already be
     * migrated. A migration that only works on a virgin schema is one nobody
     * can safely re-run at the moment they most need to.
     */
    await seedAugustFeedback({ captureMethod: 'manual', publicCode: code() })

    await apply([MIGRATION_009])
    await apply([MIGRATION_009])
    await apply([MIGRATION_009])

    const [row] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM feedback`
    expect(row?.n).toBe('1')

    const [index] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM pg_indexes
      WHERE indexname = 'feedback_event_location_idx'
    `
    expect(index?.n).toBe('1')
  })

  it('does not touch registrations, whose location predates this change', async () => {
    /*
     * `registrations.location` arrived in migration 007 and is unrelated. This
     * migration must not redefine it, reindex it, or otherwise disturb a column
     * that is already carrying an event's data.
     */
    const before = await sql<{ data_type: string; is_nullable: string }[]>`
      SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'registrations' AND column_name = 'location'
    `

    await apply([MIGRATION_009])

    const after = await sql<{ data_type: string; is_nullable: string }[]>`
      SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'registrations' AND column_name = 'location'
    `

    expect(after).toEqual(before)
  })
})
