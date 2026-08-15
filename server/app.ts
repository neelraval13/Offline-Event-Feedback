import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  enrollmentRequestSchema,
  syncBatchSchema,
  SYNC_PROTOCOL_VERSION,
  type SyncBatchResponse,
  type SyncRecordResult,
} from '../shared/sync/protocol.js'
import {
  bearerToken,
  enrollmentSecretMatches,
  generateDeviceToken,
  hashDeviceToken,
  tokensMatch,
} from './auth/tokens.js'
import { ingestBatch } from './sync/ingest.js'
import type { SyncStore } from './sync/store.js'
import { createReportingRoutes } from './reporting/routes.js'
import type { Sql } from 'postgres'

/*
 * The central ingest API.
 *
 * Write-oriented by design. There is no endpoint that returns a record, a
 * participant or a count of them: consolidation is the goal of this phase, and
 * reading central data back is a later one with different privacy questions.
 *
 * Nothing here logs a request body, a token, an Authorization header or an
 * enrolment secret. Operational logs carry identifiers and counts only.
 */

export interface AppOptions {
  readonly store: SyncStore
  readonly enrollmentSecret: string
  readonly allowedOrigins: readonly string[]
  /** Overridden in tests for deterministic timestamps. */
  readonly now?: () => Date
  readonly log?: (line: string) => void
  /** Reports database reachability for /health. */
  readonly checkDatabase?: () => Promise<boolean>
  /*
   * Reporting is mounted only when a database handle is supplied. It reads
   * central PII and is entirely separate from ingest, different credential,
   * different module, different failure mode. Sync works with or without it.
   */
  readonly sql?: Sql
  /** `REPORTING_ADMIN_SECRET`. Absent means reporting fails closed. */
  readonly reportingSecret?: string
}

interface AuthenticatedDevice {
  readonly eventId: string
  readonly uploaderDeviceId: string
}

export function createApp(options: AppOptions) {
  const app = new Hono()
  const now = options.now ?? (() => new Date())
  const log = options.log ?? ((line: string) => console.log(line))

  /*
   * Explicit origins only. A wildcard would let any page a staff member has
   * open drive an authenticated upload against this event.
   */
  app.use(
    '/v1/*',
    cors({
      origin: (origin) =>
        options.allowedOrigins.includes(origin) ? origin : null,
      // GET is for reporting reads and downloads; POST remains what sync and
      // enrolment use. Still no wildcard origin.
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    }),
  )

  app.get('/health', async (context) => {
    const databaseReachable =
      options.checkDatabase === undefined
        ? undefined
        : await options.checkDatabase().catch(() => false)

    // Status only: no connection string, no host, no schema detail.
    return context.json({
      status: 'ok',
      protocolVersion: SYNC_PROTOCOL_VERSION,
      ...(databaseReachable === undefined ? {} : { database: databaseReachable }),
    })
  })

  /**
   * Enrolment.
   *
   * The operator types the shared enrolment code once, on a device that has
   * Internet. In exchange the device gets its own token; the shared code never
   * reaches storage on either side.
   */
  app.post('/v1/sync/enroll', async (context) => {
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: 'invalid_request' }, 400)
    }

    const parsed = enrollmentRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json({ error: 'invalid_request' }, 400)
    }

    if (!enrollmentSecretMatches(parsed.data.enrollmentSecret, options.enrollmentSecret)) {
      // One answer for every rejection: never hint at how close the code was.
      log(
        `enroll rejected event=${parsed.data.eventId} device=${parsed.data.deviceId}`,
      )
      return context.json({ error: 'enrollment_rejected' }, 401)
    }

    const deviceToken = generateDeviceToken()
    await options.store.enrollDevice({
      eventId: parsed.data.eventId,
      uploaderDeviceId: parsed.data.deviceId,
      tokenHash: hashDeviceToken(deviceToken),
    })

    log(`enroll ok event=${parsed.data.eventId} device=${parsed.data.deviceId}`)

    // The only time the plaintext token exists outside the device.
    return context.json({
      eventId: parsed.data.eventId,
      deviceId: parsed.data.deviceId,
      deviceToken,
    })
  })

  /** Resolves the bearer token to an enrolled, unrevoked device. */
  async function authenticate(
    header: string | undefined,
    eventId: string,
    uploaderDeviceId: string,
  ): Promise<AuthenticatedDevice | null> {
    const token = bearerToken(header)
    if (token === null) {
      return null
    }

    const device = await options.store.findDevice(eventId, uploaderDeviceId)
    if (device === null || device.revokedAt !== null) {
      return null
    }

    if (!tokensMatch(hashDeviceToken(token), device.tokenHash)) {
      return null
    }

    return { eventId: device.eventId, uploaderDeviceId: device.uploaderDeviceId }
  }

  app.post('/v1/sync/batch', async (context) => {
    const started = Date.now()

    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: 'invalid_request' }, 400)
    }

    /*
     * A malformed envelope rejects the whole request; there is no sensible
     * per-record answer when the batch itself cannot be understood. Individual
     * records inside a well-formed batch are a different matter.
     */
    const parsed = syncBatchSchema.safeParse(body)
    if (!parsed.success) {
      return context.json({ error: 'invalid_batch' }, 400)
    }

    const batch = parsed.data

    const device = await authenticate(
      context.req.header('Authorization'),
      batch.eventId,
      batch.uploaderDeviceId,
    )
    if (device === null) {
      return context.json({ error: 'unauthorized' }, 401)
    }

    const receivedAt = now().toISOString()
    const results: SyncRecordResult[] = await ingestBatch(
      {
        store: options.store,
        eventId: device.eventId,
        uploaderDeviceId: device.uploaderDeviceId,
        receivedAt,
      },
      batch.records,
    )

    const tally = {
      accepted: results.filter((r) => r.status === 'accepted').length,
      alreadyCurrent: results.filter((r) => r.status === 'already_current').length,
      serverNewer: results.filter((r) => r.status === 'server_newer').length,
      conflict: results.filter((r) => r.status === 'conflict').length,
      invalid: results.filter((r) => r.status === 'invalid').length,
    }

    await options.store.recordBatch({
      batchId: batch.batchId,
      eventId: batch.eventId,
      uploaderDeviceId: batch.uploaderDeviceId,
      receivedAt,
      ...tally,
    })
    await options.store.touchDevice(batch.eventId, batch.uploaderDeviceId)

    // Identifiers, counts and duration. Never a record.
    log(
      `batch=${batch.batchId} event=${batch.eventId} device=${batch.uploaderDeviceId} ` +
        `records=${batch.records.length} accepted=${tally.accepted} ` +
        `current=${tally.alreadyCurrent} newer=${tally.serverNewer} ` +
        `conflict=${tally.conflict} invalid=${tally.invalid} ms=${Date.now() - started}`,
    )

    const response: SyncBatchResponse = {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      batchId: batch.batchId,
      results,
    }
    return context.json(response)
  })

  if (options.sql !== undefined) {
    app.route(
      '/v1/reporting',
      createReportingRoutes({
        sql: options.sql,
        adminSecret: options.reportingSecret,
        log,
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    )
  }

  return app
}
