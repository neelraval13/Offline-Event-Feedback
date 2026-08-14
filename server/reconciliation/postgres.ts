import { randomUUID } from 'node:crypto'
import type { Sql, TransactionSql } from 'postgres'
import { reconcile } from './engine'
import {
  RECONCILIATION_ENGINE_VERSION,
  type DuplicateRegistrationCandidate,
  type FeedbackResult,
  type ReconciliationCounts,
  type ReconciliationFeedback,
  type ReconciliationOutput,
  type ReconciliationRegistration,
  type RegistrationResult,
} from './types'

/*
 * Persistence for reconciliation runs.
 *
 * The read and the write happen inside **one REPEATABLE READ transaction**, so
 * the registrations and the feedback a run classifies come from the same
 * snapshot of the database. Querying them separately would let a sync land
 * between the two reads and produce a run describing a state that never
 * existed: feedback counted against a registration the run never saw.
 *
 * Nothing here writes to `registrations`, `feedback`, `sync_devices` or
 * `sync_batches`. Reconciliation only ever reads them.
 */

type Row = Record<string, unknown>

export interface PersistedRun {
  readonly runId: string
  readonly eventId: string
  readonly engineVersion: string
  readonly startedAt: string
  readonly completedAt: string | null
  readonly counts: ReconciliationCounts
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

function mapRun(row: Row): PersistedRun {
  return {
    runId: String(row['run_id']),
    eventId: String(row['event_id']),
    engineVersion: String(row['engine_version']),
    startedAt: toIso(row['started_at']),
    completedAt:
      row['completed_at'] === null || row['completed_at'] === undefined
        ? null
        : toIso(row['completed_at']),
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

export interface ReconciliationRunResult {
  readonly runId: string
  readonly output: ReconciliationOutput
}

/**
 * Runs reconciliation for one event and persists the results.
 *
 * The whole thing, snapshot read, classification, result inserts and the
 * completion stamp, is one transaction. A failure anywhere rolls back the run
 * row along with everything else, so a partially written run can never be
 * mistaken for a finished one.
 */
export async function runReconciliation(
  sql: Sql,
  eventId: string,
): Promise<ReconciliationRunResult> {
  const runId = randomUUID()

  const output = await sql.begin(
    'isolation level repeatable read',
    async (tx): Promise<ReconciliationOutput> => {
      /*
       * Both reads see the same snapshot. Under REPEATABLE READ, a sync
       * committing between them is invisible to this transaction.
       */
      const registrationRows = await tx<Row[]>`
        SELECT record_id, participant_id, public_code, phone, email
        FROM registrations
        WHERE event_id = ${eventId}
      `
      const feedbackRows = await tx<Row[]>`
        SELECT record_id, capture_method, participant_id, public_code
        FROM feedback
        WHERE event_id = ${eventId}
      `

      const registrations: ReconciliationRegistration[] = registrationRows.map(
        (row) => ({
          recordId: String(row['record_id']),
          participantId: String(row['participant_id']),
          publicCode: String(row['public_code']),
          // Used only to group duplicate candidates in memory. Never persisted.
          phone: String(row['phone']),
          email: String(row['email']),
        }),
      )

      const feedback: ReconciliationFeedback[] = feedbackRows.map((row) => ({
        recordId: String(row['record_id']),
        captureMethod: String(row['capture_method']) === 'qr' ? 'qr' : 'manual',
        participantId:
          row['participant_id'] === null || row['participant_id'] === undefined
            ? null
            : String(row['participant_id']),
        publicCode: String(row['public_code']),
      }))

      const classified = reconcile({ eventId, registrations, feedback })

      // Opened without completed_at; stamped only once every result is written.
      await tx`
        INSERT INTO reconciliation_runs (run_id, event_id, engine_version)
        VALUES (${runId}, ${eventId}, ${RECONCILIATION_ENGINE_VERSION})
      `

      await insertRegistrationResults(tx, runId, classified.registrationResults)
      await insertFeedbackResults(tx, runId, classified.feedbackResults)
      await insertDuplicateCandidates(tx, runId, classified.duplicateCandidates)

      const counts = classified.counts
      await tx`
        UPDATE reconciliation_runs SET
          completed_at = now(),
          registration_count = ${counts.registrationCount},
          feedback_count = ${counts.feedbackCount},
          matched_registrations = ${counts.matchedRegistrations},
          registrations_without_feedback = ${counts.registrationsWithoutFeedback},
          registrations_with_multiple_feedback = ${counts.registrationsWithMultipleFeedback},
          matched_feedback = ${counts.matchedFeedback},
          feedback_without_registration = ${counts.feedbackWithoutRegistration},
          feedback_identity_conflicts = ${counts.feedbackIdentityConflicts},
          feedback_in_multiple_groups = ${counts.feedbackInMultipleGroups},
          duplicate_registration_candidate_count = ${counts.duplicateRegistrationCandidateCount}
        WHERE run_id = ${runId}
      `

      return classified
    },
  )

  return { runId, output }
}

/** Inserted in chunks: one statement per 19,000 records would be unreasonable. */
const INSERT_CHUNK = 500

async function insertRegistrationResults(
  tx: TransactionSql,
  runId: string,
  results: readonly RegistrationResult[],
): Promise<void> {
  for (let index = 0; index < results.length; index += INSERT_CHUNK) {
    const chunk = results.slice(index, index + INSERT_CHUNK).map((result) => ({
      run_id: runId,
      registration_record_id: result.registrationRecordId,
      status: result.status,
      valid_feedback_count: result.validFeedbackCount,
    }))

    await tx`INSERT INTO reconciliation_registration_results ${tx(chunk)}`
  }
}

async function insertFeedbackResults(
  tx: TransactionSql,
  runId: string,
  results: readonly FeedbackResult[],
): Promise<void> {
  for (let index = 0; index < results.length; index += INSERT_CHUNK) {
    const chunk = results.slice(index, index + INSERT_CHUNK).map((result) => ({
      run_id: runId,
      feedback_record_id: result.feedbackRecordId,
      registration_record_id: result.registrationRecordId,
      status: result.status,
      match_method: result.matchMethod,
    }))

    await tx`INSERT INTO reconciliation_feedback_results ${tx(chunk)}`
  }
}

async function insertDuplicateCandidates(
  tx: TransactionSql,
  runId: string,
  candidates: readonly DuplicateRegistrationCandidate[],
): Promise<void> {
  for (let index = 0; index < candidates.length; index += INSERT_CHUNK) {
    const chunk = candidates
      .slice(index, index + INSERT_CHUNK)
      .map((candidate) => ({
        run_id: runId,
        left_registration_record_id: candidate.leftRegistrationRecordId,
        right_registration_record_id: candidate.rightRegistrationRecordId,
        match_basis: candidate.matchBasis,
      }))

    await tx`INSERT INTO reconciliation_duplicate_registration_candidates ${tx(chunk)}`
  }
}

/* ------------------------------------------------------------------ *
 * Reading runs back: Phase 8's data source
 * ------------------------------------------------------------------ */

/** The most recent **completed** run for an event, or null if there is none. */
export async function getLatestCompletedRun(
  sql: Sql,
  eventId: string,
): Promise<PersistedRun | null> {
  const rows = await sql<Row[]>`
    SELECT * FROM reconciliation_latest_runs WHERE event_id = ${eventId}
  `
  const row = rows[0]
  return row === undefined ? null : mapRun(row)
}

export async function getRun(
  sql: Sql,
  runId: string,
): Promise<PersistedRun | null> {
  const rows = await sql<Row[]>`
    SELECT * FROM reconciliation_runs WHERE run_id = ${runId}
  `
  const row = rows[0]
  return row === undefined ? null : mapRun(row)
}

export async function listRuns(
  sql: Sql,
  eventId: string,
): Promise<PersistedRun[]> {
  const rows = await sql<Row[]>`
    SELECT * FROM reconciliation_runs
    WHERE event_id = ${eventId}
    ORDER BY started_at DESC
  `
  return rows.map(mapRun)
}

export async function getRegistrationResults(
  sql: Sql,
  runId: string,
): Promise<RegistrationResult[]> {
  const rows = await sql<Row[]>`
    SELECT registration_record_id, status, valid_feedback_count
    FROM reconciliation_registration_results
    WHERE run_id = ${runId}
    ORDER BY registration_record_id
  `

  return rows.map((row) => ({
    registrationRecordId: String(row['registration_record_id']),
    status: String(row['status']) as RegistrationResult['status'],
    validFeedbackCount: Number(row['valid_feedback_count']),
  }))
}

export async function getFeedbackResults(
  sql: Sql,
  runId: string,
): Promise<FeedbackResult[]> {
  const rows = await sql<Row[]>`
    SELECT feedback_record_id, registration_record_id, status, match_method
    FROM reconciliation_feedback_results
    WHERE run_id = ${runId}
    ORDER BY feedback_record_id
  `

  return rows.map((row) => ({
    feedbackRecordId: String(row['feedback_record_id']),
    registrationRecordId:
      row['registration_record_id'] === null ||
      row['registration_record_id'] === undefined
        ? null
        : String(row['registration_record_id']),
    status: String(row['status']) as FeedbackResult['status'],
    matchMethod:
      row['match_method'] === null || row['match_method'] === undefined
        ? null
        : (String(row['match_method']) as FeedbackResult['matchMethod']),
  }))
}

export async function getDuplicateCandidates(
  sql: Sql,
  runId: string,
): Promise<DuplicateRegistrationCandidate[]> {
  const rows = await sql<Row[]>`
    SELECT left_registration_record_id, right_registration_record_id, match_basis
    FROM reconciliation_duplicate_registration_candidates
    WHERE run_id = ${runId}
    ORDER BY left_registration_record_id, right_registration_record_id
  `

  return rows.map((row) => ({
    leftRegistrationRecordId: String(row['left_registration_record_id']),
    rightRegistrationRecordId: String(row['right_registration_record_id']),
    matchBasis: String(
      row['match_basis'],
    ) as DuplicateRegistrationCandidate['matchBasis'],
  }))
}
