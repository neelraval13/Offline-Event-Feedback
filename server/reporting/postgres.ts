import type { Sql } from 'postgres'
import { computeAnalytics, computeCoverage, SUPPORTED_FORM_VERSION } from './analytics'
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type DuplicateCandidateRow,
  type DuplicateSide,
  type FeedbackDetail,
  type FeedbackRow,
  type FreshnessReport,
  type OverviewResponse,
  type Page,
  type RegistrationDetail,
  type RegistrationRow,
  type RunDescriptor,
} from './types'

/*
 * The reporting read layer.
 *
 * Filtering, joining, counting and pagination all happen in Postgres. Loading
 * ten thousand registrations into Node to filter them in JavaScript would work
 * on the test fixture and fall over at an event.
 *
 * Every query here reads. Nothing in this file writes to any table — reporting
 * is read-only with respect to event evidence, and the one action that does
 * write (running reconciliation) goes through the Phase 7 implementation
 * unchanged.
 *
 * ## A run's membership is exactly its results
 *
 * Every browse, detail and export query is driven **from** the reconciliation
 * result tables and joins the raw record, never the other way around. A run is a
 * snapshot: the registrations and responses that belong to it are precisely the
 * ones it reached a conclusion about.
 *
 * Starting from `registrations` and left-joining the run reads almost the same
 * and is wrong in a way that matters. Sync keeps running after a run completes,
 * so a record that arrived afterwards would appear in a historical view with no
 * status — and, worse, in a historical export, which is then a file describing a
 * state of the event that never existed. Row counts would silently disagree with
 * the run's own counts, which is exactly the arithmetic an operator uses to
 * check a report.
 *
 * Current canonical PII (name, phone, email, answers) is read live for those
 * records, and the reports say so. Copying a name into a reconciliation table to
 * freeze it would make reporting a writer of PII and give the event two
 * disagreeing copies of every participant.
 *
 * ## Questionnaire fields are read only for the version they belong to
 *
 * `overall_rating`, `experience`, `recommend` and `comments` are `feedback-v1`
 * fields. Every query that extracts them guards on `form_version`, so a future
 * questionnaire that happens to reuse a key name cannot have its answers read as
 * if they meant the same thing. The response itself is never hidden: the detail
 * view shows the raw answers alongside the version they were captured under.
 */

type Row = Record<string, unknown>

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

function toIsoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : toIso(value)
}

function mapRun(row: Row): RunDescriptor {
  return {
    runId: String(row['run_id']),
    eventId: String(row['event_id']),
    engineVersion: String(row['engine_version']),
    startedAt: toIso(row['started_at']),
    completedAt: toIso(row['completed_at']),
    counts: {
      registrationCount: Number(row['registration_count']),
      feedbackCount: Number(row['feedback_count']),
      matchedRegistrations: Number(row['matched_registrations']),
      registrationsWithoutFeedback: Number(row['registrations_without_feedback']),
      registrationsWithMultipleFeedback: Number(
        row['registrations_with_multiple_feedback'],
      ),
      matchedFeedback: Number(row['matched_feedback']),
      feedbackWithoutRegistration: Number(row['feedback_without_registration']),
      feedbackIdentityConflicts: Number(row['feedback_identity_conflicts']),
      feedbackInMultipleGroups: Number(row['feedback_in_multiple_groups']),
      duplicateRegistrationCandidateCount: Number(
        row['duplicate_registration_candidate_count'],
      ),
    },
  }
}

/** The most recent completed run, or a specific one when asked for. */
export async function findRun(
  sql: Sql,
  eventId: string,
  runId?: string,
): Promise<RunDescriptor | null> {
  const rows =
    runId === undefined
      ? await sql<Row[]>`
          SELECT * FROM reconciliation_runs
          WHERE event_id = ${eventId} AND completed_at IS NOT NULL
          ORDER BY completed_at DESC, started_at DESC
          LIMIT 1
        `
      : await sql<Row[]>`
          SELECT * FROM reconciliation_runs
          WHERE event_id = ${eventId} AND run_id = ${runId}
            AND completed_at IS NOT NULL
        `

  const row = rows[0]
  return row === undefined ? null : mapRun(row)
}

export async function listRuns(
  sql: Sql,
  eventId: string,
  limit = 20,
): Promise<RunDescriptor[]> {
  const rows = await sql<Row[]>`
    SELECT * FROM reconciliation_runs
    WHERE event_id = ${eventId} AND completed_at IS NOT NULL
    ORDER BY completed_at DESC
    LIMIT ${limit}
  `
  return rows.map(mapRun)
}

