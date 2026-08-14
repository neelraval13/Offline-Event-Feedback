import { FLYING_FLEA_FORM_VERSION } from '../../../shared/campaign/flyingFlea'
import { FEEDBACK_FORM_VERSION } from '../../types'
import type { FeedbackRow } from '../../lib/reporting/types'

/*
 * One line describing one response.
 *
 * Every questionnaire this build knows gets a summary on its own terms; anything
 * else says so plainly and points at the detail view. The version strings come
 * from the shared campaign definition and the domain types — a fourth hardcoded
 * copy of `'flying-flea-feedback-v1'` is exactly how a screen ends up claiming it
 * cannot read a questionnaire it fully understands, which is the bug this
 * component was extracted to fix.
 *
 * A summary is per response and never per participant. Where a run found several
 * valid responses they are all rendered, each with its own line: summarising a
 * response is describing what it says, and none of them thereby becomes the
 * participant's answer.
 */

interface ResponseSummaryProps {
  readonly response: FeedbackRow
}

/** `7/7`, or an em dash when the rider skipped the question. */
function outOfSeven(rating: number | null): string {
  return rating === null ? '—' : `${rating}/7`
}

export function ResponseSummary({ response }: ResponseSummaryProps) {
  if (response.formVersion === FEEDBACK_FORM_VERSION) {
    return (
      <>
        Rated {response.overallRating ?? '—'}, {response.experience ?? '—'},{' '}
        {response.recommend === null
          ? 'no recommendation'
          : response.recommend
            ? 'would recommend'
            : 'would not recommend'}
      </>
    )
  }

  if (
    response.formVersion === FLYING_FLEA_FORM_VERSION &&
    response.campaignSummary !== null
  ) {
    const summary = response.campaignSummary

    return (
      <>
        Flying Flea feedback · Overall{' '}
        {outOfSeven(summary.overallExperienceRating)}
        <br />
        Test ride {outOfSeven(summary.testRideExperience)} · Rotary knob{' '}
        {outOfSeven(summary.rotaryKnobUsage)} · Ride modes{' '}
        {outOfSeven(summary.rideModesExperience)}
      </>
    )
  }

  /*
   * A questionnaire this build has never seen. Its answers are stored, exported
   * and readable individually — what is refused is a summary, because a key that
   * looks familiar may mean something entirely different on a scale nobody here
   * knows.
   */
  return (
    <>
      Captured under questionnaire {response.formVersion}, which this build
      cannot summarise — open the response to see its answers as recorded.
    </>
  )
}
