import { FLYING_FLEA_FORM_VERSION } from './analytics.js'
import type { FeedbackExportRow, RegistrationExportRow } from './postgres.js'

/*
 * The join an organiser would otherwise do by hand.
 *
 * `Registrations` and `Feedback` are audit sheets: one row per record, exactly
 * what the run classified, nothing inferred. That is the right shape for
 * checking the system and the wrong shape for reading the event. Answering "who
 * was this rider and what did they say?" from them means a VLOOKUP on
 * `record_id` across two sheets, and the person who needs the answer is usually
 * the person least likely to write one.
 *
 * This module produces that view, and it is a **view**. It introduces no new
 * classification, chooses no winner, and reads no answer the raw sheets do not
 * already carry. Every status here is the reconciliation run's own, relabelled
 * into English. If this file disagreed with the raw sheets, the raw sheets would
 * be right.
 *
 * ## The four shapes a row can have
 *
 *   Matched              one registration, one response, side by side
 *   No response          the registration, with the answer columns blank
 *   Multiple responses   the registration repeated once per response
 *   No registration      a response whose rider was never registered
 *   Identity conflict    a response the run refused to attach to anyone
 *
 * The last two are why this is not simply "the Registrations sheet with answers
 * glued on". A registration-first join silently drops every response that has no
 * registration, and those are the operationally interesting ones: a mistyped
 * code at Point B is still somebody's opinion of the event.
 */

/** Human wording for the run's own status. */
const REGISTRATION_STATUS_LABELS: Readonly<Record<string, string>> = {
  matched: 'Matched',
  without_feedback: 'No response',
  multiple_feedback: 'Multiple responses',
}

const FEEDBACK_STATUS_LABELS: Readonly<Record<string, string>> = {
  without_registration: 'No registration',
  identity_conflict: 'Identity conflict',
}

/**
 * The sheet's columns, in order.
 *
 * Point A on the left, Point B in the middle, record identity on the right, so
 * the columns a person reads are the ones they see first and the columns a
 * machine reads are out of the way.
 */
export const PARTICIPANT_FEEDBACK_HEADER = [
  'Reconciliation Run',
  'Status',
  'Public Code',

  'Name',
  'Phone',
  'Email',
  'Driving Licence',
  'Gender',
  'Pincode',

  'Vehicle',
  'Interested Colour',
  'Location',
  'Test Ride Date & Time',

  'Feedback Capture Method',
  'Feedback Form Version',

  'Test Ride Experience / 7',
  'Rotary Knob Usage / 7',
  'Ride Modes Experience / 7',
  'Overall Experience / 7',

  'Top 3 Features',
  'Overall Experience Comments',

  'Registration Record ID',
  'Feedback Record ID',
  'Registration Created At',
  'Feedback Created At',
] as const

/** Widths, by eye: identifiers narrow, free text wide enough to read. */
export const PARTICIPANT_FEEDBACK_WIDTHS: readonly number[] = [
  38, 20, 22, 26, 18, 30, 22, 12, 12, 14, 18, 24, 22, 14, 26, 12, 12, 12, 12,
  60, 60, 38, 38, 26, 26,
]

export interface ParticipantFeedbackRow {
  readonly runId: string
  readonly status: string
  readonly publicCode: string
  readonly name: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly drivingLicence: string | null
  readonly gender: string | null
  readonly pincode: string | null
  readonly vehicle: string | null
  readonly interestedColour: string | null
  readonly location: string | null
  readonly testRideAt: string | null
  readonly captureMethod: string | null
  readonly formVersion: string | null
  readonly testRideExperience: string | null
  readonly rotaryKnobUsage: string | null
  readonly rideModesExperience: string | null
  readonly overallExperience: string | null
  readonly topThreeFeatures: string | null
  readonly overallExperienceComments: string | null
  readonly registrationRecordId: string | null
  readonly feedbackRecordId: string | null
  readonly registrationCreatedAt: string | null
  readonly feedbackCreatedAt: string | null
}

/** The answer columns, blank. Used by a registration with no response. */
const NO_RESPONSE = {
  captureMethod: null,
  formVersion: null,
  testRideExperience: null,
  rotaryKnobUsage: null,
  rideModesExperience: null,
  overallExperience: null,
  topThreeFeatures: null,
  overallExperienceComments: null,
  feedbackRecordId: null,
  feedbackCreatedAt: null,
} as const

/** The registration columns, blank. Used by a response with no registration. */
const NO_REGISTRATION = {
  name: null,
  phone: null,
  email: null,
  drivingLicence: null,
  gender: null,
  pincode: null,
  vehicle: null,
  interestedColour: null,
  location: null,
  testRideAt: null,
  registrationRecordId: null,
  registrationCreatedAt: null,
} as const

/**
 * A response's answers, read only under the questionnaire that defines them.
 *
 * The export query already guards these on the form version. Guarded again here
 * because this sheet prints them under headings that name a 1-to-7 scale, and a
 * later questionnaire reusing a key name such as `overallExperienceRating` on a
 * different scale would otherwise be rendered as though it were the campaign's.
 * A blank cell is the honest answer; the raw Feedback sheet still carries
 * everything.
 */
