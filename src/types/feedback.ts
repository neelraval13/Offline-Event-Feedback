/*
 * The feedback questionnaire's data model.
 *
 * These are the canonical persisted values. Anything a participant taps is
 * translated into exactly these before it reaches storage, so a later reader —
 * the central server, an analyst, a future version of this app — never has to
 * guess what a stored answer meant.
 */

/** Questionnaire the answers belong to. */
export const FEEDBACK_FORM_VERSION = 'feedback-v1'

/**
 * Every questionnaire the system has ever shipped.
 *
 * Persisted with each response, so changing the questions later stays a
 * additive union rather than a reinterpretation of records already collected.
 */
export type FeedbackFormVersion = typeof FEEDBACK_FORM_VERSION

/** `overall_rating` — 1 to 5 inclusive. */
export type OverallRating = 1 | 2 | 3 | 4 | 5

/** `experience` — a closed set, stored as stable machine values. */
export type ExperienceValue =
  | 'very_poor'
  | 'poor'
  | 'okay'
  | 'good'
  | 'excellent'

/** Answers to `feedback-v1`. */
export interface FeedbackV1Answers {
  readonly overall_rating: OverallRating
  readonly experience: ExperienceValue
  readonly recommend: boolean
  /**
   * Absent when the participant left it blank. An empty or whitespace-only
   * comment is stored as nothing at all rather than as an empty string, so
   * "said nothing" and "typed spaces" do not become different data.
   */
  readonly comments?: string
}

/**
 * Answers to whichever questionnaire a record declares.
 *
 * One member today. A second questionnaire adds a member here and a value to
 * {@link FeedbackFormVersion}; `formVersion` on the record is what tells a
 * reader which shape it is holding.
 */
export type FeedbackAnswers = FeedbackV1Answers

export const OVERALL_RATINGS: readonly OverallRating[] = [1, 2, 3, 4, 5]

export const EXPERIENCE_VALUES: readonly ExperienceValue[] = [
  'very_poor',
  'poor',
  'okay',
  'good',
  'excellent',
]

/** Maximum stored length of a free-text comment. */
export const MAX_COMMENTS_LENGTH = 2000
