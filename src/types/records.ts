import type {
  DeviceId,
  EventDay,
  EventId,
  IsoTimestamp,
  ParticipantId,
  PublicParticipantCode,
  RecordId,
  StationId,
} from './ids'

/**
 * Lifecycle of a locally-captured record with respect to the central server.
 * Every record is born `pending`; nothing in the field ever waits on a
 * transition away from it.
 */
export type SyncStatus = 'pending' | 'synced' | 'failed'

/**
 * Metadata every offline-captured record carries, regardless of kind.
 *
 * `eventId` / `eventDay` / `stationId` / `deviceId` are constant across V1 but
 * are stored per record anyway: that is what makes multi-event, multi-day and
 * multi-station operation an additive change later rather than a migration of
 * participant identity.
 */
export interface OfflineRecordMetadata {
  readonly recordId: RecordId
  readonly eventId: EventId
  readonly eventDay: EventDay
  readonly stationId: StationId
  readonly deviceId: DeviceId
  readonly createdAt: IsoTimestamp
  readonly syncStatus: SyncStatus
}

/** Personally identifying details collected at Point A, and only at Point A. */
export interface ParticipantContactDetails {
  readonly fullName: string
  readonly phone: string
  readonly email: string
}

/**
 * A registration captured at Point A. This is the only record kind that holds
 * PII (see the privacy boundary in docs/architecture.md).
 */
export interface RegistrationRecord extends OfflineRecordMetadata {
  readonly kind: 'registration'
  readonly participantId: ParticipantId
  readonly publicCode: PublicParticipantCode
  readonly contact: ParticipantContactDetails
}

/** How Point B obtained the participant's identity from the sticker. */
export type IdentityCaptureMethod = 'qr-scan' | 'manual-code'

/**
 * Identity as read at Point B. Every field here originates from the sticker
 * physically present on the participant, never from a lookup against Point A
 * (invariant 2).
 */
export interface CapturedParticipantIdentity {
  readonly captureMethod: IdentityCaptureMethod
  readonly publicCode: PublicParticipantCode
  /** Present when the QR decoded; absent when staff typed the fallback code. */
  readonly participantId?: ParticipantId
}

/**
 * A feedback submission captured at Point B.
 *
 * The questionnaire payload is deliberately absent in Phase 0: the questions
 * are not defined yet, and guessing their shape now would be the wrong kind of
 * commitment. It attaches to this record when the questionnaire is designed.
 */
export interface FeedbackRecord extends OfflineRecordMetadata {
  readonly kind: 'feedback'
  readonly participant: CapturedParticipantIdentity
}

/** Any record produced in the field and awaiting synchronisation. */
export type OfflineRecord = RegistrationRecord | FeedbackRecord
