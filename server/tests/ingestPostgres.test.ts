import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres, { type Sql } from 'postgres'
import type { Hono } from 'hono'
import { createApp } from '../app'
import { createPostgresStore } from '../db/postgresStore'
import { FLYING_FLEA_FORM_VERSION } from '../../shared/campaign/flyingFlea'
import type {
  SyncBatch,
  SyncBatchResponse,
  SyncRecordResult,
} from '../../shared/sync/protocol'
import { batch, DEVICE_A, EVENT_ID, feedback, registration } from './fixtures'

/*
 * Ingest against a real Postgres.
 *
 * `api.test.ts` proves the merge semantics exhaustively against an in-memory
 * store, which is fast and complete about the rules — and cannot prove a single
 * line of SQL. This suite exists for the things only a database can answer:
 * that a column holds what we think it holds, and that a record read back out of
 * it compares equal to the one that went in.
 *
 * The specific failure it was written for: `mapFeedback` hardcoded
 * `formVersion: 'feedback-v1'`. Every campaign response therefore read back as
 * the wrong questionnaire, so an identical re-delivery — the most ordinary event
 * in this system — compared as a content change and came back `conflict`. The
 * device would have retried it forever. Nothing in the memory-store suite could
 * see it, because the memory store never round-trips through a column.
 *
 * Skipped unless a scratch database is configured. It deletes rows, so never
 * point it at a database holding an event:
 *
 *   SYNC_TEST_DATABASE_URL=postgres://localhost:5432/oef_sync_test pnpm server:test
 */

const DATABASE_URL = process.env['SYNC_TEST_DATABASE_URL']
const describeDb = DATABASE_URL === undefined ? describe.skip : describe

if (DATABASE_URL === undefined) {
  console.info(
    'ingest Postgres tests: skipped (set SYNC_TEST_DATABASE_URL to run)',
  )
}

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const ENROLLMENT_SECRET = 'ingest-postgres-enrolment-secret'

const CAMPAIGN_ANSWERS = {
  testRideExperience: 7,
  rotaryKnobUsage: 6,
  rideModesExperience: 5,
  overallExperienceRating: 7,
  topThreeFeatures: 'Torque, brakes, the silence',
  overallExperienceComments: 'Brilliant',
} as const

let sql: Sql
let app: Hono

async function applyMigrations(): Promise<void> {
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await sql.unsafe(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
}

async function enrolledToken(): Promise<string> {
  const response = await app.request('/v1/sync/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: EVENT_ID,
      deviceId: DEVICE_A,
      enrollmentSecret: ENROLLMENT_SECRET,
    }),
  })
  const body = (await response.json()) as { deviceToken: string }
  return body.deviceToken
}

