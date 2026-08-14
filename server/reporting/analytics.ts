import type {
  FeedbackAnalytics,
  ResponseCoverage,
  RunDescriptor,
} from './types'

/*
 * Reporting analytics.
 *
 * Two different questions, deliberately kept apart:
 *
 *   analytics  — what did unambiguous responses say?
 *   coverage   — how many participants gave us anything at all?
 *
 * Conflating them is the easy mistake. A participant with two conflicting
 * responses counts towards coverage (they did respond) but contributes to no
 * average (we do not know which answer is theirs).
 */

/** The questionnaire this build can read. */
export const SUPPORTED_FORM_VERSION = 'feedback-v1'

export interface AnalysableResponse {
  readonly formVersion: string
  readonly answers: Readonly<Record<string, unknown>>
}

const EXPERIENCES = [
  'very_poor',
  'poor',
  'okay',
  'good',
  'excellent',
] as const

/**
 * Computes analytics from responses that reconciliation classified `matched`.
 *
 * The caller is responsible for that filter — it is a SQL join on
 * `reconciliation_feedback_results.status = 'matched'` — because doing it here
 * would mean loading every response into memory to throw most of them away.
 *
 * A response whose `form_version` this build does not understand is counted and
 * skipped rather than guessed at. A future questionnaire might use the same
 * field names for different scales, and averaging across them silently would
 * produce a number that looks fine and means nothing.
 */
export function computeAnalytics(
  responses: readonly AnalysableResponse[],
): FeedbackAnalytics {
  const ratingCounts = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
  const experienceCounts = {
    very_poor: 0,
    poor: 0,
    okay: 0,
    good: 0,
    excellent: 0,
  }

  let ratingTotal = 0
  let ratingSamples = 0
  let recommendYes = 0
  let recommendNo = 0
  let analysed = 0
  let unreadable = 0

  for (const response of responses) {
    if (response.formVersion !== SUPPORTED_FORM_VERSION) {
      unreadable += 1
      continue
    }

    analysed += 1

    /*
     * `feedback-v1` asks for a whole number from 1 to 5. A 2.5 is not a possible
     * answer to that question, so it is not counted: `String(2.5)` is not a key
     * of `ratingCounts`, and without the integer check it would silently create
     * one while still moving the average. Malformed input is excluded, not
     * rounded — rounding would invent an answer nobody gave.
     */
    const rating = response.answers['overall_rating']
    if (
      typeof rating === 'number' &&
      Number.isInteger(rating) &&
      rating >= 1 &&
      rating <= 5
    ) {
      const key = String(rating) as keyof typeof ratingCounts
      ratingCounts[key] += 1
      ratingTotal += rating
      ratingSamples += 1
    }

    const experience = response.answers['experience']
    if (
      typeof experience === 'string' &&
      (EXPERIENCES as readonly string[]).includes(experience)
    ) {
      experienceCounts[experience as (typeof EXPERIENCES)[number]] += 1
    }

    const recommend = response.answers['recommend']
    if (recommend === true) {
      recommendYes += 1
    } else if (recommend === false) {
      recommendNo += 1
    }
  }

  const recommendTotal = recommendYes + recommendNo

  return {
    analysedResponses: analysed,
    averageOverallRating:
      ratingSamples === 0
        ? null
        : Math.round((ratingTotal / ratingSamples) * 100) / 100,
    ratingCounts,
    experienceCounts,
    recommendYes,
    recommendNo,
    recommendPercentage:
      recommendTotal === 0
        ? null
        : Math.round((recommendYes / recommendTotal) * 1000) / 10,
    unreadableFormVersions: unreadable,
  }
}

/**
 * Response coverage: participants who gave any valid response.
 *
 * Includes registrations with several responses — the participant did answer,
 * even though the run cannot say which answer is theirs. This is why coverage
 * is usually a larger number than the analytics sample, and why the two are
 * reported separately rather than as one "response rate".
 */
export function computeCoverage(run: RunDescriptor): ResponseCoverage {
  const withFeedback =
    run.counts.matchedRegistrations + run.counts.registrationsWithMultipleFeedback
  const total = run.counts.registrationCount

  return {
    registrationsWithFeedback: withFeedback,
    totalRegistrations: total,
    percentage: total === 0 ? null : Math.round((withFeedback / total) * 1000) / 10,
  }
}
