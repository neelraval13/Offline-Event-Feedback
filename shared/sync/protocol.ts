import { z } from 'zod'
import {
  FLYING_FLEA_COLOURS,
  FLYING_FLEA_FORM_VERSION,
  FLYING_FLEA_GENDERS,
  MAX_CAMPAIGN_TEXT_LENGTH,
  MAX_LICENCE_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_VEHICLE_LENGTH,
  RATINGS_1_TO_7,
} from '../campaign/flyingFlea'

/*
 * The synchronisation wire contract, version 1.
 *
 * Shared by the client and the server so there is exactly one definition of
 * what may cross the network. Two independently written validators drift, and
 * the drift shows up as records that upload from one build and are rejected by
 * another — at an event, with no way to diagnose it.
 *
 * The server treats every request as untrusted regardless: TypeScript types do
 * not survive an HTTP boundary, so these schemas are parsed at runtime on the
 * way in.
 */

export const SYNC_PROTOCOL_VERSION = 1

/** Records per batch. A conflict in one must not strand the other 99. */
export const MAX_BATCH_RECORDS = 100

/** Canonical UUID, any version. */
const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'must be a UUID',
  )

/** `A1-B8EFD9-00001-X` — station, device issuer, sequence, check character. */
const publicCode = z
  .string()
  .regex(/^[0-9A-Z]{1,8}-[0-9A-F]{6}-\d{1,12}-[0-9A-Z]$/, 'must be a public code')

const isoTimestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    'must be an ISO timestamp',
  )
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a real instant')

const eventDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a calendar day')

const identifier = z.string().min(1).max(128)
const revision = z.number().int().min(1)

/*
 * Registration.
 *
 * PII travels here deliberately — consolidating it centrally is the entire
 * point of synchronisation — and therefore only ever over HTTPS in production.
 */
export const registrationWireSchema = z.object({
  kind: z.literal('registration'),
  recordId: uuid,
  participantId: uuid,
  publicCode,

  eventId: identifier,
  eventDay,
  stationId: identifier,
  /** The device that *captured* this record, not the one uploading it. */
  deviceId: uuid,

  name: z.string().min(1).max(200),
  phone: z.string().min(1).max(64),
  email: z.string().min(1).max(320),

  /*
   * Campaign fields, all optional.
   *
   * Additive on purpose, and additive is what keeps this protocol version at 1:
   * a device still running a pre-campaign build uploads a registration without
   * them and is accepted exactly as before, and a device running this build
   * uploads them to a server that has been deployed since. Making them required
   * would strand every record captured before the campaign, including the ones
   * sitting unsynced on a tablet during the deployment.
   *
   * The lengths are storage bounds, not campaign rules. Validation of what a
   * campaign considers a well-formed licence number belongs at the desk, where
   * someone can look at the document.
   */
  vehicle: z.string().min(1).max(MAX_VEHICLE_LENGTH).optional(),
  /*
   * Closed sets, from the shared campaign definition. A colour is a stored
   * answer to a question, so an unrecognised one is not a long string — it is a
   * value no rider could have chosen.
   */
  interestedColour: z.enum(FLYING_FLEA_COLOURS).optional(),
  location: z.string().min(1).max(MAX_LOCATION_LENGTH).optional(),
  gender: z.enum(FLYING_FLEA_GENDERS).optional(),
  /** Local wall-clock `YYYY-MM-DDTHH:mm`, never shifted to UTC. */
  testRideAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'must be a local date and time')
    .optional(),
  drivingLicence: z.string().min(1).max(MAX_LICENCE_LENGTH).optional(),
  pincode: z.string().regex(/^\d{6}$/, 'must be a 6-digit pincode').optional(),

  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  revision,
})

export const feedbackAnswersSchema = z.object({
  overall_rating: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  experience: z.enum(['very_poor', 'poor', 'okay', 'good', 'excellent']),
  recommend: z.boolean(),
  comments: z.string().max(2000).optional(),
})

/** 1-7 inclusive, integers only. A 2.5 is not an answer to these questions. */
const rating1to7 = z.union(
  RATINGS_1_TO_7.map((value) => z.literal(value)) as unknown as [
    z.ZodLiteral<1>,
    z.ZodLiteral<2>,
    ...z.ZodLiteral<number>[],
  ],
)

/**
 * `flying-flea-feedback-v1`.
 *
 * Deliberately a separate schema rather than an extension of the one above.
 * The two questionnaires share no question, and a server that validated them
 * with one schema would accept a campaign response missing every campaign
 * answer.
 */
export const flyingFleaFeedbackAnswersSchema = z.object({
  testRideExperience: rating1to7,
  rotaryKnobUsage: rating1to7,
  rideModesExperience: rating1to7,
  overallExperienceRating: rating1to7,
  topThreeFeatures: z.string().max(MAX_CAMPAIGN_TEXT_LENGTH).optional(),
  overallExperienceComments: z.string().max(MAX_CAMPAIGN_TEXT_LENGTH).optional(),
})

/*
 * Feedback.
 *
 * `participantId` is optional on purpose: a manually typed public code cannot
 * yield one, and inventing it would be fabricating data. Reconciliation is a
 * later phase and a central concern.
 */
