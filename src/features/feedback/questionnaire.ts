import {
  EXPERIENCE_VALUES,
  FEEDBACK_FORM_VERSION,
  MAX_COMMENTS_LENGTH,
  OVERALL_RATINGS,
  type ExperienceValue,
  type FeedbackV1Answers,
  type OverallRating,
} from '../../types'

/*
 * The `feedback-v1` questionnaire.
 *
 * Four questions, locked. The prompts and visible labels live here; the stored
 * values live in `src/types/feedback.ts`. Keeping them apart is what lets the
 * wording change, or be translated, without touching a single recorded
 * answer's meaning.
 */

export { FEEDBACK_FORM_VERSION }

export const QUESTION_PROMPTS = {
  overall_rating: 'Overall rating',
  experience: 'How was your experience?',
  recommend: 'Would you recommend this experience?',
  comments: 'Any comments?',
} as const

/** Visible label for each stored `experience` value. */
export const EXPERIENCE_LABELS: Readonly<Record<ExperienceValue, string>> = {
  very_poor: 'Very Poor',
  poor: 'Poor',
  okay: 'Okay',
  good: 'Good',
  excellent: 'Excellent',
}

export const EXPERIENCE_OPTIONS: readonly {
  readonly value: ExperienceValue
  readonly label: string
}[] = EXPERIENCE_VALUES.map((value) => ({
  value,
  label: EXPERIENCE_LABELS[value],
}))

export const RATING_OPTIONS = OVERALL_RATINGS

/** What the form holds while a participant is still answering. */
export interface FeedbackDraft {
  readonly overall_rating: OverallRating | null
  readonly experience: ExperienceValue | null
  readonly recommend: boolean | null
  readonly comments: string
}

export const EMPTY_DRAFT: FeedbackDraft = {
  overall_rating: null,
  experience: null,
  recommend: null,
  comments: '',
}

export type FeedbackFieldErrors = Partial<
  Record<keyof FeedbackDraft, string>
>

export type FeedbackValidationResult =
  | { readonly ok: true; readonly answers: FeedbackV1Answers }
  | { readonly ok: false; readonly errors: FeedbackFieldErrors }

/**
 * Validates a draft and produces the canonical answers to persist.
 *
 * The three required questions are closed sets, so validation is a presence
 * check rather than a parse: the UI can only produce valid values, and this
 * exists so that stays true if the UI changes.
 *
 * A blank comment becomes an absent field rather than an empty string, so
 * "said nothing" and "typed three spaces" do not become different data.
 */
export function validateFeedbackDraft(
  draft: FeedbackDraft,
): FeedbackValidationResult {
  const errors: FeedbackFieldErrors = {}

  if (draft.overall_rating === null) {
    errors.overall_rating = 'Choose a rating from 1 to 5.'
  }
  if (draft.experience === null) {
    errors.experience = 'Choose how the experience was.'
  }
  if (draft.recommend === null) {
    errors.recommend = 'Choose Yes or No.'
  }

  const comments = draft.comments.trim()
  if (comments.length > MAX_COMMENTS_LENGTH) {
    errors.comments = `Comments must be ${MAX_COMMENTS_LENGTH} characters or fewer.`
  }

  if (
    draft.overall_rating === null ||
    draft.experience === null ||
    draft.recommend === null ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    answers: {
      overall_rating: draft.overall_rating,
      experience: draft.experience,
      recommend: draft.recommend,
      ...(comments.length > 0 ? { comments } : {}),
    },
  }
}

/** Whether every required question has an answer. */
export function isDraftComplete(draft: FeedbackDraft): boolean {
  return validateFeedbackDraft(draft).ok
}
