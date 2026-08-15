import type {
  FeedbackWireRecord,
  RegistrationWireRecord,
} from '../../shared/sync/protocol.js'

/*
 * What ingest needs from storage.
 *
 * The interface exists so the merge semantics can be exercised exhaustively
 * without a database, and so the SQL implementation has one narrow surface to
 * get right. It does not exist to abstract Postgres away: the real
 * implementation leans on Postgres constraints deliberately, because that is
 * what makes concurrent ingest safe.
 */

export interface CentralRegistration extends RegistrationWireRecord {
  readonly firstReceivedAt: string
  readonly lastReceivedAt: string
  readonly lastUploaderDeviceId: string
}

export interface CentralFeedback extends FeedbackWireRecord {
  readonly firstReceivedAt: string
  readonly lastReceivedAt: string
  readonly lastUploaderDeviceId: string
}

export interface EnrolledDevice {
  readonly eventId: string
  readonly uploaderDeviceId: string
  readonly tokenHash: string
  readonly revokedAt: string | null
}

/**
 * Outcome of an attempted insert.
 *
 * `claimed` means a *different* record already owns the participant ID or the
 * public code: a genuine conflict rather than a retry.
 */
export type InsertOutcome =
  | { readonly outcome: 'inserted' }
  | { readonly outcome: 'exists' }
  | {
      readonly outcome: 'claimed'
      readonly by: 'participant_id' | 'public_code'
    }

export interface SyncStore {
  /* --- devices --- */
  findDevice(
    eventId: string,
    uploaderDeviceId: string,
  ): Promise<EnrolledDevice | null>
  /** Upserts an enrolment, replacing any previous token for the device. */
  enrollDevice(device: {
    eventId: string
    uploaderDeviceId: string
    tokenHash: string
  }): Promise<void>
  touchDevice(eventId: string, uploaderDeviceId: string): Promise<void>

  /* --- registrations --- */
  getRegistration(recordId: string): Promise<CentralRegistration | null>
  /**
   * Inserts only if absent.
   *
   * Must be a single atomic statement, not a read followed by a write: two
   * devices may upload the same record at the same instant.
   */
  insertRegistration(
    record: RegistrationWireRecord,
    receivedAt: string,
    uploaderDeviceId: string,
  ): Promise<InsertOutcome>
  /** Updates only when the stored revision is still the one that was read. */
  updateRegistration(
    record: RegistrationWireRecord,
    expectedRevision: number,
    receivedAt: string,
    uploaderDeviceId: string,
  ): Promise<boolean>
  touchRegistration(
    recordId: string,
    receivedAt: string,
    uploaderDeviceId: string,
  ): Promise<void>

  /* --- feedback --- */
  getFeedback(recordId: string): Promise<CentralFeedback | null>
  insertFeedback(
    record: FeedbackWireRecord,
    receivedAt: string,
    uploaderDeviceId: string,
  ): Promise<InsertOutcome>
  updateFeedback(
    record: FeedbackWireRecord,
    expectedRevision: number,
    receivedAt: string,
    uploaderDeviceId: string,
  ): Promise<boolean>
  touchFeedback(
    recordId: string,
    receivedAt: string,
    uploaderDeviceId: string,
  ): Promise<void>

  /* --- audit --- */
  recordBatch(audit: {
    batchId: string
    eventId: string
    uploaderDeviceId: string
    receivedAt: string
    accepted: number
    alreadyCurrent: number
    serverNewer: number
    conflict: number
    invalid: number
  }): Promise<void>
}
