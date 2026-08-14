import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import type { Sql } from 'postgres'
import { runReconciliation } from '../reconciliation/postgres'
import { authorizeReporting } from './auth'
import {
  buildOverview,
  exportDuplicateCandidateRows,
  exportFeedbackRows,
  exportRegistrationRows,
  findRun,
  getFeedbackDetail,
  getRegistrationDetail,
  isUuid,
  listRuns,
  parseCursor,
  queryDuplicateCandidates,
  queryFeedback,
  queryRegistrations,
} from './postgres'
import {
  duplicateCandidatesCsv,
  exportFileName,
  feedbackCsv,
  registrationsCsv,
} from './exportCsv'
import { buildWorkbook } from './exportXlsx'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './types'

/*
 * The protected reporting API.
 *
 * Separate from Phase 6 ingest in every respect: its own credential, its own
 * module, its own routes. Ingest authorises a device to write what it captured;
 * this authorises an operator to read the whole event's participants. Sharing an
 * identity between those would mean a tablet left on a desk could pull every
 * name, phone number and email at the venue.
 *
 * Every response carrying central data is `no-store, private`. Reporting is
 * network-only: nothing here may end up in a browser cache, a proxy, or the
 * service worker.
 */

/*
 * Everything that reaches SQL is validated here first.
 *
 * `run_id` and `record_id` are `uuid` columns and cursors are cast to
 * `timestamptz` and `uuid`. A malformed value handed to Postgres is an error,
 * which surfaces as a 500: the wrong answer for a bad request, noisy in the
 * logs, and a channel for probing the schema through error behaviour. A client
 * that sends nonsense gets `400 invalid_request` and learns nothing else.
 */
const eventId = z.string().min(1).max(128)
const uuid = z.string().refine(isUuid, 'not a uuid')
const optionalRunId = uuid.optional()

/** A cursor must decode to a valid instant and a valid record id. */
const cursor = z
  .string()
  .max(512)
  .refine((value) => parseCursor(value) !== null, 'not a cursor')

/** Query-string parameters, which are only ever ids, never a search term. */
const idQuerySchema = z.object({
  eventId,
  runId: optionalRunId,
})

const recordPathSchema = z.object({
  eventId,
  runId: optionalRunId,
  recordId: uuid,
})

const duplicatesQuerySchema = idQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
})

/*
 * Search terms may contain a participant's name, phone number or email, so
 * queries are POSTed with a JSON body rather than placed in a URL. Query
 * strings end up in server access logs, browser history and `Referer` headers.
 */
const registrationQuerySchema = z.object({
  eventId,
  runId: optionalRunId,
  status: z
    .enum(['matched', 'without_feedback', 'multiple_feedback', 'all'])
    .optional(),
  search: z.string().max(200).optional(),
  duplicateCandidateOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: cursor.optional(),
})

const feedbackQuerySchema = z.object({
  eventId,
  runId: optionalRunId,
  status: z
    .enum([
      'matched',
      'without_registration',
      'identity_conflict',
      'multiple_feedback',
      'all',
    ])
    .optional(),
  search: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: cursor.optional(),
})

const reconcileSchema = z.object({ eventId })

export interface ReportingOptions {
  readonly sql: Sql
  readonly adminSecret: string | undefined
  readonly log?: (line: string) => void
  readonly now?: () => Date
}

const NO_RUN = {
  error: 'no_completed_run',
  message: 'No completed reconciliation run exists yet.',
} as const

