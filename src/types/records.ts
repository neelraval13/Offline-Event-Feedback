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

/**
 * Where a Point B response's identity came from.
 *
 * Three origins, and the third is not a fallback for the first two. `qr` and
 * `manual` both read a sticker that Point A issued; `contact` is a rider who
 * never went through Point A, or whose sticker is gone, giving their own
 * details instead. Their response is not a degraded version of a scanned one:
 * it is a complete response whose identity has a different source.
 */
export type IdentityCaptureMethod = 'qr' | 'manual' | 'contact'

/**
 * Contact details a rider gave at Point B, as their own identity.
 *
 * This is the one place Point B holds PII, and it is deliberate: these fields
 * ARE the identity of the record. Everything else about the privacy boundary is
 * unchanged, in particular that Point B still never reads Point A. Whether
 * these details happen to match a registration is a central question answered
 * after synchronisation, by reconciliation, and never at the desk.
 */
export interface RespondentContact {
  readonly respondentName: string
  readonly respondentPhone: string
  readonly respondentEmail: string
}

/**
 * Identity as captured at Point B.
 *
 * Every field originates from something physically in front of the operator:
 * the sticker on the participant, or the details the rider gave. Never from a
 * lookup against Point A (invariant 2 / invariants A-D).
 *
 * A discriminated union rather than a bag of optionals, because the three
 * shapes have no overlap and the combinations between them are all nonsense. A
 * `contact` capture with a `publicCode` would be claiming a sticker nobody
 * scanned; a `qr` capture without a `participantId` would be claiming a scan
 * that produced half a payload. Neither compiles.
 *
 * Note what a `contact` identity does NOT have: no participant ID and no public
 * code, absent rather than empty. An empty string is a value someone supplied;
 * this is the absence of one, and an empty-string public code would join
 * against every other empty-string public code the moment somebody wrote a
 * careless query.
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
  | ({ readonly captureMethod: 'contact' } & RespondentContact)

/*
 * Identity fields are stored flat rather than nested so IndexedDB can index
 * them directly. Fields a capture method does not have are absent, not null,
 * which keeps those records out of the sparse IndexedDB indexes.
 */
/**
 * A feedback submission captured at Point B.
 *
 * `formVersion` and `answers` arrive together as a
 * {@link FeedbackQuestionnairePayload}: the questionnaire a record declares and
 * the answers it carries are one fact, and a type that let them be set
 * independently let them disagree.
 *
 * The identity arrives the same way, as {@link CapturedParticipantIdentity}.
 * Intersecting a union distributes, so this is three record shapes, and a
 * reader that wants `publicCode` has to narrow on `captureMethod` first. That
 * is the intended friction: a reader that would have silently read `undefined`
 * as a code now fails to compile instead.
 */
export type FeedbackRecord = OfflineRecordMetadata &
  FeedbackQuestionnairePayload &
  CapturedParticipantIdentity & {
    readonly kind: 'feedback'
  }

/** The public code a response carries, or null for a contact capture. */
export function feedbackPublicCode(
  record: Pick<FeedbackRecord, 'captureMethod'> & {
    readonly publicCode?: PublicParticipantCode
  },
): PublicParticipantCode | null {
  return record.captureMethod === 'contact' ? null : (record.publicCode ?? null)
}

/** Any record produced in the field and awaiting synchronisation. */
export type OfflineRecord = RegistrationRecord | FeedbackRecord
