import {
  FLYING_FLEA_FORM_VERSION,
  MAX_CAMPAIGN_TEXT_LENGTH,
  isRating1To7,
  type FlyingFleaFeedbackV1Answers,
  type Rating1To7,
} from '../../../types'
import { FLYING_FLEA_CAMPAIGN } from './config'

/*
 * `flying-flea-feedback-v1`: draft to stored answers.
 *
 * The four ratings are required (they are the entire point of the campaign's
 * feedback capture) and the two free-text answers are not. A rider who has
 * just got off a motorcycle and wants to leave is not going to be held at the
 * tablet for a paragraph.
 *
 * Blank text becomes an absent field rather than an empty string, so "wrote
 * nothing" and "typed a space" do not become different data. This is the same
 * rule `feedback-v1` applies to its comments, kept deliberately identical so
 * that an analyst counting non-empty answers can use one rule for both.
 */

export interface FlyingFleaFeedbackDraft {
  readonly testRideExperience: Rating1To7 | null
  readonly rotaryKnobUsage: Rating1To7 | null
  readonly rideModesExperience: Rating1To7 | null
  readonly overallExperienceRating: Rating1To7 | null
  readonly topThreeFeatures: string
  readonly overallExperienceComments: string
}

export const EMPTY_CAMPAIGN_DRAFT: FlyingFleaFeedbackDraft = {
  testRideExperience: null,
  rotaryKnobUsage: null,
  rideModesExperience: null,
  overallExperienceRating: null,
  topThreeFeatures: '',
  overallExperienceComments: '',
}

export type CampaignFeedbackErrors = Partial<
  Record<keyof FlyingFleaFeedbackDraft, string>
>

export type CampaignFeedbackResult =
  | { readonly ok: true; readonly answers: FlyingFleaFeedbackV1Answers }
  | { readonly ok: false; readonly errors: CampaignFeedbackErrors }

/** The rating keys, in the order the campaign asks them. */
export const RATING_KEYS = [
  'testRideExperience',
  'rotaryKnobUsage',
  'rideModesExperience',
  'overallExperienceRating',
] as const

export type RatingKey = (typeof RATING_KEYS)[number]

export { FLYING_FLEA_FORM_VERSION }

/**
 * Validates a draft and produces the answers to persist.
 *
 * The rating check is `isRating1To7` rather than a null check, so a value that
 * somehow arrived as 2.5 or 8 (a future control, a restored draft, a bug) is
 * refused here instead of becoming an average nobody can explain.
 */
export function validateCampaignFeedback(
  draft: FlyingFleaFeedbackDraft,
): CampaignFeedbackResult {
  const errors: CampaignFeedbackErrors = {}

  for (const key of RATING_KEYS) {
    if (!isRating1To7(draft[key])) {
      errors[key] = 'Choose a rating from 1 to 7.'
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }

  const text = (value: string): string | undefined => {
    const trimmed = value.trim()
    return trimmed.length === 0
      ? undefined
      : trimmed.slice(0, MAX_CAMPAIGN_TEXT_LENGTH)
  }

  const topThreeFeatures = text(draft.topThreeFeatures)
  const overallExperienceComments = text(draft.overallExperienceComments)

  return {
    ok: true,
    answers: {
      testRideExperience: draft.testRideExperience as Rating1To7,
      rotaryKnobUsage: draft.rotaryKnobUsage as Rating1To7,
      rideModesExperience: draft.rideModesExperience as Rating1To7,
      overallExperienceRating: draft.overallExperienceRating as Rating1To7,
      ...(topThreeFeatures === undefined ? {} : { topThreeFeatures }),
      ...(overallExperienceComments === undefined
        ? {}
        : { overallExperienceComments }),
    },
  }
}

/** The campaign's rating questions, paired with their draft keys. */
export const RATING_QUESTIONS = FLYING_FLEA_CAMPAIGN.ratingQuestions.map(
  (question) => ({
    key: question.key as RatingKey,
    prompt: question.prompt,
  }),
)

/** The campaign's free-text questions, paired with their draft keys. */
export const TEXT_QUESTIONS = FLYING_FLEA_CAMPAIGN.textQuestions.map(
  (question) => ({
    key: question.key as 'topThreeFeatures' | 'overallExperienceComments',
    prompt: question.prompt,
  }),
)
