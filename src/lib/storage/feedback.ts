import type {
  CapturedParticipantIdentity,
  FeedbackAnswers,
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
 * There is no feedback UI and no questionnaire in this phase. What matters here
 * is that the store can represent both identity origins without Point B ever
 * consulting Point A (invariants B, C, D):
 *
 *   QR scan       -> publicCode + participantId
 *   manual entry  -> publicCode only
 *
 * The manual case omits `participantId` rather than storing null, which keeps
 * those records out of the sparse IndexedDB index and makes "we do not know it"
 * distinct in the type system from "it is empty". Attributing a manual record
 * to a participant ID is the central server's job after synchronisation.
 */

export interface NewFeedbackInput extends RecordContext {
  readonly identity: CapturedParticipantIdentity
  readonly answers: FeedbackAnswers
}

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
  const record: FeedbackRecord = {
    ...newRecordMetadata(input),
    kind: 'feedback',
    captureMethod: input.identity.captureMethod,
    publicCode: input.identity.publicCode,
    ...(input.identity.captureMethod === 'qr-scan'
      ? { participantId: input.identity.participantId }
      : {}),
    answers: input.answers,
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

export async function listFeedbackBySyncStatus(
  database: OfflineEventDb,
  status: SyncStatus,
): Promise<FeedbackRecord[]> {
  return database.feedback.where('syncStatus').equals(status).toArray()
}