const feedbackWireObject = z.object({
    kind: z.literal('feedback'),
    recordId: uuid,
    participantId: uuid.optional(),
    publicCode,
    captureMethod: z.enum(['qr', 'manual']),

    eventId: identifier,
    eventDay,
    stationId: identifier,
    deviceId: uuid,

    /*
     * The pair is validated together below: a record may not declare one
     * questionnaire and carry another's answers.
     */
    formVersion: z.enum(['feedback-v1', FLYING_FLEA_FORM_VERSION]),
    answers: z.union([feedbackAnswersSchema, flyingFleaFeedbackAnswersSchema]),

    createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  revision,
})

/**
 * The Phase 3 identity rule, enforced on the wire.
 *
 * A QR scan yields a participant ID; a manually typed public code cannot, and
 * claiming one would be fabricating data the device never had.
 */
function checkCaptureIdentity(
  record: { captureMethod: string; participantId?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  const consistent =
    record.captureMethod === 'qr'
      ? record.participantId !== undefined
      : record.participantId === undefined

  if (!consistent) {
    ctx.addIssue({
      code: 'custom',
      message:
        'a qr capture must carry a participantId and a manual capture must not',
      path: ['participantId'],
    })
  }
}

/**
 * The questionnaire a record declares must be the questionnaire it answers.
 *
 * Without this, `answers` being a union means a `flying-flea-feedback-v1`
 * record carrying `feedback-v1` answers parses cleanly and lands in the
 * database as a campaign response with no campaign answers in it — invisible
 * until an analyst notices the averages are computed from fewer records than
 * the count says.
 */
function checkFormVersionMatchesAnswers(
  record: { formVersion: string; answers: unknown },
  ctx: z.RefinementCtx,
): void {
  const schema =
    record.formVersion === FLYING_FLEA_FORM_VERSION
      ? flyingFleaFeedbackAnswersSchema
      : feedbackAnswersSchema

  if (!schema.safeParse(record.answers).success) {
    ctx.addIssue({
      code: 'custom',
      message: `answers do not match formVersion ${record.formVersion}`,
      path: ['answers'],
    })
  }
}

export const feedbackWireSchema = feedbackWireObject
  .superRefine(checkCaptureIdentity)
  .superRefine(checkFormVersionMatchesAnswers)

export const syncRecordSchema = z
  .discriminatedUnion('kind', [registrationWireSchema, feedbackWireObject])
  .superRefine((record, ctx) => {
    if (record.kind === 'feedback') {
      checkCaptureIdentity(record, ctx)
      checkFormVersionMatchesAnswers(record, ctx)
    }
  })

export const syncBatchSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  /** Diagnostics only. `recordId` is the idempotency key, never this. */
  batchId: uuid,
  eventId: identifier,
  /** The enrolled device performing the upload. */
  uploaderDeviceId: uuid,
  records: z.array(syncRecordSchema).min(1).max(MAX_BATCH_RECORDS),
})

export const enrollmentRequestSchema = z.object({
  eventId: identifier,
  deviceId: uuid,
  enrollmentSecret: z.string().min(1).max(512),
})

export type RegistrationWireRecord = z.infer<typeof registrationWireSchema>
export type FeedbackWireRecord = z.infer<typeof feedbackWireObject>
export type SyncRecord = RegistrationWireRecord | FeedbackWireRecord
export type SyncBatch = z.infer<typeof syncBatchSchema>
export type EnrollmentRequest = z.infer<typeof enrollmentRequestSchema>

/**
 * Per-record outcomes.
 *
 * Deliberately carries no participant data back. The ingest API is
 * write-oriented; nothing about a person needs to return to a device that
 * already has it.
 */
export type SyncRecordStatus =
  /** Written, or updated to a higher revision. */
  | 'accepted'
  /** The server already holds this exact revision. Safe to mark synced. */
  | 'already_current'
  /** The server holds a newer revision. The client must not overwrite it. */
  | 'server_newer'
  /** Irreconcilable without a human. */
  | 'conflict'
  /** Failed validation. */
  | 'invalid'

export interface SyncRecordResult {
  readonly recordId: string
  readonly status: SyncRecordStatus
  /** Present whenever the server holds a row for this record. */
  readonly serverRevision?: number
  /** Stable, non-PII reason code for `conflict` and `invalid`. */
  readonly code?: string
}

export interface SyncBatchResponse {
  readonly protocolVersion: typeof SYNC_PROTOCOL_VERSION
  readonly batchId: string
  readonly results: readonly SyncRecordResult[]
}

export interface EnrollmentResponse {
  readonly eventId: string
  readonly deviceId: string
  /** Returned exactly once. The server keeps only a hash. */
  readonly deviceToken: string
}

/** Stable reason codes. Safe to display and to aggregate. */
export const SYNC_CODES = {
  immutableMismatch: 'IMMUTABLE_FIELD_MISMATCH',
  revisionConflict: 'REVISION_CONFLICT',
  participantClaimed: 'PARTICIPANT_ALREADY_CLAIMED',
  publicCodeClaimed: 'PUBLIC_CODE_ALREADY_CLAIMED',
  wrongEvent: 'WRONG_EVENT',
  invalidRecord: 'INVALID_RECORD',
} as const
