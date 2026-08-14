/*
 * `flying-flea-feedback-v1`: the questionnaire itself.
 *
 * This module owns everything about the campaign questionnaire that must mean
 * the same thing on a tablet, on the server and in an export: the version
 * string, the stable answer keys, the exact question wording, and the scale.
 *
 * It lives in `shared/` for the same reason the sync protocol does. The wording
 * was previously written out twice, once in the client's campaign config and
 * once in the server's reporting module, and two copies of a question is one
 * question that will eventually disagree with itself. When that happens the
 * disagreement is invisible: a report quotes a prompt the rider never saw, and
 * nothing fails.
 *
 * ## What belongs here, and what does not
 *
 * Here: the immutable semantics of the questionnaire. Anything a reader of a
 * stored answer needs in order to know what was asked.
 *
 * Not here: vehicles, venues, colour swatches, hero copy, layout. Those are
 * presentation and deployment configuration, they change without changing the
 * meaning of a single stored answer, and they stay in
 * `src/features/campaign/flying-flea/config.ts`.
 *
 * No React, no DOM, no browser or Node API. This module is data and predicates.
 *
 * ## Versioning rule
 *
 * If a question's meaning changes, or its canonical wording has to change after
 * answers have been collected, that is a **new form version**: not an edit
 * here. A stored `flying-flea-feedback-v1` answer means what the prompt below
 * says it means, permanently. Rewriting this file would silently rewrite the
 * meaning of every response already in the database.
 */

export const FLYING_FLEA_FORM_VERSION = 'flying-flea-feedback-v1'

export type FlyingFleaFormVersion = typeof FLYING_FLEA_FORM_VERSION

/** The scale every campaign rating question uses. Integers, 1 to 7 inclusive. */
export const RATINGS_1_TO_7 = [1, 2, 3, 4, 5, 6, 7] as const

export type Rating1To7 = (typeof RATINGS_1_TO_7)[number]

export function isRating1To7(value: unknown): value is Rating1To7 {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 7
  )
}

/**
 * Storage bound for a free-text answer.
 *
 * Not part of the question. It exists so a stuck key or a paste cannot produce a
 * record too large to sync, and the visible question is unchanged by it.
 */
export const MAX_CAMPAIGN_TEXT_LENGTH = 2000

export interface CampaignQuestion {
  /** The stored answer key. Stable forever; never a position or an index. */
  readonly key: string
  /** The rider-visible wording, verbatim from the campaign. */
  readonly prompt: string
  readonly kind: 'rating' | 'text'
}

/**
 * The six questions, in the order the campaign asks them.
 *
 * Wording is reproduced exactly from the supplied campaign package
 * (`google-hosted/Index.html`), including its capitalisation and punctuation.
 */
export const FLYING_FLEA_QUESTIONS = [
  {
    key: 'testRideExperience',
    prompt: 'How was your test ride experience of Flying Flea motorcycle?',
    kind: 'rating',
  },
  {
    key: 'rotaryKnobUsage',
    prompt: 'How do you rate usage of the rotary knob for changing modes?',
    kind: 'rating',
  },
  {
    key: 'rideModesExperience',
    prompt: 'How do you rate the ride experience in different ride modes?',
    kind: 'rating',
  },
  {
    key: 'overallExperienceRating',
    prompt: 'How would you rate your overall experience?',
    kind: 'rating',
  },
  {
    key: 'topThreeFeatures',
    prompt: 'Which top 3 features did you like in the motorcycle?',
    kind: 'text',
  },
  {
    key: 'overallExperienceComments',
    prompt: 'How was your overall experience of the Flying Flea motorcycle?',
    kind: 'text',
  },
] as const satisfies readonly CampaignQuestion[]

export const FLYING_FLEA_RATING_QUESTIONS = FLYING_FLEA_QUESTIONS.filter(
  (question) => question.kind === 'rating',
)

export const FLYING_FLEA_TEXT_QUESTIONS = FLYING_FLEA_QUESTIONS.filter(
  (question) => question.kind === 'text',
)

export const FLYING_FLEA_RATING_KEYS = FLYING_FLEA_RATING_QUESTIONS.map(
  (question) => question.key,
)

export const FLYING_FLEA_TEXT_KEYS = FLYING_FLEA_TEXT_QUESTIONS.map(
  (question) => question.key,
)

/** Answers to `flying-flea-feedback-v1`. */
export interface FlyingFleaFeedbackV1Answers {
  readonly testRideExperience: Rating1To7
  readonly rotaryKnobUsage: Rating1To7
  readonly rideModesExperience: Rating1To7
  readonly overallExperienceRating: Rating1To7
  /**
   * Absent rather than empty when the rider wrote nothing, so "said nothing"
   * and "typed spaces" do not become different data.
   */
  readonly topThreeFeatures?: string
  readonly overallExperienceComments?: string
}

/** The canonical wording for a stored answer key, or null if it is not ours. */
export function promptForAnswerKey(key: string): string | null {
  return FLYING_FLEA_QUESTIONS.find((question) => question.key === key)?.prompt ?? null
}

/* ------------------------------------------------------------------ *
 * The colours and genders the campaign form offers
 *
 * These are stored values rather than presentation: an export column holds
 * `Storm Black`, and a validator has to know which strings are answers to the
 * question and which are not. The swatch that renders beside them is
 * presentation and stays client-side.
 * ------------------------------------------------------------------ */

export const FLYING_FLEA_COLOURS = ['Flea Green', 'Storm Black'] as const

export type FlyingFleaColour = (typeof FLYING_FLEA_COLOURS)[number]

export function isFlyingFleaColour(value: unknown): value is FlyingFleaColour {
  return (
    typeof value === 'string' &&
    (FLYING_FLEA_COLOURS as readonly string[]).includes(value)
  )
}

export const FLYING_FLEA_GENDERS = ['Male', 'Female', 'Others'] as const

export type FlyingFleaGender = (typeof FLYING_FLEA_GENDERS)[number]

export function isFlyingFleaGender(value: unknown): value is FlyingFleaGender {
  return (
    typeof value === 'string' &&
    (FLYING_FLEA_GENDERS as readonly string[]).includes(value)
  )
}

/* ------------------------------------------------------------------ *
 * Campaign registration field constraints
 *
 * Shared because three independent readers enforce them (the campaign form, the
 * sync wire schema and the backup validator), and a bound that disagrees between
 * them is a record one layer accepts and another refuses.
 * ------------------------------------------------------------------ */

export const MAX_VEHICLE_LENGTH = 64
export const MAX_LOCATION_LENGTH = 120
export const MAX_LICENCE_LENGTH = 64
export const MAX_PINCODE_LENGTH = 16

/** Six digits, as the campaign's own control accepts. */
const PINCODE_PATTERN = /^\d{6}$/

export function isCampaignPincode(value: unknown): value is string {
  return typeof value === 'string' && PINCODE_PATTERN.test(value)
}

/**
 * The local wall-clock form a `datetime-local` control produces.
 *
 * Deliberately not an instant: a test-ride slot is a wall-clock time at a venue,
 * and storing it as UTC would move a 10:00 booking in every export read outside
 * the venue's timezone.
 */
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

export function isLocalDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || !LOCAL_DATE_TIME_PATTERN.test(value)) {
    return false
  }

  // The shape is right; check it is also a real moment (no 2026-02-31T25:00).
  const parsed = new Date(`${value}:00Z`)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 16) === value
  )
}
