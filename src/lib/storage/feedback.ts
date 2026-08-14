import type {
  CapturedParticipantIdentity,
  FeedbackQuestionnairePayload,
  FeedbackRecord,
  PublicParticipantCode,
  RecordContext,
  RecordId,
  SyncStatus,
} from '../../types'
import type { OfflineEventDb } from './db'
import { newRecordMetadata } from './metadata'

/*
 * Feedback persistence.
 *
 * The store represents both identity origins without Point B ever consulting
 * Point A (invariants B, C, D):
 *
 *   QR scan       -> publicCode + participantId
 *   manual entry  -> publicCode only
 *
 * The manual case omits `participantId` rather than storing null, which keeps
 * those records out of the sparse IndexedDB index and makes "we do not know it"
 * distinct in the type system from "it is empty". Attributing a manual record
 * to a participant ID is the central server's job after synchronisation.
 */

/**
 * What Point B hands to the store.
 *
 * The questionnaire arrives as one value rather than as a version beside some
 * answers, so a caller cannot pair a `feedback-v1` label with campaign answers.
 * The identity union does the same job for the QR/manual distinction.
 */
export type NewFeedbackInput = RecordContext & {
  readonly identity: CapturedParticipantIdentity
} & FeedbackQuestionnairePayload

/**
 * Persists a feedback submission.
 *
 * No lookup, no validation against a participant list, no network: everything
 * stored comes from the sticker in front of the operator.
 */
export async function createFeedback(
  database: OfflineEventDb,
  input: NewFeedbackInput,
): Promise<FeedbackRecord> {
  const identity =
    input.identity.captureMethod === 'qr'
      ? { participantId: input.identity.participantId }
      : {}

  /*
   * The questionnaire is narrowed before the record is built, so each branch
   * writes a pair the type system has already checked. Spreading
   * `formVersion`/`answers` together from an unnarrowed input would defeat the
   * discriminated union it arrived as.
   */
  const questionnaire: FeedbackQuestionnairePayload =
    input.formVersion === 'feedback-v1'
      ? { formVersion: input.formVersion, answers: input.answers }
      : { formVersion: input.formVersion, answers: input.answers }

  const record: FeedbackRecord = {
    ...newRecordMetadata(input),
    kind: 'feedback',
    captureMethod: input.identity.captureMethod,
    publicCode: input.identity.publicCode,
    ...identity,
    ...questionnaire,
  }

  await database.feedback.add(record)
  return record
}

export async function getFeedbackByRecordId(
  database: OfflineEventDb,
  id: RecordId,
): Promise<FeedbackRecord | undefined> {
  return database.feedback.get(id)
}

/**
 * All feedback recorded against a public code.
 *
 * Returns a list, not a single record: nothing offline can rule out a
 * participant being recorded twice, and silently hiding the second one would
 * destroy evidence the server needs to reconcile.
 */
export async function listFeedbackByPublicCode(
  database: OfflineEventDb,
  code: PublicParticipantCode,
): Promise<FeedbackRecord[]> {
  return database.feedback.where('publicCode').equals(code).toArray()
}

export async function countFeedback(database: OfflineEventDb): Promise<number> {
  return database.feedback.count()
}

/**
 * Whether this device has already recorded feedback for a public code.
 *
 * Scoped to this device on purpose. Point B terminals are independent offline
 * clients with no way to see each other's records, so this catches the mistake
 * that actually happens — the same operator scanning the same sticker twice —
 * and makes no claim about the event as a whole. Reconciling duplicates across
 * devices is the central server's job after synchronisation.
 */
export async function hasFeedbackForPublicCode(
  database: OfflineEventDb,
  code: PublicParticipantCode,
): Promise<boolean> {
  const existing = await database.feedback
    .where('publicCode')
    .equals(code)
    .count()

  return existing > 0
}

export async function listFeedbackBySyncStatus(
  database: OfflineEventDb,
  status: SyncStatus,
): Promise<FeedbackRecord[]> {
  return database.feedback.where('syncStatus').equals(status).toArray()
}
