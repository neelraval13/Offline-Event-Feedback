import type { FeedbackAnswers, FeedbackFormVersion } from './feedback'
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
 *
 * Every record is born `pending`. Nothing in the field ever waits on a
 * transition away from it — no sync engine exists yet.
 */
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error'

/**
 * Metadata every offline-captured record carries, regardless of kind.
 *
 * `eventId` / `eventDay` / `stationId` / `deviceId` are constant across V1 but
 * are stored per record anyway: that is what makes multi-event, multi-day and
 * multi-station operation an additive change later rather than a migration of
 * participant identity.
 *
 * `revision` starts at 1 and increments on every local mutation. It is not a
 * conflict resolution mechanism on its own — it is the raw material one needs
 * to build one when synchronisation lands.
 */
export interface OfflineRecordMetadata {
  readonly recordId: RecordId
  readonly eventId: EventId
  readonly eventDay: EventDay
  readonly stationId: StationId
  readonly deviceId: DeviceId
  readonly createdAt: IsoTimestamp
  readonly updatedAt: IsoTimestamp
  readonly revision: number
  readonly syncStatus: SyncStatus
}

/**
 * The provenance stamped onto every record a device writes: which event, which
 * day, which post, which physical browser installation.
 */
export type RecordContext = Pick<
  OfflineRecordMetadata,
  'eventId' | 'eventDay' | 'stationId' | 'deviceId'
>

/**
 * A registration captured at Point A. This is the only record kind that holds
 * PII (see the privacy boundary in docs/architecture.md).
 */
export interface RegistrationRecord extends OfflineRecordMetadata {
  readonly kind: 'registration'
  readonly participantId: ParticipantId
  readonly publicCode: PublicParticipantCode
  readonly name: string
  readonly phone: string
  readonly email: string
}

/** How Point B obtained the participant's identity from the sticker. */
export type IdentityCaptureMethod = 'qr' | 'manual'

/**
 * Identity as read at Point B. Every field originates from the sticker
 * physically present on the participant, never from a lookup against Point A
 * (invariant 2 / invariants A–D).
 *
 * A QR scan yields both identifiers; a manually typed fallback code yields
 * only the public code, and `participantId` is then absent. Re-joining the two
 * is a central-server concern, performed after synchronisation.
 */
export type CapturedParticipantIdentity =
  | {
      readonly captureMethod: 'qr'
      readonly publicCode: PublicParticipantCode
      readonly participantId: ParticipantId
    }
  | {
      readonly captureMethod: 'manual'
      readonly publicCode: PublicParticipantCode
    }

/**
 * A feedback submission captured at Point B.
 *
 * Identity fields are stored flat rather than nested so IndexedDB can index
 * them directly. `participantId` is absent — not null — when staff typed the
 * fallback code, which keeps it out of the sparse IndexedDB index.
 */
export interface FeedbackRecord extends OfflineRecordMetadata {
  readonly kind: 'feedback'
  readonly captureMethod: IdentityCaptureMethod
  readonly publicCode: PublicParticipantCode
  readonly participantId?: ParticipantId
  /**
   * Which questionnaire produced `answers`. Persisted so that changing the
   * questions later leaves already-collected responses interpretable rather
   * than ambiguous.
   */
  readonly formVersion: FeedbackFormVersion
  readonly answers: FeedbackAnswers
}

/** Any record produced in the field and awaiting synchronisation. */
export type OfflineRecord = RegistrationRecord | FeedbackRecord
