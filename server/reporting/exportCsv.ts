import type { FeedbackExportRow, RegistrationExportRow } from './postgres.js'
import type { DuplicateCandidateRow, RunDescriptor } from './types.js'

/*
 * CSV export.
 *
 * Participant text is untrusted spreadsheet input. A comment beginning `=` or a
 * phone number beginning `+` is interpreted by Excel, Numbers and Google Sheets
 * as a **formula**, not as text, which at worst can invoke external calls when
 * the recipient opens the file, and at best silently mangles the value into
 * `#NAME?`.
 *
 * Phone numbers make this unavoidable rather than theoretical: every
 * international number in the export starts with `+`.
 */

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_PREFIXES = ['=', '+', '-', '@']

/** Control characters some spreadsheets also treat as formula leads. */
const CONTROL_PREFIXES = ['\t', '\r', '\n']

/**
 * Neutralises a value that a spreadsheet would otherwise evaluate.
 *
 * Prefixed with an apostrophe, the standard "treat this as text" marker, which
 * spreadsheets strip on display. The stored value is unchanged for anything
 * that was never dangerous.
 */
export function neutralizeFormula(value: string): string {
  if (value.length === 0) {
    return value
  }

  const first = value.charAt(0)
  if (FORMULA_PREFIXES.includes(first) || CONTROL_PREFIXES.includes(first)) {
    return `'${value}`
  }

  return value
}

/** Quotes a field for RFC 4180, after neutralising formulas. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  const raw = typeof value === 'boolean' ? String(value) : String(value)
  const safe = neutralizeFormula(raw)

  // Quote whenever a comma, quote, newline or leading apostrophe would
  // otherwise break the row.
  if (/[",\r\n]/.test(safe) || safe !== raw) {
    return `"${safe.replace(/"/g, '""')}"`
  }

  return safe
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvField).join(',')
}

function csv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  // CRLF per RFC 4180; Excel is happier and every other tool copes.
  return [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n'
}

export const REGISTRATION_CSV_HEADER = [
  'reconciliation_run_id',
  'reconciliation_completed_at',
  'record_id',
  'participant_id',
  'public_code',
  'name',
  'phone',
  'email',
  // Campaign fields. Blank for a registration captured before the campaign,
  // never defaulted: an empty cell is the truth about what was captured.
  'vehicle',
  'interested_colour',
  'location',
  'gender',
  'test_ride_at',
  'driving_licence',
  'pincode',
  'registration_created_at',
  'revision',
  'reconciliation_status',
  'valid_feedback_count',
  'possible_duplicate',
  'feedback_record_id',
  'capture_method',
  'overall_rating',
  'experience',
  'recommend',
  'comments',
] as const

export function registrationsCsv(
  run: RunDescriptor,
  rows: readonly RegistrationExportRow[],
): string {
  return csv(
    REGISTRATION_CSV_HEADER,
    rows.map((row) => [
      run.runId,
      run.completedAt,
      row.recordId,
      row.participantId,
      row.publicCode,
      row.name,
      row.phone,
      row.email,
      row.vehicle,
      row.interestedColour,
      row.location,
      row.gender,
      row.testRideAt,
      row.drivingLicence,
      row.pincode,
      row.createdAt,
      row.revision,
      row.status,
      row.validFeedbackCount,
      row.potentialDuplicate ? 'true' : 'false',
      // Blank for multiple_feedback: the run chose no winner and neither does
      // the export. Every individual response is in the feedback file.
      row.feedbackRecordId,
      row.captureMethod,
      row.overallRating,
      row.experience,
      row.recommend,
      row.comments,
    ]),
  )
}

export const FEEDBACK_CSV_HEADER = [
  'reconciliation_run_id',
  'feedback_record_id',
  'public_code',
  'participant_id',
  'capture_method',
  'form_version',
  'feedback_created_at',
  'revision',
  'reconciliation_status',
  'match_method',
  'registration_record_id',
  'registration_public_code',
  'registration_name',
  'registration_phone',
  'registration_email',
  // `feedback-v1` answers.
  'overall_rating',
  'experience',
  'recommend',
  'comments',
  // `flying-flea-feedback-v1` answers. Both questionnaires keep their own
  // columns rather than sharing a generic pair: a 1-5 rating and a 1-7 rating
  // in one column would be silently unusable.
  'test_ride_experience_rating',
  'rotary_knob_rating',
  'ride_modes_rating',
  'overall_experience_rating',
  'top_three_features',
  'overall_experience_comments',
  /*
   * Contact identity, appended rather than inserted.
   *
   * Every existing column keeps its name and its position, because a CSV header
   * is a contract with whatever is already reading these files: a script that
   * indexes by column number, a saved spreadsheet import, a pivot table
   * somebody built last week. Appending is invisible to all of them; inserting
   * in a tidier place would silently shift every column after it and nothing
   * would report an error.
   *
   * Blank for a qr or manual response, which never had them.
   */
  'respondent_name',
  'respondent_phone',
  'respondent_email',
] as const

export function feedbackCsv(
  run: RunDescriptor,
  rows: readonly FeedbackExportRow[],
): string {
  return csv(
    FEEDBACK_CSV_HEADER,
    rows.map((row) => [
      run.runId,
      row.recordId,
      row.publicCode,
      row.participantId,
      row.captureMethod,
      row.formVersion,
      row.createdAt,
      row.revision,
      row.status,
      row.matchMethod,
      row.registrationRecordId,
      row.registrationPublicCode,
      row.registrationName,
      row.registrationPhone,
      row.registrationEmail,
      row.overallRating,
      row.experience,
      row.recommend,
      row.comments,
      row.testRideExperienceRating,
      row.rotaryKnobRating,
      row.rideModesRating,
      row.overallExperienceRating,
      row.topThreeFeatures,
      row.overallExperienceComments,
      row.respondentName,
      row.respondentPhone,
      row.respondentEmail,
    ]),
  )
}

export const DUPLICATE_CSV_HEADER = [
  'reconciliation_run_id',
  'match_basis',
  'left_record_id',
  'left_public_code',
  'left_name',
  'left_phone',
  'left_email',
  'right_record_id',
  'right_public_code',
  'right_name',
  'right_phone',
  'right_email',
] as const

export function duplicateCandidatesCsv(
  run: RunDescriptor,
  rows: readonly DuplicateCandidateRow[],
): string {
  return csv(
    DUPLICATE_CSV_HEADER,
    rows.map((row) => [
      run.runId,
      row.matchBasis,
      row.left.recordId,
      row.left.publicCode,
      row.left.name,
      row.left.phone,
      row.left.email,
      row.right.recordId,
      row.right.publicCode,
      row.right.name,
      row.right.phone,
      row.right.email,
    ]),
  )
}

/**
 * A filename carrying an event, a kind and a date, never a participant.
 *
 * Filenames are visible in a downloads folder, an email client and a backup
 * log, long before anyone opens the file.
 */
export function exportFileName(
  eventId: string,
  kind: string,
  extension: string,
  now: Date,
): string {
  const safeEvent = eventId.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${safeEvent}-${kind}-${now.toISOString().slice(0, 10)}.${extension}`
}
