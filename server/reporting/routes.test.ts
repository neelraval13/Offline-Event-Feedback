import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import postgres, { type Sql } from 'postgres'
import { Hono } from 'hono'
import { runReconciliation } from '../reconciliation/postgres'
import { createPostgresStore } from '../db/postgresStore'
import type { SyncStore } from '../sync/store'
import { createReportingRoutes } from './routes'

/*
 * The reporting API against a real Postgres.
 *
 * The pure suites prove the rules; only a real database proves the joins, the
 * keyset pagination and that a `multiple_feedback` registration really does come
 * back without an answer attached.
 *
 * Skipped when no database is configured:
 *
 *   REPORTING_TEST_DATABASE_URL=postgres://localhost:5432/oef_report_test \
 *     pnpm server:test
 */

const DATABASE_URL = process.env['REPORTING_TEST_DATABASE_URL']
const describeDb = DATABASE_URL === undefined ? describe.skip : describe

if (DATABASE_URL === undefined) {
  console.info(
    'reporting Postgres tests: skipped (set REPORTING_TEST_DATABASE_URL to run)',
  )
}

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const EVENT_ID = 'evt-test-reporting'
const DEVICE = '11111111-2222-4333-8444-555555555555'
const SECRET = randomBytes(32).toString('hex')
const AUTH = { Authorization: `Bearer ${SECRET}` }

let sql: Sql
let store: SyncStore
let app: Hono
let logLines: string[] = []

function mount(adminSecret: string | undefined): Hono {
  const host = new Hono()
  host.route(
    '/v1/reporting',
    createReportingRoutes({
      sql,
      adminSecret,
      log: (line) => logLines.push(line),
      now: () => new Date('2026-02-01T08:00:00.000Z'),
    }),
  )
  return host
}

