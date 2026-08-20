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
 * ## The shapes a row can have
 *
 *   Matched              one registration, one response, side by side
 *   No response          the registration, with the answer columns blank
 *   Multiple responses   the registration repeated once per response
 *   Direct feedback      a rider who answered without ever registering
 *   No registration      a sticker response whose code resolved to nobody
 *   Identity conflict    a response the run refused to attach to anyone
 *
 * The last three are why this is not simply "the Registrations sheet with
 * answers glued on". A registration-first join silently drops every response
 * that has no registration, and those are the operationally interesting ones: a
 * mistyped code at Point B is still somebody's opinion of the event, and a rider
 * who walked up to Point B without ever registering is a whole participant the
 * registration list has never heard of.
 *
 * `Direct feedback` and `No registration` look identical in this sheet, one
 * response and no registration columns, and mean opposite things. That is why
 * they are two statuses and not one: the first is the contact path working, the
 * second is a sticker that led nowhere.
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
  /*
   * Not "no registration", although that is literally true of it. The label a
   * reader sees decides what they do about a row, and "Direct feedback" invites
   * them to read the answers, which is correct, where anything phrased as an
   * absence invites them to go looking for a registration that was never
   * supposed to exist.
   */
  standalone: 'Direct feedback',
}

/**
 * Where a row's identity came from, in one column.
 *
 * The organiser's question is "can I trust that these answers belong to this
 * rider, and how do I know?", and before this column the sheet could not
 * answer it: a matched contact row and a matched QR row looked identical while
 * resting on very different evidence. A scanned sticker is the strongest link
 * this system produces; a phone and email pair matching exactly one
 * registration is a deliberate inference, sound but inferred.
 *
 * One column, not four. Capture method, match method and status are three
 * facts, and spreading them across the left of a client-facing sheet would
 * make a reader reconstruct the answer from a table of machine tokens. The
 * underlying values are all still present: capture method has its own column,
 * match method is in the raw Feedback sheet, and record IDs are on the right.
 */
const IDENTITY_SOURCES: Readonly<Record<string, string>> = {
  qr: 'QR sticker',
  manual: 'Typed code',
}

function identitySource(response: FeedbackExportRow): string {
  if (response.captureMethod !== 'contact') {
    return IDENTITY_SOURCES[response.captureMethod] ?? response.captureMethod
  }

  /*
   * The contact path splits on whether reconciliation found the rider. Both are
   * "contact details"; the difference is whether a Point A registration is
   * being shown beside them, and a reader looking at populated registration
   * columns deserves to know they were joined rather than scanned.
   */
  return response.matchMethod === 'contact_identity'
    ? 'Contact details, matched to Point A'
    : 'Contact details, direct'
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
  'Identity Source',
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

  /*
   * Audit, at the far right and last.
   *
   * On a matched contact row the Name, Phone and Email columns hold the Point A
   * registration's values, because a compiled row about a rider should show
   * what the event recorded about that rider. These three hold what the rider
   * typed at Point B, which is the evidence the match was made from.
   *
   * The two are usually identical, and the times they are not are precisely the
   * times somebody needs to see both: a rider who gave a different email at the
   * two desks, a phone number transposed at one of them. Keeping only the
   * registration's copy would hide the very difference that explains an
   * unexpected match, and keeping only the rider's would misreport who the
   * registration says they are.
   *
   * Populated on every contact row, matched or not. Blank on the sticker paths,
   * which never asked.
   */
  'Respondent Name (as entered)',
  'Respondent Phone (as entered)',
  'Respondent Email (as entered)',
] as const

/** Widths, by eye: identifiers narrow, free text wide enough to read. */
export const PARTICIPANT_FEEDBACK_WIDTHS: readonly number[] = [
  38, 20, 30, 22, 26, 18, 30, 22, 12, 12, 14, 18, 24, 22, 14, 26, 12, 12, 12,
  12, 60, 60, 38, 38, 26, 26, 26, 18, 30,
]

export interface ParticipantFeedbackRow {
  readonly runId: string
  readonly status: string
  readonly identitySource: string | null
  readonly publicCode: string | null
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
  readonly respondentName: string | null
  readonly respondentPhone: string | null
  readonly respondentEmail: string | null
}

/** The answer columns, blank. Used by a registration with no response. */
const NO_RESPONSE = {
  identitySource: null,
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
  respondentName: null,
  respondentPhone: null,
  respondentEmail: null,
} as const

/**
 * The registration columns, blank. Used by a response with no registration.
 *
 * Every Point A field, including the four this sheet's contact rows will fill
 * in from elsewhere. Whichever row shape uses this spreads its own values after
 * it, so nothing can be left holding a value from a registration that does not
 * exist.
 */
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
    identitySource: identitySource(response),
    captureMethod: response.captureMethod,
    formVersion: response.formVersion,
    ...campaignAnswers(response),
    feedbackRecordId: response.recordId,
    feedbackCreatedAt: response.createdAt,
    // What the rider typed, kept whatever else the row shows.
    respondentName: response.respondentName,
    respondentPhone: response.respondentPhone,
    respondentEmail: response.respondentEmail,
  }
}

/**
 * The people columns for a response that has no registration to draw them from.
 *
 * A contact response knows exactly who it is from: the rider typed it. Leaving
 * Name, Phone and Email blank on those rows would be discarding the one thing
 * the sheet's reader most needs, and would make every direct response look like
 * anonymous feedback when it is the opposite.
 *
 * The Point A-only fields stay blank, and that is not an oversight to be tidied
 * up later. Nothing in this system knows this rider's vehicle, licence, gender,
 * pincode or ride slot, because nobody ever asked them. A blank cell says so.
 *
 * A sticker response with no registration gets nothing here, correctly: its
 * identity is a code that led nowhere, and there is no person attached to it to
 * name.
 */
function respondentAsPerson(response: FeedbackExportRow) {
  return {
    name: response.respondentName,
    phone: response.respondentPhone,
    email: response.respondentEmail,
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
 * 3. Responses with no registration last, in the same feedback order. That is
 *    every direct response, every sticker that resolved to nobody and every
 *    identity conflict, interleaved in the order they were answered. They are
 *    at the end because they belong to nobody in the list above, not because
 *    they matter less, and they are not sorted into separate blocks by status
 *    because the sheet has an auto-filter and a Status column for that.
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
      // the operator typed, which is exactly the thing worth seeing here. Null
      // for a contact capture, which never had one.
      publicCode: response.publicCode,
      ...NO_REGISTRATION,
      /*
       * A contact response names its own rider; a sticker response does not.
       * Spread after NO_REGISTRATION so it fills only what it genuinely knows,
       * and returns nothing at all for a sticker.
       */
      ...(response.captureMethod === 'contact'
        ? respondentAsPerson(response)
        : {}),
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
    row.identitySource,
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
    row.respondentName,
    row.respondentPhone,
    row.respondentEmail,
  ]
}
