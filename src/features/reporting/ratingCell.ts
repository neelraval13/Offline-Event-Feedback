import { FLYING_FLEA_FORM_VERSION } from '../../../shared/campaign/flyingFlea'
import { FEEDBACK_FORM_VERSION } from '../../types'
import type { FeedbackRow } from '../../lib/reporting/types'

/*
 * The Rating column in the response list.
 *
 * One column, two questionnaires, and they do not share a scale or a key. The
 * table used to render `row.overallRating` for every row, which is the
 * `feedback-v1` answer and is null under any other questionnaire. So a Flying
 * Flea response that had answered "5 out of 7" listed as `None`, while the
 * Overview on the same screen reported it correctly. Nothing was wrong with the
 * data: the column was reading the wrong field.
 *
 * A rating is therefore never rendered without the scale it was given on. `5`
 * alone is ambiguous between the two questionnaires this build reads, and the
 * one place that ambiguity does no harm is `feedback-v1`, where the column has
 * always shown a bare number and an export column is the authority anyway.
 *
 * This is presentation only. Nothing here touches stored answers, the reporting
 * DTOs, analytics, reconciliation or any export value.
 */

/** What a response with no readable rating shows, per questionnaire. */
const NOT_RATED = 'None'

/**
 * A questionnaire this build has never seen. Its answers are stored and
 * exported; what is refused is a number under a scale nobody here knows, which
 * would read as "this rider did not answer".
 */
const UNKNOWN_QUESTIONNAIRE = 'Not available'

export function ratingCell(row: FeedbackRow): string {
  if (row.formVersion === FLYING_FLEA_FORM_VERSION) {
    const rating = row.campaignSummary?.overallExperienceRating ?? null
    return rating === null ? NOT_RATED : `${rating} / 7`
  }

  if (row.formVersion === FEEDBACK_FORM_VERSION) {
    // The legacy display, unchanged: a bare number, or `None`.
    return row.overallRating === null ? NOT_RATED : String(row.overallRating)
  }

  return UNKNOWN_QUESTIONNAIRE
}