async function applyMigrations(): Promise<void> {
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await sql.unsafe(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
}

let codeSequence = 0

interface SeededRegistration {
  recordId: string
  participantId: string
  publicCode: string
}

/** The campaign answers a registration may carry. All optional. */
interface CampaignSeed {
  vehicle?: string
  interestedColour?: string
  location?: string
  gender?: string
  testRideAt?: string
  drivingLicence?: string
  pincode?: string
}

async function seedRegistration(
  overrides: {
    name?: string
    phone?: string
    email?: string
    createdAt?: string
  } & CampaignSeed = {},
): Promise<SeededRegistration> {
  codeSequence += 1
  const record = {
    recordId: randomUUID(),
    participantId: randomUUID(),
    publicCode: `A1-B8EFD9-${String(codeSequence).padStart(5, '0')}-X`,
  }
  const createdAt = overrides.createdAt ?? `2026-01-01T09:00:${String(codeSequence % 60).padStart(2, '0')}Z`

  await sql`
    INSERT INTO registrations (
      record_id, participant_id, public_code,
      event_id, event_day, station_id, source_device_id,
      name, phone, email,
      vehicle, interested_colour, location, gender,
      test_ride_at, driving_licence, pincode,
      created_at, updated_at, revision,
      first_received_at, last_received_at, last_uploader_device_id,
      content_changed_at
    ) VALUES (
      ${record.recordId}, ${record.participantId}, ${record.publicCode},
      ${EVENT_ID}, '2026-01-01', 'A1', ${DEVICE},
      ${overrides.name ?? `Participant ${codeSequence}`},
      ${overrides.phone ?? `+91 98765 ${String(10000 + codeSequence)}`},
      ${overrides.email ?? `p${codeSequence}@example.com`},
      ${overrides.vehicle ?? null}, ${overrides.interestedColour ?? null},
      ${overrides.location ?? null}, ${overrides.gender ?? null},
      ${overrides.testRideAt ?? null}, ${overrides.drivingLicence ?? null},
      ${overrides.pincode ?? null},
      ${createdAt}, ${createdAt}, 1,
      now(), now(), ${DEVICE},
      now()
    )
  `

  return record
}

async function seedFeedback(options: {
  publicCode: string
  participantId?: string | null
  captureMethod?: 'qr' | 'manual'
  answers?: Record<string, string | number | boolean>
  formVersion?: string
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
      ${options.captureMethod ?? 'manual'},
      ${EVENT_ID}, '2026-01-01', 'B1', ${DEVICE},
      ${options.formVersion ?? 'feedback-v1'},
      ${sql.json(
        options.answers ?? {
          overall_rating: 4,
          experience: 'good',
          recommend: true,
          comments: 'Well organised',
        },
      )},
      '2026-01-01T11:00:00Z', '2026-01-01T11:00:00Z', 1,
      now(), now(), ${DEVICE},
      now()
    )
  `

  return recordId
}

/** Reads a JSON response body without losing the typing of the assertions. */
async function json(response: Response): Promise<Record<string, never>> {
  return (await response.json()) as Record<string, never>
}

describeDb('reporting API', () => {
  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 4, onnotice: () => {} })
    await applyMigrations()
    store = createPostgresStore(sql)
    app = mount(SECRET)
  })

  afterAll(async () => {
    await sql?.end({ timeout: 5 })
  })

  beforeEach(async () => {
    logLines = []
    await sql`DELETE FROM sync_devices`
    await sql`DELETE FROM reconciliation_duplicate_registration_candidates`
    await sql`DELETE FROM reconciliation_feedback_results`
    await sql`DELETE FROM reconciliation_registration_results`
    await sql`DELETE FROM reconciliation_runs`
    await sql`DELETE FROM feedback`
    await sql`DELETE FROM registrations`
  })

  describe('authentication', () => {
    it('rejects a request with no credential', async () => {
      const response = await app.request(
        `/v1/reporting/overview?eventId=${EVENT_ID}`,
      )

      expect(response.status).toBe(401)
      expect(await json(response)).toEqual({ error: 'unauthorized' })
    })

    it('rejects a wrong credential', async () => {
      const response = await app.request(`/v1/reporting/overview?eventId=${EVENT_ID}`, {
        headers: { Authorization: `Bearer ${randomBytes(32).toString('hex')}` },
      })

      expect(response.status).toBe(401)
    })

    it('rejects an enrolled device sync token', async () => {
      // A token good enough to upload this event's records. Reporting must
      // still refuse it: uploading and reading everyone's PII are not the same
      // privilege.
      const deviceToken = randomBytes(32).toString('base64url')
      await sql`
        INSERT INTO sync_devices (event_id, uploader_device_id, token_hash)
        VALUES (${EVENT_ID}, ${DEVICE}, ${createHash('sha256').update(deviceToken).digest('hex')})
        ON CONFLICT DO NOTHING
      `

      const response = await app.request(`/v1/reporting/overview?eventId=${EVENT_ID}`, {
        headers: { Authorization: `Bearer ${deviceToken}` },
      })

      expect(response.status).toBe(401)
    })

    it('fails closed when the server has no reporting secret', async () => {
      const unconfigured = mount(undefined)
      const response = await unconfigured.request(
        `/v1/reporting/overview?eventId=${EVENT_ID}`,
        { headers: AUTH },
      )

      expect(response.status).toBe(503)
      expect((await json(response))['error']).toBe('reporting_not_configured')
    })

    it('never writes the credential or the header to the log', async () => {
      await app.request(`/v1/reporting/overview?eventId=${EVENT_ID}`, {
        headers: { Authorization: `Bearer ${SECRET}wrong` },
      })

      expect(logLines.join('\n')).not.toContain(SECRET)
      expect(logLines.join('\n')).toContain('reporting auth failed')
    })
  })

  describe('caching', () => {
    it('marks every response no-store, including failures', async () => {
      await seedRegistration()
      await runReconciliation(sql, EVENT_ID)

      const ok = await app.request(`/v1/reporting/overview?eventId=${EVENT_ID}`, {
        headers: AUTH,
      })
      const denied = await app.request(`/v1/reporting/overview?eventId=${EVENT_ID}`)

      for (const response of [ok, denied]) {
        expect(response.headers.get('Cache-Control')).toBe('no-store, private')
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
        expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
      }
    })
  })

  describe('overview', () => {
    it('reports 404 before any run exists', async () => {
      await seedRegistration()

      const response = await app.request(`/v1/reporting/overview?eventId=${EVENT_ID}`, {
        headers: AUTH,
      })

      expect(response.status).toBe(404)
      expect((await json(response))['error']).toBe('no_completed_run')
    })

    it('summarises the latest run, analysing matched responses only', async () => {
      const matched = await seedRegistration()
      const ambiguous = await seedRegistration()
      await seedRegistration() // no feedback at all

      await seedFeedback({
        publicCode: matched.publicCode,
        participantId: matched.participantId,
        captureMethod: 'qr',
        answers: { overall_rating: 5, experience: 'excellent', recommend: true },
      })
      // Two responses for one participant: valid, but no winner.
      await seedFeedback({
        publicCode: ambiguous.publicCode,
        answers: { overall_rating: 1, experience: 'very_poor', recommend: false },
      })
      await seedFeedback({
        publicCode: ambiguous.publicCode,
        answers: { overall_rating: 1, experience: 'very_poor', recommend: false },
      })

      await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request(`/v1/reporting/overview?eventId=${EVENT_ID}`, {
          headers: AUTH,
        }),
      )

      const analytics = body['analytics'] as unknown as Record<string, unknown>
      const coverage = body['coverage'] as unknown as Record<string, unknown>

      // Only the single matched response is analysed: the two conflicting 1s
      // would otherwise drag the average from 5 to 2.33.
      expect(analytics['analysedResponses']).toBe(1)
      expect(analytics['averageOverallRating']).toBe(5)

      // Coverage counts both participants who responded, ambiguity included.
      expect(coverage['registrationsWithFeedback']).toBe(2)
      expect(coverage['totalRegistrations']).toBe(3)
      expect(coverage['percentage']).toBe(66.7)

      expect((body['freshness'] as unknown as Record<string, unknown>)['dataChangedSinceRun']).toBe(
        false,
      )
      expect(body['isHistoricalRun']).toBe(false)
    })

    it('detects that data moved after the run completed', async () => {
      await seedRegistration()
      await runReconciliation(sql, EVENT_ID)
      await seedRegistration()

      const body = await json(
        await app.request(`/v1/reporting/overview?eventId=${EVENT_ID}`, {
          headers: AUTH,
        }),
      )
      const freshness = body['freshness'] as unknown as Record<string, unknown>

      expect(freshness['dataChangedSinceRun']).toBe(true)
      expect(freshness['currentRegistrationCount']).toBe(2)
    })

    it('marks an older run as historical', async () => {
      await seedRegistration()
      const first = await runReconciliation(sql, EVENT_ID)
      await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request(
          `/v1/reporting/overview?eventId=${EVENT_ID}&runId=${first.runId}`,
          { headers: AUTH },
        ),
      )

      expect(body['isHistoricalRun']).toBe(true)
    })
  })

  describe('registration browser', () => {
    it('never attaches an answer to a registration with several responses', async () => {
      const ambiguous = await seedRegistration()
      await seedFeedback({ publicCode: ambiguous.publicCode })
      await seedFeedback({ publicCode: ambiguous.publicCode })
      await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request('/v1/reporting/registrations/query', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: EVENT_ID }),
        }),
      )

      const rows = body['rows'] as unknown as Record<string, unknown>[]
      expect(rows).toHaveLength(1)
      expect(rows[0]?.['reconciliationStatus']).toBe('multiple_feedback')
      expect(rows[0]?.['validFeedbackCount']).toBe(2)
      expect(rows[0]?.['feedbackSummary']).toBeNull()
    })

    it('filters by reconciliation status', async () => {
      const matched = await seedRegistration()
      await seedRegistration()
      await seedFeedback({ publicCode: matched.publicCode })
      await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request('/v1/reporting/registrations/query', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: EVENT_ID, status: 'without_feedback' }),
        }),
      )

      const rows = body['rows'] as unknown as Record<string, unknown>[]
      expect(rows).toHaveLength(1)
      expect(rows[0]?.['reconciliationStatus']).toBe('without_feedback')
    })

    it('searches by name without putting the term in a URL or a log', async () => {
      await seedRegistration({ name: 'Grace Hopper' })
      await seedRegistration({ name: 'Ada Lovelace' })
      await runReconciliation(sql, EVENT_ID)

      const response = await app.request('/v1/reporting/registrations/query', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: EVENT_ID, search: 'hopper' }),
      })
      const rows = (await json(response))['rows'] as unknown as Record<string, unknown>[]

      expect(rows).toHaveLength(1)
      expect(rows[0]?.['name']).toBe('Grace Hopper')
      expect(logLines.join('\n')).not.toContain('hopper')
      expect(logLines.join('\n')).not.toContain('Grace')
    })

    it('pages with an opaque cursor', async () => {
      for (let index = 0; index < 5; index += 1) {
        await seedRegistration()
      }
      await runReconciliation(sql, EVENT_ID)

      const first = await json(
        await app.request('/v1/reporting/registrations/query', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: EVENT_ID, limit: 2 }),
        }),
      )
      const cursor = first['nextCursor'] as unknown as string

      expect((first['rows'] as unknown as unknown[])).toHaveLength(2)
      expect(typeof cursor).toBe('string')

      const second = await json(
        await app.request('/v1/reporting/registrations/query', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: EVENT_ID, limit: 2, cursor }),
        }),
      )
      const firstIds = (first['rows'] as unknown as Record<string, unknown>[]).map(
        (row) => row['recordId'],
      )
      const secondIds = (second['rows'] as unknown as Record<string, unknown>[]).map(
        (row) => row['recordId'],
      )

      expect(secondIds).toHaveLength(2)
      expect(secondIds.some((id) => firstIds.includes(id))).toBe(false)
    })

    it('returns every response on the detail view, choosing none', async () => {
      const ambiguous = await seedRegistration()
      await seedFeedback({ publicCode: ambiguous.publicCode })
      await seedFeedback({ publicCode: ambiguous.publicCode })
      await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request(
          `/v1/reporting/registrations/${ambiguous.recordId}?eventId=${EVENT_ID}`,
          { headers: AUTH },
        ),
      )
      const registration = body['registration'] as unknown as Record<string, unknown>

      expect((registration['feedback'] as unknown[])).toHaveLength(2)
      expect(registration['feedbackSummary']).toBeNull()
    })
  })

  describe('feedback browser', () => {
    it('lists responses that match no registration', async () => {
      await seedFeedback({ publicCode: 'A1-B8EFD9-99999-X' })
      await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request('/v1/reporting/feedback/query', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: EVENT_ID, status: 'without_registration' }),
        }),
      )
      const rows = body['rows'] as unknown as Record<string, unknown>[]

      expect(rows).toHaveLength(1)
      expect(rows[0]?.['linkedRegistration']).toBeNull()
    })
  })

  describe('reconcile', () => {
    it('runs Phase 7 on demand and returns the new run', async () => {
      const registration = await seedRegistration()
      await seedFeedback({ publicCode: registration.publicCode })

      const body = await json(
        await app.request('/v1/reporting/reconcile', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: EVENT_ID }),
        }),
      )

      expect(typeof body['runId']).toBe('string')
      expect((body['counts'] as unknown as Record<string, unknown>)['matchedRegistrations']).toBe(1)

      const runs = await sql`SELECT run_id FROM reconciliation_runs`
      expect(runs).toHaveLength(1)
    })

    it('leaves the evidence untouched', async () => {
      const registration = await seedRegistration()
      await seedFeedback({ publicCode: registration.publicCode })

      const before = await sql`
        SELECT record_id, name, phone, email, revision, updated_at
        FROM registrations ORDER BY record_id
      `
      await app.request('/v1/reporting/reconcile', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: EVENT_ID }),
      })
      const after = await sql`
        SELECT record_id, name, phone, email, revision, updated_at
        FROM registrations ORDER BY record_id
      `

      expect(after).toEqual(before)
    })
  })

  /* ------------------------------------------------------------------ *
   * A run contains exactly what it classified
   * ------------------------------------------------------------------ */

  describe('run membership', () => {
    it('excludes a registration that arrived after the run from every view', async () => {
      const before = await seedRegistration({ name: 'In The Run' })
      const { runId } = await runReconciliation(sql, EVENT_ID)

      // Sync carries on after a run completes. This is the ordinary case.
      const after = await seedRegistration({ name: 'Arrived Later' })

      const listed = await json(
        await app.request('/v1/reporting/registrations/query', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: EVENT_ID, runId }),
        }),
      )
      const rows = listed['rows'] as unknown as Record<string, unknown>[]

      expect(rows).toHaveLength(1)
      expect(rows[0]?.['recordId']).toBe(before.recordId)
      // No row without a status: the browser has no "not in this run" state.
      expect(rows.every((row) => row['reconciliationStatus'] !== null)).toBe(true)

      // A record the run never saw has no status under it, so it is not there.
      const detail = await app.request(
        `/v1/reporting/registrations/${after.recordId}?eventId=${EVENT_ID}&runId=${runId}`,
        { headers: AUTH },
      )
      expect(detail.status).toBe(404)

      // ...and it is present under the run that did classify it.
      const { runId: laterRunId } = await runReconciliation(sql, EVENT_ID)
      const laterDetail = await app.request(
        `/v1/reporting/registrations/${after.recordId}?eventId=${EVENT_ID}&runId=${laterRunId}`,
        { headers: AUTH },
      )
      expect(laterDetail.status).toBe(200)
    })

    it('excludes a response that arrived after the run from every view', async () => {
      const registration = await seedRegistration()
      await seedFeedback({ publicCode: registration.publicCode })
      const { runId } = await runReconciliation(sql, EVENT_ID)

      const later = await seedFeedback({ publicCode: registration.publicCode })

      const listed = await json(
        await app.request('/v1/reporting/feedback/query', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: EVENT_ID, runId }),
        }),
      )
      const rows = listed['rows'] as unknown as Record<string, unknown>[]

      expect(rows).toHaveLength(1)
      expect(rows[0]?.['recordId']).not.toBe(later)

      const detail = await app.request(
        `/v1/reporting/feedback/${later}?eventId=${EVENT_ID}&runId=${runId}`,
        { headers: AUTH },
      )
      expect(detail.status).toBe(404)
    })

    it('exports exactly the run, not the event as it is now', async () => {
      await seedRegistration()
      const registration = await seedRegistration()
      await seedFeedback({ publicCode: registration.publicCode })
      const { runId } = await runReconciliation(sql, EVENT_ID)

      // Two more records land before the operator downloads the file.
      const late = await seedRegistration({ name: 'Too Late' })
      await seedFeedback({ publicCode: late.publicCode })

      const registrationsCsv = await (
        await app.request(
          `/v1/reporting/export/registrations.csv?eventId=${EVENT_ID}&runId=${runId}`,
          { headers: AUTH },
        )
      ).text()
      const feedbackCsv = await (
        await app.request(
          `/v1/reporting/export/feedback.csv?eventId=${EVENT_ID}&runId=${runId}`,
          { headers: AUTH },
        )
      ).text()

      const registrationRows = registrationsCsv.trimEnd().split('\r\n').length - 1
      const feedbackRows = feedbackCsv.trimEnd().split('\r\n').length - 1

      /*
       * The arithmetic an operator actually checks: a file's row count against
       * the run's own counts. A late arrival in the file breaks it silently.
       */
      const overview = await json(
        await app.request(
          `/v1/reporting/overview?eventId=${EVENT_ID}&runId=${runId}`,
          { headers: AUTH },
        ),
      )
      const counts = (overview['run'] as unknown as Record<string, never>)[
        'counts'
      ] as unknown as Record<string, number>

      expect(registrationRows).toBe(counts['registrationCount'])
      expect(feedbackRows).toBe(counts['feedbackCount'])
      expect(registrationsCsv).not.toContain('Too Late')
    })

    it('still shows current canonical details for the records it does contain', async () => {
      const registration = await seedRegistration({ name: 'Original Name' })
      const { runId } = await runReconciliation(sql, EVENT_ID)

      // A correction after the run. The run's classification is historical; the
      // participant's details are not, and the report shows the current ones.
      await sql`
        UPDATE registrations SET name = 'Corrected Name', revision = 2
        WHERE record_id = ${registration.recordId}
      `

      const body = await json(
        await app.request(
          `/v1/reporting/registrations/${registration.recordId}?eventId=${EVENT_ID}&runId=${runId}`,
          { headers: AUTH },
        ),
      )
      const detail = body['registration'] as unknown as Record<string, unknown>

      expect(detail['name']).toBe('Corrected Name')
      expect(detail['revision']).toBe(2)
    })
  })

  /* ------------------------------------------------------------------ *
   * Staleness
   * ------------------------------------------------------------------ */

  describe('freshness', () => {
    async function freshness(): Promise<Record<string, unknown>> {
      const body = await json(
        await app.request(`/v1/reporting/overview?eventId=${EVENT_ID}`, {
          headers: AUTH,
        }),
      )
      return body['freshness'] as unknown as Record<string, unknown>
    }

    it('is stale when a record arrives after the run', async () => {
      await seedRegistration()
      await runReconciliation(sql, EVENT_ID)
      expect((await freshness())['dataChangedSinceRun']).toBe(false)

      await seedRegistration()

      const report = await freshness()
      expect(report['dataChangedSinceRun']).toBe(true)
      expect(report['registrationsAddedSinceRun']).toBe(1)
    })

    it('is stale when a higher revision is accepted after the run', async () => {
      const registration = await seedRegistration({ name: 'Before' })
      await runReconciliation(sql, EVENT_ID)
      expect((await freshness())['dataChangedSinceRun']).toBe(false)

      // The real Phase 6 write for an accepted revision.
      const current = await store.getRegistration(registration.recordId)
      expect(current).not.toBeNull()
      const accepted = await store.updateRegistration(
        { ...(current as NonNullable<typeof current>), name: 'After', revision: 2 },
        1,
        new Date().toISOString(),
        DEVICE,
      )
      expect(accepted).toBe(true)

      const report = await freshness()
      expect(report['dataChangedSinceRun']).toBe(true)
      // No record was added: the count stays at zero and the timestamp is what
      // moved. Both halves of staleness are reported separately.
      expect(report['registrationsAddedSinceRun']).toBe(0)
    })

    it('cannot be fooled by an API clock running behind the database', async () => {
      const registration = await seedRegistration({ name: 'Before' })
      await runReconciliation(sql, EVENT_ID)
      expect((await freshness())['dataChangedSinceRun']).toBe(false)

      const [run] = await sql<{ completed_at: Date }[]>`
        SELECT completed_at FROM reconciliation_runs ORDER BY completed_at DESC LIMIT 1
      `
      const completedAt = run?.completed_at as Date

      /*
       * The revision is accepted after the run, but the API process reports a
       * time an hour before it — the shape of a host whose clock has drifted, or
       * one that has not synchronised since booting.
       *
       * If that timestamp were stored, the change would sort before the run and
       * the run would report itself current while no longer describing the event.
       * The comparison must not depend on two hosts agreeing about the time.
       */
      const skewed = new Date(completedAt.getTime() - 3_600_000).toISOString()
      const current = await store.getRegistration(registration.recordId)
      const accepted = await store.updateRegistration(
        { ...(current as NonNullable<typeof current>), name: 'After', revision: 2 },
        1,
        skewed,
        DEVICE,
      )
      expect(accepted).toBe(true)

      const [row] = await sql<
        { content_changed_at: Date; last_received_at: Date }[]
      >`
        SELECT content_changed_at, last_received_at FROM registrations
        WHERE record_id = ${registration.recordId}
      `

      // Stamped by Postgres, not by what the caller supplied.
      expect(row?.content_changed_at.toISOString()).not.toBe(skewed)
      expect(row?.content_changed_at.getTime()).toBeGreaterThanOrEqual(
        completedAt.getTime(),
      )

      // The device-facing diagnostic keeps the caller's time: this migration
      // changed which clock stamps a content change, not what "received" means.
      expect(row?.last_received_at.toISOString()).toBe(skewed)

      const report = await freshness()
      expect(report['dataChangedSinceRun']).toBe(true)
      expect(report['registrationsAddedSinceRun']).toBe(0)
    })

    it('is NOT stale when a device re-delivers records it already sent', async () => {
      const registration = await seedRegistration()
      const feedbackId = await seedFeedback({ publicCode: registration.publicCode })
      await runReconciliation(sql, EVENT_ID)

      /*
       * An offline tablet reconnecting and re-uploading a batch it had already
       * delivered — the most ordinary event in this system. Phase 6 answers
       * `already_current` and touches `last_received_at`, which must not be
       * mistaken for the data having changed.
       */
      const later = new Date(Date.now() + 60_000).toISOString()
      await store.touchRegistration(registration.recordId, later, DEVICE)
      await store.touchFeedback(feedbackId, later, DEVICE)

      const report = await freshness()
      expect(report['dataChangedSinceRun']).toBe(false)
      expect(report['registrationsAddedSinceRun']).toBe(0)
      expect(report['feedbackAddedSinceRun']).toBe(0)

      // Proof the retry really did land: the diagnostic timestamp moved, and it
      // is deliberately not the signal reporting uses.
      const [row] = await sql<{ last_received_at: Date }[]>`
        SELECT last_received_at FROM registrations
        WHERE record_id = ${registration.recordId}
      `
      expect(row?.last_received_at.toISOString()).toBe(later)
    })
  })

  /* ------------------------------------------------------------------ *
   * Request validation
   * ------------------------------------------------------------------ */

  describe('request validation', () => {
    it('rejects a malformed runId rather than letting it reach a uuid cast', async () => {
      await seedRegistration()
      await runReconciliation(sql, EVENT_ID)

      for (const path of [
        `/v1/reporting/overview?eventId=${EVENT_ID}&runId=not-a-uuid`,
        `/v1/reporting/duplicates?eventId=${EVENT_ID}&runId=not-a-uuid`,
        `/v1/reporting/export/registrations.csv?eventId=${EVENT_ID}&runId=not-a-uuid`,
      ]) {
        const response = await app.request(path, { headers: AUTH })
        expect(response.status).toBe(400)
        expect((await json(response))['error']).toBe('invalid_request')
      }
    })

    it('rejects a malformed recordId', async () => {
      await seedRegistration()
      await runReconciliation(sql, EVENT_ID)

      for (const path of [
        `/v1/reporting/registrations/not-a-uuid?eventId=${EVENT_ID}`,
        `/v1/reporting/feedback/12345?eventId=${EVENT_ID}`,
      ]) {
        const response = await app.request(path, { headers: AUTH })
        expect(response.status).toBe(400)
      }
    })

    it('rejects a missing event id', async () => {
      const response = await app.request('/v1/reporting/overview', { headers: AUTH })
      expect(response.status).toBe(400)
    })

    it('rejects a malformed cursor', async () => {
      await seedRegistration()
      await runReconciliation(sql, EVENT_ID)

      const cursors = [
        'not-base64!!',
        Buffer.from('no-separator', 'utf8').toString('base64url'),
        // Well-formed shape, invalid halves: a bad instant, then a bad uuid.
        Buffer.from('not-a-date|11111111-1111-4111-8111-111111111111', 'utf8').toString(
          'base64url',
        ),
        Buffer.from('2026-01-01T09:00:00.000Z|not-a-uuid', 'utf8').toString('base64url'),
      ]

      for (const cursor of cursors) {
        const response = await app.request('/v1/reporting/registrations/query', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: EVENT_ID, cursor }),
        })
        expect(response.status).toBe(400)
        expect((await json(response))['error']).toBe('invalid_request')
      }
    })

    it('rejects a malformed cursor on the feedback browser too', async () => {
      const response = await app.request('/v1/reporting/feedback/query', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: EVENT_ID, cursor: 'rubbish' }),
      })
      expect(response.status).toBe(400)
    })

    it('accepts the cursor it issued', async () => {
      await seedRegistration()
      await seedRegistration()
      await runReconciliation(sql, EVENT_ID)

      const first = await json(
        await app.request('/v1/reporting/registrations/query', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: EVENT_ID, limit: 1 }),
        }),
      )

      const response = await app.request('/v1/reporting/registrations/query', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: EVENT_ID,
          limit: 1,
          cursor: first['nextCursor'],
        }),
      })
      expect(response.status).toBe(200)
    })
  })

  /* ------------------------------------------------------------------ *
   * Questionnaire versions
   * ------------------------------------------------------------------ */

  describe('form versions', () => {
    /*
     * A v2 response whose keys look exactly like v1's and mean something else:
     * a 10-point rating, a differently-scaled experience, and a `recommend` that
     * is a string. Reading any of it as v1 would produce plausible nonsense.
     */
    const MISLEADING_V2 = {
      overall_rating: 9,
      experience: 'delighted',
      recommend: 'maybe',
      comments: 'v2 comment',
    }

    it('never maps v2 answers onto v1 semantics anywhere', async () => {
      const v1 = await seedRegistration()
      const v2 = await seedRegistration()
      await seedFeedback({
        publicCode: v1.publicCode,
        answers: { overall_rating: 5, experience: 'excellent', recommend: true },
      })
      await seedFeedback({
        publicCode: v2.publicCode,
        formVersion: 'feedback-v2',
        answers: MISLEADING_V2,
      })
      const { runId } = await runReconciliation(sql, EVENT_ID)

      // Analytics: only the v1 response is analysed, and the 9 cannot move it.
      const overview = await json(
        await app.request(`/v1/reporting/overview?eventId=${EVENT_ID}`, {
          headers: AUTH,
        }),
      )
      const analytics = overview['analytics'] as unknown as Record<string, unknown>
      expect(analytics['analysedResponses']).toBe(1)
      expect(analytics['averageOverallRating']).toBe(5)
      /*
       * The event-wide count of responses no analyser can read. Each analyser is
       * now handed only its own questionnaire's responses, so the per-analyser
       * counter is zero by construction and this is where an unknown version
       * becomes visible.
       */
      expect(overview['unreadableResponses']).toBe(1)
      expect(
        (overview['responsesByFormVersion'] as unknown as Record<string, number>)[
          'feedback-v2'
        ],
      ).toBe(1)

      // Registration summaries: the v2 participant gets no summary at all.
      const registrations = await json(
        await app.request('/v1/reporting/registrations/query', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: EVENT_ID }),
        }),
      )
      const byCode = new Map(
        (registrations['rows'] as unknown as Record<string, unknown>[]).map((row) => [
          String(row['publicCode']),
          row,
        ]),
      )
      expect(byCode.get(v1.publicCode)?.['feedbackSummary']).not.toBeNull()
      expect(byCode.get(v2.publicCode)?.['feedbackSummary']).toBeNull()

      // Feedback list summaries: null for v2, and the version is still reported.
      const feedback = await json(
        await app.request('/v1/reporting/feedback/query', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: EVENT_ID }),
        }),
      )
      const v2Row = (feedback['rows'] as unknown as Record<string, unknown>[]).find(
        (row) => row['formVersion'] === 'feedback-v2',
      )
      expect(v2Row).toBeDefined()
      expect(v2Row?.['overallRating']).toBeNull()
      expect(v2Row?.['experience']).toBeNull()
      expect(v2Row?.['recommend']).toBeNull()

      // Exports: v1 columns blank for v2, but the row and its version are there.
      const registrationsCsv = await (
        await app.request(
          `/v1/reporting/export/registrations.csv?eventId=${EVENT_ID}&runId=${runId}`,
          { headers: AUTH },
        )
      ).text()
      const v2RegistrationRow = registrationsCsv
        .split('\r\n')
        .find((line) => line.includes(v2.publicCode))
      expect(v2RegistrationRow).toBeDefined()
      expect(v2RegistrationRow).not.toContain('delighted')
      expect(v2RegistrationRow).not.toContain('v2 comment')

      const feedbackCsv = await (
        await app.request(
          `/v1/reporting/export/feedback.csv?eventId=${EVENT_ID}&runId=${runId}`,
          { headers: AUTH },
        )
      ).text()
      const v2FeedbackRow = feedbackCsv
        .split('\r\n')
        .find((line) => line.includes('feedback-v2'))
      expect(v2FeedbackRow).toBeDefined()
      expect(v2FeedbackRow).not.toContain('delighted')
      expect(v2FeedbackRow).not.toContain('maybe')
      expect(v2FeedbackRow).not.toContain('v2 comment')

      // The workbook is built from the same rows, so it inherits the rule.
      const workbookResponse = await app.request(
        `/v1/reporting/export/report.xlsx?eventId=${EVENT_ID}&runId=${runId}`,
        { headers: AUTH },
      )
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await workbookResponse.arrayBuffer())
      const sheet = workbook.getWorksheet('Feedback')
      let sawV2 = false
      let sawV2Answers = false
      sheet?.eachRow((row, number) => {
        if (number === 1) {
          return
        }
        const values = (row.values as unknown[]).map((value) => String(value ?? ''))
        if (values.includes('feedback-v2')) {
          sawV2 = true
          sawV2Answers = values.some((value) =>
            ['delighted', 'maybe', '9', 'v2 comment'].includes(value),
          )
        }
      })
      expect(sawV2).toBe(true)
      expect(sawV2Answers).toBe(false)
    })

    it('shows a v2 response in full on its detail view, with its version', async () => {
      const registration = await seedRegistration()
      const recordId = await seedFeedback({
        publicCode: registration.publicCode,
        formVersion: 'feedback-v2',
        answers: MISLEADING_V2,
      })
      const { runId } = await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request(
          `/v1/reporting/feedback/${recordId}?eventId=${EVENT_ID}&runId=${runId}`,
          { headers: AUTH },
        ),
      )
      const detail = body['feedback'] as unknown as Record<string, unknown>

      // The raw structure is preserved: nothing is hidden, nothing is mapped.
      expect(detail['formVersion']).toBe('feedback-v2')
      expect(detail['answers']).toEqual(MISLEADING_V2)
      // ...but the v1-shaped summary fields stay empty.
      expect(detail['overallRating']).toBeNull()
      expect(detail['experience']).toBeNull()
      expect(detail['recommend']).toBeNull()
    })
  })

  /* ------------------------------------------------------------------ *
   * Flying Flea campaign
   * ------------------------------------------------------------------ */

  describe('campaign registrations', () => {
    const RIDER = {
      vehicle: 'Vehicle 3',
      interestedColour: 'Storm Black',
      location: 'Prestige Tech Park',
      gender: 'Female',
      testRideAt: '2026-01-01T10:30',
      drivingLicence: 'KA0120200001234',
      pincode: '560048',
    }

    it('keeps the licence number out of the participant list', async () => {
      await seedRegistration(RIDER)
      await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request('/v1/reporting/registrations/query', {
          method: 'POST',
          headers: { ...AUTH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: EVENT_ID }),
        }),
      )
      const rows = body['rows'] as unknown as Record<string, unknown>[]
      const row = rows[0] as Record<string, unknown>

      // The campaign fields a list is actually asked about are there...
      expect(row['vehicle']).toBe(RIDER.vehicle)
      expect(row['interestedColour']).toBe(RIDER.interestedColour)
      expect(row['location']).toBe(RIDER.location)
      expect(row['pincode']).toBe(RIDER.pincode)

      /*
       * ...and the licence number is not, anywhere in the payload. A list
       * answers no question that needs it, and one screen holding every rider's
       * licence is a different kind of exposure from one row holding one.
       */
      expect('drivingLicence' in row).toBe(false)
      expect(JSON.stringify(body)).not.toContain(RIDER.drivingLicence)
    })

    it('shows the licence on the privileged detail view, labelled', async () => {
      const registration = await seedRegistration(RIDER)
      await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request(
          `/v1/reporting/registrations/${registration.recordId}?eventId=${EVENT_ID}`,
          { headers: AUTH },
        ),
      )
      const detail = body['registration'] as unknown as Record<string, unknown>

      expect(detail['drivingLicence']).toBe(RIDER.drivingLicence)
      // The test-ride slot is a wall-clock time at a venue, stored as captured.
      expect(detail['testRideAt']).toBe('2026-01-01T10:30')
    })

    it('leaves campaign fields null for a registration captured before them', async () => {
      const registration = await seedRegistration()
      await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request(
          `/v1/reporting/registrations/${registration.recordId}?eventId=${EVENT_ID}`,
          { headers: AUTH },
        ),
      )
      const detail = body['registration'] as unknown as Record<string, unknown>

      // Null, never a default. The rider chose no vehicle because nobody asked.
      expect(detail['vehicle']).toBeNull()
      expect(detail['drivingLicence']).toBeNull()
      expect(detail['name']).toBeDefined()
    })

    it('exports the campaign fields, blank where they were never captured', async () => {
      await seedRegistration(RIDER)
      await seedRegistration()
      const { runId } = await runReconciliation(sql, EVENT_ID)

      const csv = await (
        await app.request(
          `/v1/reporting/export/registrations.csv?eventId=${EVENT_ID}&runId=${runId}`,
          { headers: AUTH },
        )
      ).text()
      const [header, ...rows] = csv.trimEnd().split('\r\n')
      const columns = (header ?? '').split(',')

      for (const column of [
        'vehicle',
        'interested_colour',
        'location',
        'gender',
        'test_ride_at',
        'driving_licence',
        'pincode',
      ]) {
        expect(columns).toContain(column)
      }

      expect(rows).toHaveLength(2)
      expect(csv).toContain('Vehicle 3')
      expect(csv).toContain('Storm Black')
      expect(csv).toContain(RIDER.drivingLicence)
    })
  })

  describe('campaign feedback', () => {
    const CAMPAIGN_ANSWERS = {
      testRideExperience: 7,
      rotaryKnobUsage: 6,
      rideModesExperience: 5,
      overallExperienceRating: 7,
      topThreeFeatures: 'Torque, brakes, the silence',
      overallExperienceComments: 'Brilliant',
    }

    async function seedCampaignResponse(publicCode: string, participantId?: string) {
      return seedFeedback({
        publicCode,
        ...(participantId === undefined ? {} : { participantId }),
        formVersion: 'flying-flea-feedback-v1',
        answers: CAMPAIGN_ANSWERS,
      })
    }

    it('analyses the campaign questionnaire on its own scale', async () => {
      const rider = await seedRegistration()
      await seedCampaignResponse(rider.publicCode, rider.participantId)
      await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request(`/v1/reporting/overview?eventId=${EVENT_ID}`, {
          headers: AUTH,
        }),
      )
      const campaign = body['campaignAnalytics'] as unknown as Record<
        string,
        never
      >
      const ratings = campaign['ratings'] as unknown as Record<string, unknown>[]

      expect(campaign['analysedResponses']).toBe(1)
      expect(
        ratings.find((rating) => rating['key'] === 'testRideExperience')?.[
          'average'
        ],
      ).toBe(7)
      // The question's own wording travels with its figures.
      expect(
        ratings.find((rating) => rating['key'] === 'rotaryKnobUsage')?.['prompt'],
      ).toBe('How do you rate usage of the rotary knob for changing modes?')

      // And the two questionnaires are reported separately, never merged.
      const byVersion = body['responsesByFormVersion'] as unknown as Record<
        string,
        number
      >
      expect(byVersion['flying-flea-feedback-v1']).toBe(1)
      expect(body['unreadableResponses']).toBe(0)
    })

    it('never mixes a 1-5 rating into a 1-7 average', async () => {
      const campaignRider = await seedRegistration()
      const legacyRider = await seedRegistration()
      await seedCampaignResponse(campaignRider.publicCode, campaignRider.participantId)
      await seedFeedback({
        publicCode: legacyRider.publicCode,
        answers: { overall_rating: 1, experience: 'very_poor', recommend: false },
      })
      await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request(`/v1/reporting/overview?eventId=${EVENT_ID}`, {
          headers: AUTH,
        }),
      )
      const campaign = body['campaignAnalytics'] as unknown as Record<string, never>
      const legacy = body['analytics'] as unknown as Record<string, never>
      const ratings = campaign['ratings'] as unknown as Record<string, unknown>[]

      expect(campaign['analysedResponses']).toBe(1)
      expect(legacy['analysedResponses']).toBe(1)
      // The legacy 1 does not touch the campaign's 7, and vice versa.
      expect(
        ratings.find((rating) => rating['key'] === 'overallExperienceRating')?.[
          'average'
        ],
      ).toBe(7)
      expect(legacy['averageOverallRating']).toBe(1)
    })

    it('carries a campaign summary on the participant detail view', async () => {
      /*
       * The registration detail lists a participant's responses, and each line
       * summarises one. Without these fields the screen had nothing to show for
       * a campaign response and told the operator the build could not read it.
       */
      const rider = await seedRegistration()
      await seedCampaignResponse(rider.publicCode, rider.participantId)
      await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request(
          `/v1/reporting/registrations/${rider.recordId}?eventId=${EVENT_ID}`,
          { headers: AUTH },
        ),
      )
      const detail = body['registration'] as unknown as Record<string, unknown>
      const responses = detail['feedback'] as unknown as Record<string, unknown>[]

      expect(responses).toHaveLength(1)
      expect(responses[0]?.['formVersion']).toBe('flying-flea-feedback-v1')
      expect(responses[0]?.['campaignSummary']).toEqual({
        testRideExperience: 7,
        rotaryKnobUsage: 6,
        rideModesExperience: 5,
        overallExperienceRating: 7,
      })
      // The v1 summary fields stay empty: they belong to another questionnaire.
      expect(responses[0]?.['overallRating']).toBeNull()
    })

    it('leaves the campaign summary null on a feedback-v1 response', async () => {
      const rider = await seedRegistration()
      await seedFeedback({ publicCode: rider.publicCode })
      await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request(
          `/v1/reporting/registrations/${rider.recordId}?eventId=${EVENT_ID}`,
          { headers: AUTH },
        ),
      )
      const detail = body['registration'] as unknown as Record<string, unknown>
      const responses = detail['feedback'] as unknown as Record<string, unknown>[]

      expect(responses[0]?.['campaignSummary']).toBeNull()
      expect(responses[0]?.['overallRating']).toBe(4)
    })

    it('renders the campaign answers on the detail view', async () => {
      const rider = await seedRegistration()
      const recordId = await seedCampaignResponse(
        rider.publicCode,
        rider.participantId,
      )
      await runReconciliation(sql, EVENT_ID)

      const body = await json(
        await app.request(
          `/v1/reporting/feedback/${recordId}?eventId=${EVENT_ID}`,
          { headers: AUTH },
        ),
      )
      const detail = body['feedback'] as unknown as Record<string, unknown>

      expect(detail['formVersion']).toBe('flying-flea-feedback-v1')
      expect(detail['answers']).toEqual(CAMPAIGN_ANSWERS)
      // The v1 summary fields stay empty: they belong to another questionnaire.
      expect(detail['overallRating']).toBeNull()
      expect(detail['experience']).toBeNull()
      expect(detail['recommend']).toBeNull()
    })

    it('exports campaign answers in their own columns', async () => {
      const rider = await seedRegistration()
      await seedCampaignResponse(rider.publicCode, rider.participantId)
      const { runId } = await runReconciliation(sql, EVENT_ID)

      const csv = await (
        await app.request(
          `/v1/reporting/export/feedback.csv?eventId=${EVENT_ID}&runId=${runId}`,
          { headers: AUTH },
        )
      ).text()
      const [header, row] = csv.trimEnd().split('\r\n')
      const columns = (header ?? '').split(',')
      const values = (row ?? '').split(',')

      const at = (name: string) => values[columns.indexOf(name)]

      expect(at('test_ride_experience_rating')).toBe('7')
      expect(at('rotary_knob_rating')).toBe('6')
      expect(at('ride_modes_rating')).toBe('5')
      expect(at('overall_experience_rating')).toBe('7')
      expect(csv).toContain('Torque, brakes, the silence')
      // The v1 columns stay blank on a campaign row.
      expect(at('overall_rating')).toBe('')
      expect(at('experience')).toBe('')
    })

    it('classifies campaign responses exactly like any other', async () => {
      /*
       * Reconciliation is questionnaire-agnostic and must stay that way: it
       * matches on identity, not on what was asked. This is the regression that
       * would catch form-specific logic creeping into Phase 7.
       */
      const matched = await seedRegistration()
      const ambiguous = await seedRegistration()
      await seedRegistration()

      await seedCampaignResponse(matched.publicCode, matched.participantId)
      await seedCampaignResponse(ambiguous.publicCode)
      await seedCampaignResponse(ambiguous.publicCode)
      await seedCampaignResponse('A1-B8EFD9-99999-X')

      const { output } = await runReconciliation(sql, EVENT_ID)

      expect(output.counts.matchedRegistrations).toBe(1)
      expect(output.counts.registrationsWithMultipleFeedback).toBe(1)
      expect(output.counts.registrationsWithoutFeedback).toBe(1)
      expect(output.counts.feedbackWithoutRegistration).toBe(1)
      expect(output.counts.feedbackInMultipleGroups).toBe(2)
    })
  })

  describe('exports', () => {
    async function seedExportable(): Promise<void> {
      const matched = await seedRegistration({
        name: '=cmd|" /C calc"!A0',
        phone: '+919876543210',
      })
      const ambiguous = await seedRegistration()
      await seedRegistration()

      await seedFeedback({
        publicCode: matched.publicCode,
        participantId: matched.participantId,
        captureMethod: 'qr',
        answers: {
          overall_rating: 5,
          experience: 'excellent',
          recommend: true,
          comments: '=HYPERLINK("http://evil.example")',
        },
      })
      await seedFeedback({ publicCode: ambiguous.publicCode })
      await seedFeedback({ publicCode: ambiguous.publicCode })

      await runReconciliation(sql, EVENT_ID)
    }

    it('exports registrations as CSV with a non-identifying filename', async () => {
      await seedExportable()

      const response = await app.request(
        `/v1/reporting/export/registrations.csv?eventId=${EVENT_ID}`,
        { headers: AUTH },
      )
      const text = await response.text()

      expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
      expect(response.headers.get('Content-Disposition')).toBe(
        `attachment; filename="${EVENT_ID}-registrations-2026-02-01.csv"`,
      )
      expect(response.headers.get('Cache-Control')).toBe('no-store, private')

      const lines = text.trimEnd().split('\r\n')
      expect(lines).toHaveLength(4) // header + three registrations

      // Formula injection neutralised; the phone number survives as text.
      expect(text).toContain(`"'=cmd`)
      expect(text).toContain(`"'+919876543210"`)
    })

    it('exports every response, including both halves of an ambiguous pair', async () => {
      await seedExportable()

      const text = await (
        await app.request(`/v1/reporting/export/feedback.csv?eventId=${EVENT_ID}`, {
          headers: AUTH,
        })
      ).text()

      expect(text.trimEnd().split('\r\n')).toHaveLength(4) // header + three responses
      expect(text).toContain(`"'=HYPERLINK`)
    })

    it('builds a workbook whose participant cells are all text', async () => {
      await seedExportable()

      const response = await app.request(
        `/v1/reporting/export/report.xlsx?eventId=${EVENT_ID}`,
        { headers: AUTH },
      )
      expect(response.headers.get('Content-Disposition')).toContain('.xlsx')

      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await response.arrayBuffer())

      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
        'Summary',
        'Registrations',
        'Feedback',
        'Duplicate Candidates',
        'Metadata',
      ])

      const registrations = workbook.getWorksheet('Registrations')
      let inspected = 0
      registrations?.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          return
        }
        row.eachCell((cell) => {
          inspected += 1
          // Never a formula, never a number that a leading + or = produced.
          expect(cell.formula).toBeUndefined()
          expect(typeof cell.value === 'string' || cell.value === null).toBe(true)
        })
      })
      expect(inspected).toBeGreaterThan(0)

      const metadata = workbook.getWorksheet('Metadata')
      const fields = (metadata?.getColumn(1).values ?? []).map((value) => String(value))
      expect(fields).toContain('analyticsInclusionRule')
      expect(fields).toContain('snapshotCaveat')
    })

    it('refuses an unknown export kind', async () => {
      await seedExportable()

      const response = await app.request(
        `/v1/reporting/export/everything.zip?eventId=${EVENT_ID}`,
        { headers: AUTH },
      )

      expect(response.status).toBe(404)
    })
  })
})
