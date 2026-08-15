import { describe, expect, it } from 'vitest'
import {
  FLYING_FLEA_QUESTIONS,
  FLYING_FLEA_RATING_KEYS,
  promptForAnswerKey,
} from '../../../../shared/campaign/flyingFlea'
import { flyingFleaFeedbackAnswersSchema } from '../../../../shared/sync/protocol'
import { FLYING_FLEA_CAMPAIGN } from './config'
import { RATING_QUESTIONS, TEXT_QUESTIONS } from './feedbackForm'

/*
 * One questionnaire, one definition.
 *
 * These tests deliberately do NOT compare two hardcoded copies of the six
 * prompts against each other; that would pass happily while both copies drifted
 * away from what the campaign actually asked. They assert identity: the objects
 * the browser renders are the objects `shared/campaign/flyingFlea.ts` exports,
 * so a copy cannot exist to drift.
 *
 * The reporting side imports the same module (`server/reporting/campaign.ts` is
 * a re-export of it), which the server suites exercise against real data.
 */

describe('the campaign screens render the shared questionnaire', () => {
  it('renders the shared question objects themselves, not a copy', () => {
    const rendered = [
      ...FLYING_FLEA_CAMPAIGN.ratingQuestions,
      ...FLYING_FLEA_CAMPAIGN.textQuestions,
    ]

    expect(rendered).toHaveLength(FLYING_FLEA_QUESTIONS.length)

    // Reference equality: same object, therefore necessarily the same wording.
    for (const [index, question] of rendered.entries()) {
      expect(question).toBe(FLYING_FLEA_QUESTIONS[index])
    }
  })

  it('drives the Point B form from the same objects', () => {
    const asked = [...RATING_QUESTIONS, ...TEXT_QUESTIONS]

    expect(asked.map((question) => question.key)).toEqual(
      FLYING_FLEA_QUESTIONS.map((question) => question.key),
    )
    for (const question of asked) {
      expect(question.prompt).toBe(promptForAnswerKey(question.key))
    }
  })

  it('uses the same answer keys in the form, the schema and the scale', () => {
    /*
     * The keys a rider's answers are stored under have to be the keys the wire
     * schema validates and the keys reporting averages. Derived from the shared
     * definition on both sides rather than listed here.
     */
    const schemaKeys = Object.keys(flyingFleaFeedbackAnswersSchema.shape).sort()
    const questionKeys = FLYING_FLEA_QUESTIONS.map(
      (question) => question.key,
    ).sort()

    expect(schemaKeys).toEqual(questionKeys)

    for (const key of FLYING_FLEA_RATING_KEYS) {
      expect(RATING_QUESTIONS.some((question) => question.key === key)).toBe(true)
    }
  })

  it('keeps presentation config out of the shared definition', () => {
    // Vehicles, the venue and hero copy change without changing what any stored
    // answer means, so they stay client-side.
    const sharedExports = Object.keys(FLYING_FLEA_QUESTIONS[0] ?? {})

    expect(sharedExports).toEqual(['key', 'prompt', 'kind'])
    expect(FLYING_FLEA_CAMPAIGN.vehicles.length).toBeGreaterThan(0)
    expect(FLYING_FLEA_CAMPAIGN.lockedLocation.length).toBeGreaterThan(0)
  })

  it('pins the form version that every reader branches on', () => {
    // A change here is a new questionnaire, never an edit: stored answers mean
    // what this version says they mean, permanently.
    expect(FLYING_FLEA_CAMPAIGN.formVersion).toBe('flying-flea-feedback-v1')
  })
})
