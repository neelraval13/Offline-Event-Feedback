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
 * The store represents all three identity origins without Point B ever
 * consulting Point A (invariants B, C, D):
 *
 *   QR scan          -> publicCode + participantId
 *   manual entry     -> publicCode only
 *   contact details  -> respondentName + respondentPhone + respondentEmail
 *
 * Each case omits the fields it does not have rather than storing null or an
 * empty string, which keeps those records out of the sparse IndexedDB indexes
 * and makes "we do not have it" distinct in the type system from "it is empty".
 *
 * The contact case is the only place Point B holds a name, a phone number or an
 * email address, and it holds them because they are the record's identity, not
 * because it looked anybody up. Deciding whether they belong to a registration
 * is the central server's job after synchronisation, exactly as attributing a
 * manual code has always been.
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

  const metadata = { ...newRecordMetadata(input), kind: 'feedback' as const }

  /*
   * The identity is narrowed the same way and for the same reason. Each branch
   * spreads exactly the fields its capture method has, so a contact record
   * genuinely has no `publicCode` key rather than a key holding undefined.
   * Dexie stores what it is given: a present-but-undefined property would sit
   * in the record and read back as a field that exists and is empty.
   */
  const identity = input.identity
  const record: FeedbackRecord =
    identity.captureMethod === 'qr'
      ? {
          ...metadata,
          ...questionnaire,
          captureMethod: 'qr',
          publicCode: identity.publicCode,
          participantId: identity.participantId,
        }
      : identity.captureMethod === 'manual'
        ? {
            ...metadata,
            ...questionnaire,
            captureMethod: 'manual',
            publicCode: identity.publicCode,
          }
        : {
            ...metadata,
            ...questionnaire,
            captureMethod: 'contact',
            respondentName: identity.respondentName,
            respondentPhone: identity.respondentPhone,
            respondentEmail: identity.respondentEmail,
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
 * that actually happens, the same operator scanning the same sticker twice,
 * and makes no claim about the event as a whole. Reconciling duplicates across
 * devices is the central server's job after synchronisation.
 *
 * There is deliberately no equivalent for a contact capture. A contact response
 * has no code to be the same as, and refusing one because another response on
 * this device carries a similar name, phone or email would be this device
 * deciding two humans are one, offline, with no way to check. Families share
 * phone numbers and couples share email accounts. Where the sticker path can
 * refuse a duplicate on an identifier that is unique by construction, the
 * contact path preserves the evidence and lets reconciliation say what it
 * thinks, which it does in a run an operator can read.
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