function campaignAnswers(response: FeedbackExportRow) {
  if (response.formVersion !== FLYING_FLEA_FORM_VERSION) {
    return {
      testRideExperience: null,
      rotaryKnobUsage: null,
      rideModesExperience: null,
      overallExperience: null,
      topThreeFeatures: null,
      overallExperienceComments: null,
    }
  }

  return {
    testRideExperience: response.testRideExperienceRating,
    rotaryKnobUsage: response.rotaryKnobRating,
    rideModesExperience: response.rideModesRating,
    overallExperience: response.overallExperienceRating,
    topThreeFeatures: response.topThreeFeatures,
    overallExperienceComments: response.overallExperienceComments,
  }
}

function registrationColumns(registration: RegistrationExportRow) {
  return {
    name: registration.name,
    phone: registration.phone,
    email: registration.email,
    drivingLicence: registration.drivingLicence,
    gender: registration.gender,
    pincode: registration.pincode,
    vehicle: registration.vehicle,
    interestedColour: registration.interestedColour,
    location: registration.location,
    testRideAt: registration.testRideAt,
    registrationRecordId: registration.recordId,
    registrationCreatedAt: registration.createdAt,
  }
}

function responseColumns(response: FeedbackExportRow) {
  return {
    captureMethod: response.captureMethod,
    formVersion: response.formVersion,
    ...campaignAnswers(response),
    feedbackRecordId: response.recordId,
    feedbackCreatedAt: response.createdAt,
  }
}

/**
 * Compiles the participant view from the two raw export sets.
 *
 * ## Ordering
 *
 * 1. Registered participants first, in the order `exportRegistrationRows`
 *    returns them, which is `created_at, record_id`: the order riders arrived at
 *    Point A, and therefore roughly the order they rode.
 * 2. A participant's responses follow their registration immediately, in the
 *    order `exportFeedbackRows` returns them (`created_at, record_id`). Several
 *    responses for one rider are therefore always adjacent, which is the whole
 *    point of not choosing a winner.
 * 3. Responses with no registration last, in the same feedback order. They are
 *    at the end because they belong to nobody in the list above, not because
 *    they matter less.
 *
 * Deterministic: the same run produces the same sheet, so two exports can be
 * diffed.
 */
export function compileParticipantFeedback(
  runId: string,
  registrations: readonly RegistrationExportRow[],
  feedback: readonly FeedbackExportRow[],
): ParticipantFeedbackRow[] {
  /*
   * Responses grouped by the registration the RUN attached them to. Not by
   * participant ID or public code: re-deriving a relationship the run already
   * decided is how a convenience view starts disagreeing with the audit sheets.
   *
   * `registrationRecordId` is null for both `without_registration` and
   * `identity_conflict`, which is the engine refusing to name a registration.
   * This module honours that refusal rather than guessing from the code.
   */
  const byRegistration = new Map<string, FeedbackExportRow[]>()
  const orphans: FeedbackExportRow[] = []

  for (const response of feedback) {
    if (response.registrationRecordId === null) {
      orphans.push(response)
      continue
    }
    const existing = byRegistration.get(response.registrationRecordId)
    if (existing === undefined) {
      byRegistration.set(response.registrationRecordId, [response])
    } else {
      existing.push(response)
    }
  }

  const rows: ParticipantFeedbackRow[] = []

  for (const registration of registrations) {
    const responses = byRegistration.get(registration.recordId) ?? []
    const status =
      REGISTRATION_STATUS_LABELS[registration.status] ?? registration.status

    if (responses.length === 0) {
      rows.push({
        runId,
        status,
        publicCode: registration.publicCode,
        ...registrationColumns(registration),
        ...NO_RESPONSE,
      })
      continue
    }

    // One row per response, the registration repeated. No winner is chosen,
    // here or anywhere: that is the run's finding, and it is preserved.
    for (const response of responses) {
      rows.push({
        runId,
        status,
        publicCode: registration.publicCode,
        ...registrationColumns(registration),
        ...responseColumns(response),
      })
    }
  }

  for (const response of orphans) {
    rows.push({
      runId,
      status: FEEDBACK_STATUS_LABELS[response.status] ?? response.status,
      // The code the response itself carries: for a manual entry that is what
      // the operator typed, which is exactly the thing worth seeing here.
      publicCode: response.publicCode,
      ...NO_REGISTRATION,
      ...responseColumns(response),
    })
  }

  return rows
}

/** One compiled row as the sheet's cells, in header order. */
export function participantFeedbackCells(
  row: ParticipantFeedbackRow,
): readonly unknown[] {
  return [
    row.runId,
    row.status,
    row.publicCode,
    row.name,
    row.phone,
    row.email,
    row.drivingLicence,
    row.gender,
    row.pincode,
    row.vehicle,
    row.interestedColour,
    row.location,
    row.testRideAt,
    row.captureMethod,
    row.formVersion,
    row.testRideExperience,
    row.rotaryKnobUsage,
    row.rideModesExperience,
    row.overallExperience,
    row.topThreeFeatures,
    row.overallExperienceComments,
    row.registrationRecordId,
    row.feedbackRecordId,
    row.registrationCreatedAt,
    row.feedbackCreatedAt,
  ]
}