export function createReportingRoutes(options: ReportingOptions) {
  const app = new Hono()
  const log = options.log ?? ((line: string) => console.log(line))
  const now = options.now ?? (() => new Date())

  /** Guards every route below and sets the anti-caching headers. */
  app.use('*', async (context, next) => {
    const auth = authorizeReporting(
      context.req.header('Authorization'),
      options.adminSecret,
    )

    /*
     * No participant data may be cached anywhere, not by the browser, not by
     * a proxy, not by a shared machine's disk cache. Set before the handler so
     * the headers are present on error responses too.
     */
    context.header('Cache-Control', 'no-store, private')
    context.header('Pragma', 'no-cache')
    context.header('X-Content-Type-Options', 'nosniff')
    context.header('Referrer-Policy', 'no-referrer')

    if (!auth.ok) {
      // The reason is logged for the operator's benefit; the credential never
      // is, and neither is the Authorization header.
      log(`reporting auth failed reason=${auth.reason} path=${context.req.path}`)

      return auth.reason === 'not_configured'
        ? context.json(
            {
              error: 'reporting_not_configured',
              message:
                'Central reporting is not configured on this server.',
            },
            503,
          )
        : context.json({ error: 'unauthorized' }, 401)
    }

    await next()
  })

  /** Resolves the run to report on: the requested one, or the latest. */
  async function resolveRun(eventIdValue: string, runIdValue?: string) {
    return findRun(options.sql, eventIdValue, runIdValue)
  }

  /**
   * Validated `eventId` / `runId` from the query string, or null.
   *
   * Returning null means the caller answers 400: nothing unvalidated may reach a
   * statement that casts it.
   */
  function ids(
    context: Context,
  ): { eventId: string; runId: string | undefined } | null {
    const parsed = idQuerySchema.safeParse({
      eventId: context.req.query('eventId'),
      runId: context.req.query('runId'),
    })
    if (!parsed.success) {
      return null
    }
    return { eventId: parsed.data.eventId, runId: parsed.data.runId }
  }

  app.get('/overview', async (context) => {
    const started = Date.now()
    const parsed = ids(context)
    if (parsed === null) {
      return context.json({ error: 'invalid_request' }, 400)
    }

    const overview = await buildOverview(options.sql, parsed.eventId, parsed.runId)
    if (overview === null) {
      return context.json(NO_RUN, 404)
    }

    log(
      `reporting overview event=${parsed.eventId} run=${overview.run.runId} ms=${Date.now() - started}`,
    )
    return context.json(overview)
  })

  app.get('/runs', async (context) => {
    const event = context.req.query('eventId')
    const parsed = eventId.safeParse(event)
    if (!parsed.success) {
      return context.json({ error: 'invalid_request' }, 400)
    }

    return context.json({ runs: await listRuns(options.sql, parsed.data) })
  })

  app.post('/registrations/query', async (context) => {
    const started = Date.now()
    const parsed = registrationQuerySchema.safeParse(
      await context.req.json().catch(() => null),
    )
    if (!parsed.success) {
      return context.json({ error: 'invalid_request' }, 400)
    }

    const run = await resolveRun(parsed.data.eventId, parsed.data.runId)
    if (run === null) {
      return context.json(NO_RUN, 404)
    }

    const page = await queryRegistrations(options.sql, {
      eventId: parsed.data.eventId,
      runId: run.runId,
      ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
      ...(parsed.data.search === undefined ? {} : { search: parsed.data.search }),
      ...(parsed.data.duplicateCandidateOnly === undefined
        ? {}
        : { duplicateCandidateOnly: parsed.data.duplicateCandidateOnly }),
      ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
      ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
    })

    // Counts and timings only. Never the body, and never the search term.
    log(
      `reporting registrations event=${parsed.data.eventId} run=${run.runId} rows=${page.rows.length} ms=${Date.now() - started}`,
    )
    return context.json({ run, ...page })
  })

  app.post('/feedback/query', async (context) => {
    const started = Date.now()
    const parsed = feedbackQuerySchema.safeParse(
      await context.req.json().catch(() => null),
    )
    if (!parsed.success) {
      return context.json({ error: 'invalid_request' }, 400)
    }

    const run = await resolveRun(parsed.data.eventId, parsed.data.runId)
    if (run === null) {
      return context.json(NO_RUN, 404)
    }

    const page = await queryFeedback(options.sql, {
      eventId: parsed.data.eventId,
      runId: run.runId,
      ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
      ...(parsed.data.search === undefined ? {} : { search: parsed.data.search }),
      ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
      ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
    })

    log(
      `reporting feedback event=${parsed.data.eventId} run=${run.runId} rows=${page.rows.length} ms=${Date.now() - started}`,
    )
    return context.json({ run, ...page })
  })

  app.get('/registrations/:recordId', async (context) => {
    const parsed = recordPathSchema.safeParse({
      eventId: context.req.query('eventId'),
      runId: context.req.query('runId'),
      recordId: context.req.param('recordId'),
    })
    if (!parsed.success) {
      return context.json({ error: 'invalid_request' }, 400)
    }

    const run = await resolveRun(parsed.data.eventId, parsed.data.runId)
    if (run === null) {
      return context.json(NO_RUN, 404)
    }

    /*
     * 404 covers both "no such record" and "not part of this run". They are the
     * same answer deliberately: a record the run never classified has no status
     * under it, and inventing one would misrepresent the snapshot.
     */
    const detail = await getRegistrationDetail(
      options.sql,
      parsed.data.eventId,
      run.runId,
      parsed.data.recordId,
    )

    return detail === null
      ? context.json({ error: 'not_found' }, 404)
      : context.json({ run, registration: detail })
  })

  app.get('/feedback/:recordId', async (context) => {
    const parsed = recordPathSchema.safeParse({
      eventId: context.req.query('eventId'),
      runId: context.req.query('runId'),
      recordId: context.req.param('recordId'),
    })
    if (!parsed.success) {
      return context.json({ error: 'invalid_request' }, 400)
    }

    const run = await resolveRun(parsed.data.eventId, parsed.data.runId)
    if (run === null) {
      return context.json(NO_RUN, 404)
    }

    const detail = await getFeedbackDetail(
      options.sql,
      parsed.data.eventId,
      run.runId,
      parsed.data.recordId,
    )

    return detail === null
      ? context.json({ error: 'not_found' }, 404)
      : context.json({ run, feedback: detail })
  })

  app.get('/duplicates', async (context) => {
    const parsed = duplicatesQuerySchema.safeParse({
      eventId: context.req.query('eventId'),
      runId: context.req.query('runId'),
      limit: context.req.query('limit'),
    })
    if (!parsed.success) {
      return context.json({ error: 'invalid_request' }, 400)
    }

    const run = await resolveRun(parsed.data.eventId, parsed.data.runId)
    if (run === null) {
      return context.json(NO_RUN, 404)
    }

    const candidates = await queryDuplicateCandidates(
      options.sql,
      parsed.data.eventId,
      run.runId,
      parsed.data.limit ?? DEFAULT_PAGE_SIZE,
    )

    /*
     * The run's own count is the truth about how many pairs exist. Reporting a
     * page of 50 with no hint that there were 300 would read as "that is all of
     * them", so the total travels with the page, and the CSV export is the
     * complete list.
     */
    const total = run.counts.duplicateRegistrationCandidateCount

    return context.json({
      run,
      candidates,
      totalCandidates: total,
      truncated: candidates.length < total,
    })
  })

  /**
   * Runs reconciliation on demand.
   *
   * The only writing endpoint in reporting, and it writes nothing itself; it
   * calls the Phase 7 implementation unchanged. Never automatic: an operator
   * asks for it, having seen that the data has moved.
   */
  app.post('/reconcile', async (context) => {
    const started = Date.now()
    const parsed = reconcileSchema.safeParse(
      await context.req.json().catch(() => null),
    )
    if (!parsed.success) {
      return context.json({ error: 'invalid_request' }, 400)
    }

    const { runId, output } = await runReconciliation(
      options.sql,
      parsed.data.eventId,
    )
    const run = await findRun(options.sql, parsed.data.eventId, runId)

    log(
      `reporting reconcile event=${parsed.data.eventId} run=${runId} ms=${Date.now() - started}`,
    )

    return context.json({
      runId,
      completedAt: run?.completedAt ?? null,
      counts: output.counts,
    })
  })

  /* ---- exports ---- */

  function attach(context: Context, fileName: string, contentType: string): void {
    context.header('Content-Type', contentType)
    context.header('Content-Disposition', `attachment; filename="${fileName}"`)
  }

  app.get('/export/:kind', async (context) => {
    const started = Date.now()
    const kind = context.req.param('kind')
    const parsed = ids(context)

    if (parsed === null) {
      return context.json({ error: 'invalid_request' }, 400)
    }

    const event = parsed.eventId
    const run = await resolveRun(event, parsed.runId)
    if (run === null) {
      return context.json(NO_RUN, 404)
    }

    const generatedAt = now()

    if (kind === 'registrations.csv') {
      const rows = await exportRegistrationRows(options.sql, event, run.runId)
      attach(
        context,
        exportFileName(event, 'registrations', 'csv', generatedAt),
        'text/csv; charset=utf-8',
      )
      log(
        `reporting export kind=registrations rows=${rows.length} run=${run.runId} ms=${Date.now() - started}`,
      )
      return context.body(registrationsCsv(run, rows))
    }

    if (kind === 'feedback.csv') {
      const rows = await exportFeedbackRows(options.sql, event, run.runId)
      attach(
        context,
        exportFileName(event, 'feedback', 'csv', generatedAt),
        'text/csv; charset=utf-8',
      )
      log(
        `reporting export kind=feedback rows=${rows.length} run=${run.runId} ms=${Date.now() - started}`,
      )
      return context.body(feedbackCsv(run, rows))
    }

    if (kind === 'duplicate-candidates.csv') {
      const rows = await exportDuplicateCandidateRows(options.sql, event, run.runId)
      attach(
        context,
        exportFileName(event, 'duplicate-candidates', 'csv', generatedAt),
        'text/csv; charset=utf-8',
      )
      log(
        `reporting export kind=duplicates rows=${rows.length} run=${run.runId} ms=${Date.now() - started}`,
      )
      return context.body(duplicateCandidatesCsv(run, rows))
    }

    if (kind === 'report.xlsx') {
      const overview = await buildOverview(options.sql, event, run.runId)
      if (overview === null) {
        return context.json(NO_RUN, 404)
      }

      const [registrations, feedback, duplicates] = await Promise.all([
        exportRegistrationRows(options.sql, event, run.runId),
        exportFeedbackRows(options.sql, event, run.runId),
        exportDuplicateCandidateRows(options.sql, event, run.runId),
      ])

      const workbook = await buildWorkbook({
        overview,
        registrations,
        feedback,
        duplicates,
        generatedAt,
      })

      attach(
        context,
        exportFileName(event, 'report', 'xlsx', generatedAt),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      log(
        `reporting export kind=xlsx registrations=${registrations.length} feedback=${feedback.length} run=${run.runId} ms=${Date.now() - started}`,
      )
      return context.body(new Uint8Array(workbook))
    }

    return context.json({ error: 'unknown_export' }, 404)
  })

  return app
}