async function postBatch(
  token: string,
  payload: SyncBatch,
): Promise<SyncBatchResponse> {
  const response = await app.request('/v1/sync/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  return (await response.json()) as SyncBatchResponse
}

function statusOf(body: SyncBatchResponse, recordId: string): SyncRecordResult {
  const found = body.results.find((result) => result.recordId === recordId)
  if (found === undefined) {
    throw new Error('no result for record')
  }
  return found
}

describeDb('ingest against Postgres', () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 4, onnotice: () => {} })
    await applyMigrations()
    app = createApp({
      store: createPostgresStore(sql),
      enrollmentSecret: ENROLLMENT_SECRET,
      allowedOrigins: ['http://localhost:5173'],
      log: () => {},
    })
  })

  afterAll(async () => {
    await sql?.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await sql`DELETE FROM reconciliation_duplicate_registration_candidates`
    await sql`DELETE FROM reconciliation_feedback_results`
    await sql`DELETE FROM reconciliation_registration_results`
    await sql`DELETE FROM reconciliation_runs`
    await sql`DELETE FROM feedback`
    await sql`DELETE FROM registrations`
    await sql`DELETE FROM sync_batches`
    await sql`DELETE FROM sync_devices`
  })

  describe('campaign feedback', () => {
    it('stores the questionnaire it was sent', async () => {
      const token = await enrolledToken()
      const record = feedback({
        formVersion: FLYING_FLEA_FORM_VERSION,
        answers: CAMPAIGN_ANSWERS,
      })

      const body = await postBatch(token, batch([record]))
      expect(statusOf(body, record.recordId).status).toBe('accepted')

      const [row] = await sql<{ form_version: string; answers: unknown }[]>`
        SELECT form_version, answers FROM feedback WHERE record_id = ${record.recordId}
      `

      expect(row?.form_version).toBe(FLYING_FLEA_FORM_VERSION)
      expect(row?.answers).toEqual(CAMPAIGN_ANSWERS)
    })

    it('reports an identical campaign response as already current, not a conflict', async () => {
      /*
       * The regression. Reading the row back with the wrong questionnaire made
       * the stored record compare unequal to the one being re-sent, which ingest
       * correctly called a conflict — for a record that had not changed at all.
       */
      const token = await enrolledToken()
      const record = feedback({
        formVersion: FLYING_FLEA_FORM_VERSION,
        answers: CAMPAIGN_ANSWERS,
      })

      await postBatch(token, batch([record]))
      const second = await postBatch(token, batch([record]))

      expect(statusOf(second, record.recordId)).toMatchObject({
        status: 'already_current',
        serverRevision: 1,
      })
      expect(statusOf(second, record.recordId).status).not.toBe('conflict')
    })

    it('survives the lost-response shape', async () => {
      /*
       * The batch commits, the reply never reaches the tablet — a dropped
       * connection, a tab closed, a device carried out of range. The record is
       * still `pending` locally, so the outbox sends it again. That retry must
       * be recognised, not fought.
       */
      const token = await enrolledToken()
      const record = feedback({
        formVersion: FLYING_FLEA_FORM_VERSION,
        answers: CAMPAIGN_ANSWERS,
      })

      // First delivery: the server commits. The client never sees this.
      await postBatch(token, batch([record]))

      // The same records, a fresh batch id, as the outbox would rebuild it.
      const retry = await postBatch(token, batch([record]))

      expect(statusOf(retry, record.recordId).status).toBe('already_current')

      const rows = await sql<{ form_version: string; answers: unknown }[]>`
        SELECT form_version, answers FROM feedback WHERE record_id = ${record.recordId}
      `
      // One row, unchanged, still the campaign questionnaire.
      expect(rows).toHaveLength(1)
      expect(rows[0]?.form_version).toBe(FLYING_FLEA_FORM_VERSION)
      expect(rows[0]?.answers).toEqual(CAMPAIGN_ANSWERS)
    })

    it('keeps the two questionnaires distinguishable in the same event', async () => {
      const token = await enrolledToken()
      const campaign = feedback({
        formVersion: FLYING_FLEA_FORM_VERSION,
        answers: CAMPAIGN_ANSWERS,
      })
      const legacy = feedback()

      await postBatch(token, batch([campaign, legacy]))

      const rows = await sql<{ record_id: string; form_version: string }[]>`
        SELECT record_id, form_version FROM feedback ORDER BY form_version
      `

      expect(rows.map((row) => row.form_version)).toEqual([
        'feedback-v1',
        FLYING_FLEA_FORM_VERSION,
      ])

      // And both re-deliver cleanly.
      const retry = await postBatch(token, batch([campaign, legacy]))
      expect(statusOf(retry, campaign.recordId).status).toBe('already_current')
      expect(statusOf(retry, legacy.recordId).status).toBe('already_current')
    })
  })

  describe('campaign registrations', () => {
    const CAMPAIGN = {
      vehicle: 'Vehicle 2',
      interestedColour: 'Storm Black' as const,
      location: 'Prestige Tech Park',
      gender: 'Female' as const,
      testRideAt: '2026-01-01T10:30',
      drivingLicence: 'KA0120200001234',
      pincode: '560048',
    }

    it('stores every campaign column and re-delivers as already current', async () => {
      const token = await enrolledToken()
      const record = registration(CAMPAIGN)

      await postBatch(token, batch([record]))

      const [row] = await sql<Record<string, unknown>[]>`
        SELECT vehicle, interested_colour, location, gender,
               test_ride_at, driving_licence, pincode
        FROM registrations WHERE record_id = ${record.recordId}
      `
      expect(row).toMatchObject({
        vehicle: CAMPAIGN.vehicle,
        interested_colour: CAMPAIGN.interestedColour,
        location: CAMPAIGN.location,
        gender: CAMPAIGN.gender,
        test_ride_at: CAMPAIGN.testRideAt,
        driving_licence: CAMPAIGN.drivingLicence,
        pincode: CAMPAIGN.pincode,
      })

      const retry = await postBatch(token, batch([record]))
      expect(statusOf(retry, record.recordId).status).toBe('already_current')
    })

    it('accepts a registration from a build that has no campaign fields', async () => {
      // A tablet still running a pre-campaign build, or a record captured
      // before the campaign and only now reaching the server.
      const token = await enrolledToken()
      const record = registration()

      const body = await postBatch(token, batch([record]))
      expect(statusOf(body, record.recordId).status).toBe('accepted')

      const [row] = await sql<{ vehicle: string | null }[]>`
        SELECT vehicle FROM registrations WHERE record_id = ${record.recordId}
      `
      // NULL, not a default: nobody asked this rider which bike they took.
      expect(row?.vehicle).toBeNull()
    })

    it('clears an optional campaign field when a correction omits it', async () => {
      /*
       * An operator deleted the pincode and saved. The correction is a new
       * revision carrying no pincode at all, and the central column must end up
       * NULL — not still holding the old value, which would make the report and
       * the device disagree about what the rider gave.
       */
      const token = await enrolledToken()
      const record = registration(CAMPAIGN)
      await postBatch(token, batch([record]))

      const { pincode: _cleared, ...withoutPincode } = CAMPAIGN
      const corrected = {
        ...registration({ ...withoutPincode }),
        recordId: record.recordId,
        participantId: record.participantId,
        publicCode: record.publicCode,
        createdAt: record.createdAt,
        updatedAt: '2026-01-01T09:30:00.000Z',
        revision: 2,
      }

      const body = await postBatch(token, batch([corrected]))
      expect(statusOf(body, record.recordId)).toMatchObject({
        status: 'accepted',
        serverRevision: 2,
      })

      const [row] = await sql<{ pincode: string | null; vehicle: string }[]>`
        SELECT pincode, vehicle FROM registrations WHERE record_id = ${record.recordId}
      `
      expect(row?.pincode).toBeNull()
      // The fields the correction did not touch are untouched.
      expect(row?.vehicle).toBe(CAMPAIGN.vehicle)

      // And the corrected record re-delivers cleanly rather than conflicting.
      const retry = await postBatch(token, batch([corrected]))
      expect(statusOf(retry, record.recordId).status).toBe('already_current')
    })
  })
})
