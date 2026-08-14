import type { FlyingFleaRegistrationFields } from './campaign'
import type { FeedbackQuestionnairePayload } from './feedback'
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
 * transition away from it: no sync engine exists yet.
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
 * conflict resolution mechanism on its own; it is the raw material one needs
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

  /*
   * Transport state. Describes delivery to the central server, never an edit.
   * Mutating these must not touch `revision` or `updatedAt`, see
   * `src/lib/storage/transport.ts`.
   */
  readonly syncStatus: SyncStatus
  readonly lastSyncedAt?: IsoTimestamp
  /** Stable, non-PII reason a record will not sync. */
  readonly syncErrorCode?: string
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
 *
 * The campaign fields are mixed in as optional members rather than nested under
 * a `campaign` key. Two reasons, both about what reads this later: every
 * consumer (the wire contract, the central table, the CSV) wants them flat,
 * and optionality is what lets a device that has held records since Phase 1
 * keep reading its own history after this build lands.
 *
 * Which of them may change after issue is a decision recorded in
 * `docs/flying-flea-campaign.md`: identity is immutable, contact and campaign
 * details are correctable, and a correction is a new revision of the same
 * record rather than a new participant.
 */
export interface RegistrationRecord
  extends OfflineRecordMetadata,
    FlyingFleaRegistrationFields {
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

/*
 * Identity fields are stored flat rather than nested so IndexedDB can index
 * them directly. `participantId` is absent, not null, when staff typed the
 * fallback code, which keeps it out of the sparse IndexedDB index.
 */
/**
 * A feedback submission captured at Point B.
 *
 * `formVersion` and `answers` arrive together as a
 * {@link FeedbackQuestionnairePayload}: the questionnaire a record declares and
 * the answers it carries are one fact, and a type that let them be set
 * independently let them disagree.
 */
export type FeedbackRecord = OfflineRecordMetadata &
  FeedbackQuestionnairePayload & {
    readonly kind: 'feedback'
    readonly captureMethod: IdentityCaptureMethod
    readonly publicCode: PublicParticipantCode
    readonly participantId?: ParticipantId
  }

/** Any record produced in the field and awaiting synchronisation. */
export type OfflineRecord = RegistrationRecord | FeedbackRecord
