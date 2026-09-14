/*
 * What it means for two locations to disagree.
 *
 * A matched response has two independent statements about where it happened:
 * the city Point A stamped on the registration, and the city Point B stamped on
 * the response. They are captured by different people on different devices at
 * different moments, so they can differ, and when they do, that disagreement is
 * information.
 *
 * ## Neither one is corrected, and neither is hidden
 *
 * The obvious shortcut is to pick a winner. It is wrong in both directions. The
 * registration is not automatically right: a rider may have registered in
 * Bengaluru and given feedback in Hyderabad, and the response's own city is the
 * truthful record of where the response was taken. The response is not
 * automatically right either: a Point B device left on the wrong city records a
 * whole session's worth of confidently wrong venues, and the registrations are
 * then the evidence that something was misconfigured.
 *
 * Since the data cannot say which reading is correct, reporting shows both and
 * flags the difference. That turns a silent data-quality problem into a visible
 * row somebody can look into, which is the only useful thing to do with it.
 *
 * ## Absence is not disagreement
 *
 * A missing location on either side is NOT a mismatch. An August response has
 * no location at all, and a registration captured before the campaign has none
 * either. Counting those as disagreements would fill the diagnostic with every
 * historical row and bury the handful of real conflicts, which is the same
 * mistake as folding `standalone` into `without_registration`.
 *
 * Shared rather than written twice. The workbook and the reporting screen must
 * agree about which rows are flagged: a sheet that flagged a row the screen did
 * not would make a reader doubt both.
 */

/** Shown where a location was never captured. Never a guessed city. */
export const LOCATION_NOT_CAPTURED = 'Not captured'

/**
 * Whether two recorded locations positively disagree.
 *
 * True only when both are present and different. Absent on either side means
 * "not captured", which is an absence of evidence rather than a conflict.
 */
export function locationsDisagree(
  registrationLocation: string | null | undefined,
  feedbackLocation: string | null | undefined,
): boolean {
  if (
    registrationLocation === null ||
    registrationLocation === undefined ||
    registrationLocation.length === 0
  ) {
    return false
  }
  if (
    feedbackLocation === null ||
    feedbackLocation === undefined ||
    feedbackLocation.length === 0
  ) {
    return false
  }

  return registrationLocation !== feedbackLocation
}
