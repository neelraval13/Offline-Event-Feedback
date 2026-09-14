import type { EventLocation } from '../../config/eventLocations'
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
 *
 * ## The location is stamped on all three, and is not identity
 *
 * Every response records the city it was captured in, whichever way its
 * identity was obtained. It sits beside the identity rather than inside it: it
 * says where the desk was, not who the rider is, and nothing matches on it.
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
  /**
   * Which city this response was captured in.
   *
   * Required here, and typed as the narrow union, which is what makes it
   * impossible to write a new response without one. The type is imported for
   * its shape only and erases at build, so the storage layer gains no runtime
   * dependency on deployment configuration.
   *
   * It is required for all three capture methods, and the contact path is the
   * reason it has to be. A QR or manual response could in principle have its
   * city recovered later from the registration its code points at; a contact
   * response points at nothing, so if it is not recorded here, the city it was
   * given in is gone. Making it required only where it is unrecoverable would
   * mean the field was reliably present exactly where it was least needed.
   */
  readonly location: EventLocation
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

  /*
   * A last check before anything is committed.
   *
   * The type above already requires a location and the Point B screen refuses
   * to start a response without one, so this can only fire if something has
   * cast its way past both. It is cheap, and the failure it prevents is a
   * response that is permanently unattributable to a city: there is no way to
   * work out afterwards which of two venues a blank row was captured at.
   *
   * Deliberately a bare non-empty check rather than the two-city list. This
   * module must stay able to hold an August record read back from a backup, and
   * a store that enforced today's list would be a store that refuses yesterday's
   * data. Membership of the list is enforced where the choice is made.
   */
  if (typeof input.location !== 'string' || input.location.trim().length === 0) {
    throw new Error('A feedback response must record the location it was captured in.')
  }

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
          location: input.location,
          captureMethod: 'qr',
          publicCode: identity.publicCode,
          participantId: identity.participantId,
        }
      : identity.captureMethod === 'manual'
        ? {
            ...metadata,
            ...questionnaire,
            location: input.location,
            captureMethod: 'manual',
            publicCode: identity.publicCode,
          }
        : {
            ...metadata,
            ...questionnaire,
            location: input.location,
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
  eventId: string,
): Promise<FeedbackRecord[]> {
  /*
   * Scoped to one event, and the argument is required.
   *
   * A public code is unique per issuing device and sequence, not across
   * events: the sequence restarts each event, so the same device can issue the
   * same code again for a different one. Answering this question across every
   * event on the browser would therefore mix two different riders' responses
   * under one code.
   *
   * The indexed lookup still does the work; the event is a predicate over the
   * few rows that match. That is deliberately not a new index: `publicCode` is
   * already selective enough that any code matches a handful of rows, and a
   * schema version is a migration every installed tablet has to run.
   */
  return database.feedback
    .where('publicCode')
    .equals(code)
    .filter((record) => record.eventId === eventId)
    .toArray()
}

/**
 * Every response on this device, whatever event it belongs to.
 *
 * The raw table count. Kept because that is genuinely what some callers want,
 * notably a test proving that a refused save wrote nothing at all. A
 * rider-facing counter wants {@link countFeedbackForEvent} instead.
 */
export async function countFeedback(database: OfflineEventDb): Promise<number> {
  return database.feedback.count()
}

/**
 * Responses captured at this event, for the station's own counter.
 *
 * Separate from the raw count above, and named so the difference is visible at
 * the call site. What Point B shows an operator is "how is this event going",
 * and a device re-used from a previous event would otherwise open the shift
 * already reading forty.
 *
 * `eventId` is required. A default would make the wrong reading the easy one.
 */
export async function countFeedbackForEvent(
  database: OfflineEventDb,
  eventId: string,
): Promise<number> {
  return database.feedback.filter((record) => record.eventId === eventId).count()
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
  eventId: string,
): Promise<boolean> {
  /*
   * Scoped to the event, and this is the scoping that matters most.
   *
   * The question this answers is operational: "has the operator at this desk
   * already recorded this rider today?" Without the event it answers something
   * else, "has this browser ever seen this code", and the two diverge the
   * moment a device holds a second event.
   *
   * They diverge in the worst direction. A public code is station, issuer and
   * sequence, and the sequence restarts per event, so a Point A device that was
   * wiped and re-prepared reissues the same codes from 1. A Point B device that
   * was NOT wiped then meets a September sticker whose code matches an August
   * response it still holds, and refuses a real rider with "Feedback already
   * recorded" for a response nobody has given. The rider is turned away and
   * there is nothing on screen to explain why.
   *
   * Scoping cannot weaken the guard within an event: two responses for one code
   * at this event still collide exactly as before.
   */
  const existing = await database.feedback
    .where('publicCode')
    .equals(code)
    .filter((record) => record.eventId === eventId)
    .count()

  return existing > 0
}

export async function listFeedbackBySyncStatus(
  database: OfflineEventDb,
  status: SyncStatus,
): Promise<FeedbackRecord[]> {
  return database.feedback.where('syncStatus').equals(status).toArray()
}
