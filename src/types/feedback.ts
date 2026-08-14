import {
  FLYING_FLEA_FORM_VERSION,
  type FlyingFleaFeedbackV1Answers,
} from './campaign'

/*
 * The feedback questionnaire's data model.
 *
 * These are the canonical persisted values. Anything a participant taps is
 * translated into exactly these before it reaches storage, so a later reader
 * (the central server, an analyst, a future version of this app) never has to
 * guess what a stored answer meant.
 */

/** The original generic questionnaire. */
export const FEEDBACK_FORM_VERSION = 'feedback-v1'

/**
 * Every questionnaire the system has ever shipped.
 *
 * Persisted with each response, so changing the questions later stays an
 * additive union rather than a reinterpretation of records already collected.
 *
 * The Flying Flea campaign added the second member. Nothing reinterprets the
 * first: a `feedback-v1` record still means a 1-5 rating and a recommend
 * question, and every reader in the system branches on this value rather than
 * assuming a shape.
 */
export type FeedbackFormVersion =
  | typeof FEEDBACK_FORM_VERSION
  | typeof FLYING_FLEA_FORM_VERSION

/** `overall_rating`: 1 to 5 inclusive. */
export type OverallRating = 1 | 2 | 3 | 4 | 5

/** `experience`: a closed set, stored as stable machine values. */
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
 * `formVersion` on the record is what tells a reader which member it is
 * holding. The two shapes have no field in common, deliberately: a reader that
 * forgets to check the version fails to compile rather than quietly reading a
 * 1-7 rating as if it were the old 1-5 one.
 */
export type FeedbackAnswers = FeedbackV1Answers | FlyingFleaFeedbackV1Answers

/**
 * A questionnaire and its answers, as one indivisible value.
 *
 * The two used to be independent fields (a `FeedbackFormVersion` beside a
 * `FeedbackAnswers`), and that let this compile:
 *
 *     { formVersion: 'feedback-v1', answers: flyingFleaAnswers }
 *
 * which is a record claiming to be one questionnaire while carrying another's
 * answers. Nothing on the device would have noticed; it would have failed at the
 * server, or worse, been counted in the wrong average.
 *
 * As a discriminated union the pair cannot be built wrong, and a reader that
 * narrows on `formVersion` gets the right answer type for free. The runtime
 * validators are unchanged and still required: this stops *our* code writing a
 * bad pair, not a tampered backup file or a hostile upload.
 */
export type FeedbackQuestionnairePayload =
  | {
      readonly formVersion: typeof FEEDBACK_FORM_VERSION
      readonly answers: FeedbackV1Answers
    }
  | {
      readonly formVersion: typeof FLYING_FLEA_FORM_VERSION
      readonly answers: FlyingFleaFeedbackV1Answers
    }

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