/**
 * Whether central data moved after a run finished.
 *
 * Two independent facts, because there are two ways a run can stop describing
 * the event:
 *
 *   1. Something arrived that the run never saw. A run's membership is exactly
 *      the records it classified, so anything present now and absent from its
 *      results arrived afterwards. This needs no timestamp at all and is immune
 *      to every clock in the system.
 *   2. Something the run did classify was revised afterwards. That needs a
 *      server-side signal, and `content_changed_at` (migration 004) is it.
 *
 * `last_received_at` is deliberately not consulted. Phase 6 touches it on an
 * idempotent re-delivery — an offline tablet reconnecting and re-sending a batch
 * it had already delivered — and treating that as a change reported every such
 * reconnection as stale data. Device `created_at` is not consulted either:
 * offline device clocks are never corrected, so a tablet running slow could make
 * a genuinely newer record look older than the run and hide staleness entirely.
 */
export async function assessFreshness(
  sql: Sql,
  eventId: string,
  run: RunDescriptor,
): Promise<FreshnessReport> {
  const [row] = await sql<Row[]>`
    SELECT
      (SELECT count(*) FROM registrations WHERE event_id = ${eventId}) AS registration_count,
      (SELECT count(*) FROM feedback      WHERE event_id = ${eventId}) AS feedback_count,

      -- Records present now that this run never classified.
      (SELECT count(*) FROM registrations reg
        WHERE reg.event_id = ${eventId}
          AND NOT EXISTS (
            SELECT 1 FROM reconciliation_registration_results res
            WHERE res.run_id = ${run.runId}
              AND res.registration_record_id = reg.record_id
          )) AS registrations_added,
      (SELECT count(*) FROM feedback fb
        WHERE fb.event_id = ${eventId}
          AND NOT EXISTS (
            SELECT 1 FROM reconciliation_feedback_results res
            WHERE res.run_id = ${run.runId}
              AND res.feedback_record_id = fb.record_id
          )) AS feedback_added,

      -- The last time the server accepted new content for this event. Set by an
      -- insert or an accepted revision; never by an idempotent retry.
      GREATEST(
        (SELECT max(content_changed_at) FROM registrations WHERE event_id = ${eventId}),
        (SELECT max(content_changed_at) FROM feedback      WHERE event_id = ${eventId})
      ) AS latest_content_change
  `

  const currentRegistrationCount = Number(row?.['registration_count'] ?? 0)
  const currentFeedbackCount = Number(row?.['feedback_count'] ?? 0)
  const registrationsAddedSinceRun = Number(row?.['registrations_added'] ?? 0)
  const feedbackAddedSinceRun = Number(row?.['feedback_added'] ?? 0)
  const latestContentChangeAt = toIsoOrNull(row?.['latest_content_change'])

  const revisedAfterRun =
    latestContentChangeAt !== null &&
    Date.parse(latestContentChangeAt) > Date.parse(run.completedAt)

  return {
    dataChangedSinceRun:
      registrationsAddedSinceRun > 0 ||
      feedbackAddedSinceRun > 0 ||
      revisedAfterRun,
    currentRegistrationCount,
    currentFeedbackCount,
    registrationsAddedSinceRun,
    feedbackAddedSinceRun,
    latestContentChangeAt,
  }
}

export async function buildOverview(
  sql: Sql,
  eventId: string,
  runId?: string,
): Promise<OverviewResponse | null> {
  const run = await findRun(sql, eventId, runId)
  if (run === null) {
    return null
  }

  const latest = await findRun(sql, eventId)
  const freshness = await assessFreshness(sql, eventId, run)

  /*
   * Analytics reads only responses this run classified `matched`. The filter is
   * a join rather than a post-filter so the database never hands over the
   * ambiguous ones at all.
   */
  const analysable = await sql<Row[]>`
    SELECT f.form_version, f.answers
    FROM reconciliation_feedback_results r
    JOIN feedback f ON f.record_id = r.feedback_record_id
    WHERE r.run_id = ${run.runId} AND r.status = 'matched'
  `

  return {
    eventId,
    run,
    isHistoricalRun: latest !== null && latest.runId !== run.runId,
    freshness,
    analytics: computeAnalytics(
      analysable.map((row) => ({
        formVersion: String(row['form_version']),
        answers: (row['answers'] ?? {}) as Record<string, unknown>,
      })),
    ),
    coverage: computeCoverage(run),
  }
}

/* ------------------------------------------------------------------ *
 * Pagination
 * ------------------------------------------------------------------ */

interface Cursor {
  readonly createdAt: string
  readonly recordId: string
}

/** Opaque to the client: it encodes an ordering position, not a page number. */
function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.recordId}`, 'utf8').toString(
    'base64url',
  )
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether a value is a UUID this schema could hold. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

/**
 * Parses a cursor, or reports that it is not one.
 *
 * Both halves are validated before they can reach the query, where they are cast
 * to `timestamptz` and `uuid`. An unparseable cast is a Postgres error, which
 * surfaces as a 500 — the wrong answer entirely for a client that sent a
 * malformed cursor, and an invitation to probe the database through it.
 *
 * A cursor is opaque to the client, so anything that fails to parse was either
 * corrupted in transit or hand-made. Neither deserves a page of results.
 */
export function parseCursor(value: string): Cursor | null {
  let decoded: string
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const separator = decoded.lastIndexOf('|')
  if (separator === -1) {
    return null
  }

  const createdAt = decoded.slice(0, separator)
  const recordId = decoded.slice(separator + 1)

  if (!isUuid(recordId)) {
    return null
  }

  // An ISO instant that round-trips: `Date.parse` alone accepts a great deal
  // that Postgres would then reject or reinterpret.
  const parsed = new Date(createdAt)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== createdAt) {
    return null
  }

  return { createdAt, recordId }
}

function decodeCursor(value: string | undefined | null): Cursor | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }

  // Defence in depth: routes reject a malformed cursor with 400 before reaching
  // here, and a bad one that arrives anyway is treated as no cursor rather than
  // being handed to the database.
  return parseCursor(value)
}

function clampPageSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_PAGE_SIZE
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE)
}

/* ------------------------------------------------------------------ *
 * Registrations
 * ------------------------------------------------------------------ */

export interface RegistrationQuery {
  readonly eventId: string
  readonly runId: string
  readonly status?: 'matched' | 'without_feedback' | 'multiple_feedback' | 'all'
  readonly search?: string
  readonly duplicateCandidateOnly?: boolean
  readonly limit?: number
  readonly cursor?: string
}

function mapRegistrationRow(row: Row): RegistrationRow {
  // Never null: every row came from the run's own results.
  const status = String(row['status']) as RegistrationRow['reconciliationStatus']

  /*
   * A summary is attached only for `matched`, where exactly one valid response
   * exists. For `multiple_feedback` the SQL deliberately returns nothing:
   * showing one of several would imply the run had picked a winner, which it
   * explicitly refuses to do.
   */
  const hasSummary =
    status === 'matched' && row['overall_rating'] !== null &&
    row['overall_rating'] !== undefined

  return {
    recordId: String(row['record_id']),
    participantId: String(row['participant_id']),
    publicCode: String(row['public_code']),
    name: String(row['name']),
    phone: String(row['phone']),
    email: String(row['email']),
    createdAt: toIso(row['created_at']),
    revision: Number(row['revision']),
    reconciliationStatus: status,
    validFeedbackCount: Number(row['valid_feedback_count'] ?? 0),
    potentialDuplicate: row['potential_duplicate'] === true,
    feedbackSummary: hasSummary
      ? {
          overallRating: Number(row['overall_rating']),
          experience:
            row['experience'] === null || row['experience'] === undefined
              ? null
              : String(row['experience']),
          recommend:
            row['recommend'] === null || row['recommend'] === undefined
              ? null
              : row['recommend'] === true,
        }
      : null,
  }
}

export async function queryRegistrations(
  sql: Sql,
  query: RegistrationQuery,
): Promise<Page<RegistrationRow>> {
  const pageSize = clampPageSize(query.limit)
  const cursor = decodeCursor(query.cursor)
  const status = query.status ?? 'all'
  const search = query.search?.trim() ?? ''

  const rows = await sql<Row[]>`
    WITH matched_feedback AS (
      -- Only for matched registrations, which have exactly one valid response.
      -- The version guard means a v2 response contributes no v1 answer columns.
      SELECT r.registration_record_id,
             CASE WHEN f.form_version = ${SUPPORTED_FORM_VERSION}
                  THEN f.answers ->> 'overall_rating' END AS overall_rating,
             CASE WHEN f.form_version = ${SUPPORTED_FORM_VERSION}
                  THEN f.answers ->> 'experience' END     AS experience,
             CASE WHEN f.form_version = ${SUPPORTED_FORM_VERSION}
                  THEN f.answers -> 'recommend' END       AS recommend
      FROM reconciliation_feedback_results r
      JOIN feedback f ON f.record_id = r.feedback_record_id
      WHERE r.run_id = ${query.runId} AND r.status = 'matched'
    ),
    duplicates AS (
      SELECT left_registration_record_id AS record_id FROM reconciliation_duplicate_registration_candidates WHERE run_id = ${query.runId}
      UNION
      SELECT right_registration_record_id FROM reconciliation_duplicate_registration_candidates WHERE run_id = ${query.runId}
    )
    -- Driven from the run's own results: one row per registration the run
    -- classified, and nothing that arrived afterwards.
    SELECT reg.record_id, reg.participant_id, reg.public_code,
           reg.name, reg.phone, reg.email,
           reg.created_at, reg.revision,
           res.status, res.valid_feedback_count,
           (dup.record_id IS NOT NULL) AS potential_duplicate,
           mf.overall_rating, mf.experience, mf.recommend
    FROM reconciliation_registration_results res
    JOIN registrations reg ON reg.record_id = res.registration_record_id
    LEFT JOIN duplicates dup ON dup.record_id = reg.record_id
    LEFT JOIN matched_feedback mf ON mf.registration_record_id = reg.record_id
    WHERE res.run_id = ${query.runId} AND reg.event_id = ${query.eventId}
      ${status === 'all' ? sql`` : sql`AND res.status = ${status}`}
      ${query.duplicateCandidateOnly === true ? sql`AND dup.record_id IS NOT NULL` : sql``}
      ${
        search === ''
          ? sql``
          : sql`AND (reg.public_code ILIKE ${`%${search}%`}
                  OR reg.name ILIKE ${`%${search}%`}
                  OR reg.phone ILIKE ${`%${search}%`}
                  OR reg.email ILIKE ${`%${search}%`})`
      }
      ${
        cursor === null
          ? sql``
          : sql`AND (reg.created_at, reg.record_id) > (${cursor.createdAt}::timestamptz, ${cursor.recordId}::uuid)`
      }
    ORDER BY reg.created_at, reg.record_id
    LIMIT ${pageSize + 1}
  `

  return buildPage(rows, pageSize, mapRegistrationRow, (row) => ({
    createdAt: toIso(row['created_at']),
    recordId: String(row['record_id']),
  }))
}

/* ------------------------------------------------------------------ *
 * Feedback
 * ------------------------------------------------------------------ */

export interface FeedbackQuery {
  readonly eventId: string
  readonly runId: string
  readonly status?:
    | 'matched'
    | 'without_registration'
    | 'identity_conflict'
    | 'multiple_feedback'
    | 'all'
  readonly search?: string
  readonly limit?: number
  readonly cursor?: string
}

function mapFeedbackRow(row: Row): FeedbackRow {
  const linkedId = row['linked_record_id']

  return {
    recordId: String(row['record_id']),
    publicCode: String(row['public_code']),
    participantId:
      row['participant_id'] === null || row['participant_id'] === undefined
        ? null
        : String(row['participant_id']),
    captureMethod: String(row['capture_method']) === 'qr' ? 'qr' : 'manual',
    formVersion: String(row['form_version']),
    createdAt: toIso(row['created_at']),
    revision: Number(row['revision']),
    // Never null: every row came from the run's own results.
    reconciliationStatus: String(row['status']) as FeedbackRow['reconciliationStatus'],
    matchMethod:
      row['match_method'] === null || row['match_method'] === undefined
        ? null
        : (String(row['match_method']) as FeedbackRow['matchMethod']),
    overallRating:
      row['overall_rating'] === null || row['overall_rating'] === undefined
        ? null
        : Number(row['overall_rating']),
    experience:
      row['experience'] === null || row['experience'] === undefined
        ? null
        : String(row['experience']),
    recommend:
      row['recommend'] === null || row['recommend'] === undefined
        ? null
        : row['recommend'] === true || row['recommend'] === 'true',
    linkedRegistration:
      linkedId === null || linkedId === undefined
        ? null
        : {
            recordId: String(linkedId),
            publicCode: String(row['linked_public_code']),
            name: String(row['linked_name']),
          },
  }
}

export async function queryFeedback(
  sql: Sql,
  query: FeedbackQuery,
): Promise<Page<FeedbackRow>> {
  const pageSize = clampPageSize(query.limit)
  const cursor = decodeCursor(query.cursor)
  const status = query.status ?? 'all'
  const search = query.search?.trim() ?? ''

  const rows = await sql<Row[]>`
    -- Driven from the run's own results, same rule as the participant browser.
    SELECT fb.record_id, fb.public_code, fb.participant_id, fb.capture_method,
           fb.form_version, fb.created_at, fb.revision,
           CASE WHEN fb.form_version = ${SUPPORTED_FORM_VERSION}
                THEN fb.answers ->> 'overall_rating' END AS overall_rating,
           CASE WHEN fb.form_version = ${SUPPORTED_FORM_VERSION}
                THEN fb.answers ->> 'experience' END     AS experience,
           CASE WHEN fb.form_version = ${SUPPORTED_FORM_VERSION}
                THEN fb.answers -> 'recommend' END       AS recommend,
           res.status, res.match_method,
           reg.record_id  AS linked_record_id,
           reg.public_code AS linked_public_code,
           reg.name        AS linked_name
    FROM reconciliation_feedback_results res
    JOIN feedback fb ON fb.record_id = res.feedback_record_id
    LEFT JOIN registrations reg ON reg.record_id = res.registration_record_id
    WHERE res.run_id = ${query.runId} AND fb.event_id = ${query.eventId}
      ${status === 'all' ? sql`` : sql`AND res.status = ${status}`}
      ${
        search === ''
          ? sql``
          : sql`AND (fb.public_code ILIKE ${`%${search}%`}
                  OR reg.public_code ILIKE ${`%${search}%`}
                  OR reg.name ILIKE ${`%${search}%`}
                  OR reg.phone ILIKE ${`%${search}%`}
                  OR reg.email ILIKE ${`%${search}%`})`
      }
      ${
        cursor === null
          ? sql``
          : sql`AND (fb.created_at, fb.record_id) > (${cursor.createdAt}::timestamptz, ${cursor.recordId}::uuid)`
      }
    ORDER BY fb.created_at, fb.record_id
    LIMIT ${pageSize + 1}
  `

  return buildPage(rows, pageSize, mapFeedbackRow, (row) => ({
    createdAt: toIso(row['created_at']),
    recordId: String(row['record_id']),
  }))
}

function buildPage<T>(
  rows: Row[],
  pageSize: number,
  map: (row: Row) => T,
  cursorOf: (row: Row) => Cursor,
): Page<T> {
  // One extra row was requested purely to learn whether another page exists.
  const hasMore = rows.length > pageSize
  const page = hasMore ? rows.slice(0, pageSize) : rows
  const last = page[page.length - 1]

  return {
    rows: page.map(map),
    nextCursor: hasMore && last !== undefined ? encodeCursor(cursorOf(last)) : null,
    pageSize,
  }
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */

export async function getRegistrationDetail(
  sql: Sql,
  eventId: string,
  runId: string,
  recordId: string,
): Promise<RegistrationDetail | null> {
  /*
   * The join is inner: a record the run never classified is not part of it, and
   * answering with its details under a run that never saw it would be a lie the
   * caller cannot detect. Absent from the run reads the same as absent — 404.
   */
  const [row] = await sql<Row[]>`
    SELECT reg.*, res.status, res.valid_feedback_count,
           EXISTS (
             SELECT 1 FROM reconciliation_duplicate_registration_candidates d
             WHERE d.run_id = ${runId}
               AND (d.left_registration_record_id = reg.record_id
                 OR d.right_registration_record_id = reg.record_id)
           ) AS potential_duplicate
    FROM reconciliation_registration_results res
    JOIN registrations reg ON reg.record_id = res.registration_record_id
    WHERE res.run_id = ${runId}
      AND reg.record_id = ${recordId}
      AND reg.event_id = ${eventId}
  `

  if (row === undefined) {
    return null
  }

  // Every valid response, never reduced to one.
  const feedbackRows = await sql<Row[]>`
    SELECT fb.record_id, fb.public_code, fb.participant_id, fb.capture_method,
           fb.form_version, fb.created_at, fb.revision,
           CASE WHEN fb.form_version = ${SUPPORTED_FORM_VERSION}
                THEN fb.answers ->> 'overall_rating' END AS overall_rating,
           CASE WHEN fb.form_version = ${SUPPORTED_FORM_VERSION}
                THEN fb.answers ->> 'experience' END     AS experience,
           CASE WHEN fb.form_version = ${SUPPORTED_FORM_VERSION}
                THEN fb.answers -> 'recommend' END       AS recommend,
           res.status, res.match_method,
           NULL AS linked_record_id, NULL AS linked_public_code, NULL AS linked_name
    FROM reconciliation_feedback_results res
    JOIN feedback fb ON fb.record_id = res.feedback_record_id
    WHERE res.run_id = ${runId} AND res.registration_record_id = ${recordId}
    ORDER BY fb.created_at, fb.record_id
  `

  const base = mapRegistrationRow({ ...row, overall_rating: null })

  return {
    ...base,
    eventId: String(row['event_id']),
    eventDay: toIso(row['event_day']).slice(0, 10),
    stationId: String(row['station_id']),
    sourceDeviceId: String(row['source_device_id']),
    lastUploaderDeviceId: String(row['last_uploader_device_id']),
    updatedAt: toIso(row['updated_at']),
    feedback: feedbackRows.map(mapFeedbackRow),
  }
}

async function resolveSide(
  sql: Sql,
  eventId: string,
  column: 'participant_id' | 'public_code',
  value: string,
): Promise<DuplicateSide | null> {
  const rows =
    column === 'participant_id'
      ? await sql<Row[]>`
          SELECT record_id, public_code, name, phone, email FROM registrations
          WHERE event_id = ${eventId} AND participant_id = ${value}
        `
      : await sql<Row[]>`
          SELECT record_id, public_code, name, phone, email FROM registrations
          WHERE event_id = ${eventId} AND public_code = ${value}
        `

  const row = rows[0]
  return row === undefined
    ? null
    : {
        recordId: String(row['record_id']),
        publicCode: String(row['public_code']),
        name: String(row['name']),
        phone: String(row['phone']),
        email: String(row['email']),
      }
}

export async function getFeedbackDetail(
  sql: Sql,
  eventId: string,
  runId: string,
  recordId: string,
): Promise<FeedbackDetail | null> {
  // Inner join, for the same reason as the registration detail above.
  const [row] = await sql<Row[]>`
    SELECT fb.*, res.status, res.match_method,
           reg.record_id  AS linked_record_id,
           reg.public_code AS linked_public_code,
           reg.name        AS linked_name
    FROM reconciliation_feedback_results res
    JOIN feedback fb ON fb.record_id = res.feedback_record_id
    LEFT JOIN registrations reg ON reg.record_id = res.registration_record_id
    WHERE res.run_id = ${runId}
      AND fb.record_id = ${recordId}
      AND fb.event_id = ${eventId}
  `

  if (row === undefined) {
    return null
  }

  const answers = (row['answers'] ?? {}) as Record<string, unknown>

  /*
   * The summary fields are `feedback-v1` fields. Under any other version they
   * stay null and the screen shows the raw answers with their version instead —
   * a v2 questionnaire may well have an `overall_rating` that means something
   * else entirely, and quietly reading it as a 1-5 score would invent data.
   */
  const isSupportedVersion = String(row['form_version']) === SUPPORTED_FORM_VERSION
  const base = mapFeedbackRow({
    ...row,
    overall_rating: isSupportedVersion ? (answers['overall_rating'] ?? null) : null,
    experience: isSupportedVersion ? (answers['experience'] ?? null) : null,
    recommend: isSupportedVersion ? (answers['recommend'] ?? null) : null,
  })

  /*
   * For an identity conflict, show what each identifier resolves to *now*.
   * Labelled as diagnostics in the UI: this is a live lookup, not something the
   * run decided, and the run deliberately decided nothing.
   */
  const isConflict = base.reconciliationStatus === 'identity_conflict'
  const participantId = base.participantId

  return {
    ...base,
    eventId: String(row['event_id']),
    eventDay: toIso(row['event_day']).slice(0, 10),
    stationId: String(row['station_id']),
    sourceDeviceId: String(row['source_device_id']),
    lastUploaderDeviceId: String(row['last_uploader_device_id']),
    updatedAt: toIso(row['updated_at']),
    answers,
    diagnostics: isConflict
      ? {
          participantIdResolvesTo:
            participantId === null
              ? null
              : await resolveSide(sql, eventId, 'participant_id', participantId),
          publicCodeResolvesTo: await resolveSide(
            sql,
            eventId,
            'public_code',
            base.publicCode,
          ),
        }
      : null,
  }
}

/* ------------------------------------------------------------------ *
 * Duplicate candidates
 * ------------------------------------------------------------------ */

export async function queryDuplicateCandidates(
  sql: Sql,
  eventId: string,
  runId: string,
  limit: number = DEFAULT_PAGE_SIZE,
): Promise<DuplicateCandidateRow[]> {
  /*
   * Phase 7 stores record IDs only, deliberately. Reporting joins back to the
   * raw rows to show an operator both sides — which is exactly why this
   * endpoint is behind the privileged reporting credential.
   */
  const rows = await sql<Row[]>`
    SELECT d.match_basis,
           l.record_id AS l_id, l.public_code AS l_code, l.name AS l_name,
           l.phone AS l_phone, l.email AS l_email,
           r.record_id AS r_id, r.public_code AS r_code, r.name AS r_name,
           r.phone AS r_phone, r.email AS r_email
    FROM reconciliation_duplicate_registration_candidates d
    JOIN registrations l ON l.record_id = d.left_registration_record_id
    JOIN registrations r ON r.record_id = d.right_registration_record_id
    WHERE d.run_id = ${runId} AND l.event_id = ${eventId}
    ORDER BY d.match_basis, l.public_code, r.public_code
    LIMIT ${limit}
  `

  return rows.map((row) => ({
    matchBasis: String(row['match_basis']) as DuplicateCandidateRow['matchBasis'],
    left: {
      recordId: String(row['l_id']),
      publicCode: String(row['l_code']),
      name: String(row['l_name']),
      phone: String(row['l_phone']),
      email: String(row['l_email']),
    },
    right: {
      recordId: String(row['r_id']),
      publicCode: String(row['r_code']),
      name: String(row['r_name']),
      phone: String(row['r_phone']),
      email: String(row['r_email']),
    },
  }))
}

/* ------------------------------------------------------------------ *
 * Export queries
 *
 * Single statements rather than a paging loop: an export is the whole run, and
 * walking 10,000 rows a page at a time would be a hundred round trips to build
 * one file.
 * ------------------------------------------------------------------ */

export interface RegistrationExportRow {
  readonly recordId: string
  readonly participantId: string
  readonly publicCode: string
  readonly name: string
  readonly phone: string
  readonly email: string
  readonly createdAt: string
  readonly revision: number
  readonly status: string
  readonly validFeedbackCount: number
  readonly potentialDuplicate: boolean
  /** Populated only for `matched`. Blank for the ambiguous and the unmatched. */
  readonly feedbackRecordId: string | null
  readonly captureMethod: string | null
  readonly overallRating: string | null
  readonly experience: string | null
  readonly recommend: string | null
  readonly comments: string | null
}

export async function exportRegistrationRows(
  sql: Sql,
  eventId: string,
  runId: string,
): Promise<RegistrationExportRow[]> {
  const rows = await sql<Row[]>`
    WITH matched_feedback AS (
      -- Joined only for matched rows, which have exactly one valid response,
      -- and only for the questionnaire version these columns describe.
      SELECT r.registration_record_id, f.record_id AS feedback_record_id,
             f.capture_method,
             CASE WHEN f.form_version = ${SUPPORTED_FORM_VERSION}
                  THEN f.answers ->> 'overall_rating' END AS overall_rating,
             CASE WHEN f.form_version = ${SUPPORTED_FORM_VERSION}
                  THEN f.answers ->> 'experience' END     AS experience,
             CASE WHEN f.form_version = ${SUPPORTED_FORM_VERSION}
                  THEN f.answers -> 'recommend' END       AS recommend,
             CASE WHEN f.form_version = ${SUPPORTED_FORM_VERSION}
                  THEN f.answers ->> 'comments' END       AS comments
      FROM reconciliation_feedback_results r
      JOIN feedback f ON f.record_id = r.feedback_record_id
      WHERE r.run_id = ${runId} AND r.status = 'matched'
    ),
    duplicates AS (
      SELECT left_registration_record_id AS record_id FROM reconciliation_duplicate_registration_candidates WHERE run_id = ${runId}
      UNION
      SELECT right_registration_record_id FROM reconciliation_duplicate_registration_candidates WHERE run_id = ${runId}
    )
    -- Exactly one row per registration the run classified, so the file's row
    -- count equals the run's own registration count.
    SELECT reg.record_id, reg.participant_id, reg.public_code,
           reg.name, reg.phone, reg.email, reg.created_at, reg.revision,
           res.status, res.valid_feedback_count,
           (dup.record_id IS NOT NULL) AS potential_duplicate,
           mf.feedback_record_id, mf.capture_method,
           mf.overall_rating, mf.experience, mf.recommend, mf.comments
    FROM reconciliation_registration_results res
    JOIN registrations reg ON reg.record_id = res.registration_record_id
    LEFT JOIN duplicates dup ON dup.record_id = reg.record_id
    LEFT JOIN matched_feedback mf ON mf.registration_record_id = reg.record_id
    WHERE res.run_id = ${runId} AND reg.event_id = ${eventId}
    ORDER BY reg.created_at, reg.record_id
  `

  return rows.map((row) => {
    const matched = String(row['status']) === 'matched'

    return {
      recordId: String(row['record_id']),
      participantId: String(row['participant_id']),
      publicCode: String(row['public_code']),
      name: String(row['name']),
      phone: String(row['phone']),
      email: String(row['email']),
      createdAt: toIso(row['created_at']),
      revision: Number(row['revision']),
      status: String(row['status']),
      validFeedbackCount: Number(row['valid_feedback_count']),
      potentialDuplicate: row['potential_duplicate'] === true,
      // For `multiple_feedback` these stay blank: choosing one response would
      // present a guess as the participant's answer. The individual responses
      // are all present in the feedback export.
      feedbackRecordId: matched ? toStringOrNull(row['feedback_record_id']) : null,
      captureMethod: matched ? toStringOrNull(row['capture_method']) : null,
      overallRating: matched ? toStringOrNull(row['overall_rating']) : null,
      experience: matched ? toStringOrNull(row['experience']) : null,
      recommend: matched ? toStringOrNull(row['recommend']) : null,
      comments: matched ? toStringOrNull(row['comments']) : null,
    }
  })
}

export interface FeedbackExportRow {
  readonly recordId: string
  readonly publicCode: string
  readonly participantId: string | null
  readonly captureMethod: string
  readonly formVersion: string
  readonly createdAt: string
  readonly revision: number
  readonly status: string
  readonly matchMethod: string | null
  readonly registrationRecordId: string | null
  readonly registrationPublicCode: string | null
  readonly registrationName: string | null
  readonly registrationPhone: string | null
  readonly registrationEmail: string | null
  readonly overallRating: string | null
  readonly experience: string | null
  readonly recommend: string | null
  readonly comments: string | null
}

export async function exportFeedbackRows(
  sql: Sql,
  eventId: string,
  runId: string,
): Promise<FeedbackExportRow[]> {
  const rows = await sql<Row[]>`
    -- One row per response the run classified: the file's row count equals the
    -- run's own feedback count.
    SELECT fb.record_id, fb.public_code, fb.participant_id, fb.capture_method,
           fb.form_version, fb.created_at, fb.revision,
           CASE WHEN fb.form_version = ${SUPPORTED_FORM_VERSION}
                THEN fb.answers ->> 'overall_rating' END AS overall_rating,
           CASE WHEN fb.form_version = ${SUPPORTED_FORM_VERSION}
                THEN fb.answers ->> 'experience' END     AS experience,
           CASE WHEN fb.form_version = ${SUPPORTED_FORM_VERSION}
                THEN fb.answers -> 'recommend' END       AS recommend,
           CASE WHEN fb.form_version = ${SUPPORTED_FORM_VERSION}
                THEN fb.answers ->> 'comments' END       AS comments,
           res.status, res.match_method,
           reg.record_id AS reg_id, reg.public_code AS reg_code,
           reg.name AS reg_name, reg.phone AS reg_phone, reg.email AS reg_email
    FROM reconciliation_feedback_results res
    JOIN feedback fb ON fb.record_id = res.feedback_record_id
    LEFT JOIN registrations reg ON reg.record_id = res.registration_record_id
    WHERE res.run_id = ${runId} AND fb.event_id = ${eventId}
    ORDER BY fb.created_at, fb.record_id
  `

  return rows.map((row) => ({
    recordId: String(row['record_id']),
    publicCode: String(row['public_code']),
    participantId: toStringOrNull(row['participant_id']),
    captureMethod: String(row['capture_method']),
    formVersion: String(row['form_version']),
    createdAt: toIso(row['created_at']),
    revision: Number(row['revision']),
    status: String(row['status']),
    matchMethod: toStringOrNull(row['match_method']),
    registrationRecordId: toStringOrNull(row['reg_id']),
    registrationPublicCode: toStringOrNull(row['reg_code']),
    registrationName: toStringOrNull(row['reg_name']),
    registrationPhone: toStringOrNull(row['reg_phone']),
    registrationEmail: toStringOrNull(row['reg_email']),
    overallRating: toStringOrNull(row['overall_rating']),
    experience: toStringOrNull(row['experience']),
    recommend: toStringOrNull(row['recommend']),
    comments: toStringOrNull(row['comments']),
  }))
}

export async function exportDuplicateCandidateRows(
  sql: Sql,
  eventId: string,
  runId: string,
): Promise<DuplicateCandidateRow[]> {
  return queryDuplicateCandidates(sql, eventId, runId, Number.MAX_SAFE_INTEGER)
}

function toStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}
