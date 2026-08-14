import { describe, expect, it } from 'vitest'
import {
  computeAnalytics,
  computeCampaignAnalytics,
  computeCoverage,
  FLYING_FLEA_FORM_VERSION,
  SUPPORTED_FORM_VERSION,
  type AnalysableResponse,
} from './analytics'
import { FLYING_FLEA_QUESTIONS } from './campaign'
import type { RunDescriptor } from './types'

function response(
  answers: Record<string, unknown>,
  formVersion = SUPPORTED_FORM_VERSION,
): AnalysableResponse {
  return { formVersion, answers }
}

function run(counts: Partial<RunDescriptor['counts']>): RunDescriptor {
  return {
    runId: '00000000-0000-4000-8000-000000000000',
    eventId: 'evt-test',
    engineVersion: 'reconciliation-v1',
    startedAt: '2026-01-01T11:59:00.000Z',
    completedAt: '2026-01-01T12:00:00.000Z',
    counts: {
      registrationCount: 0,
      feedbackCount: 0,
      matchedRegistrations: 0,
      registrationsWithoutFeedback: 0,
      registrationsWithMultipleFeedback: 0,
      matchedFeedback: 0,
      feedbackWithoutRegistration: 0,
      feedbackIdentityConflicts: 0,
      feedbackInMultipleGroups: 0,
      duplicateRegistrationCandidateCount: 0,
      ...counts,
    },
  }
}

describe('computeAnalytics', () => {
  it('averages ratings and reports the sample it used', () => {
    const analytics = computeAnalytics([
      response({ overall_rating: 5, experience: 'excellent', recommend: true }),
      response({ overall_rating: 4, experience: 'good', recommend: true }),
      response({ overall_rating: 3, experience: 'okay', recommend: false }),
    ])

    expect(analytics.analysedResponses).toBe(3)
    expect(analytics.averageOverallRating).toBe(4)
    expect(analytics.ratingCounts).toEqual({ '1': 0, '2': 0, '3': 1, '4': 1, '5': 1 })
    expect(analytics.experienceCounts.excellent).toBe(1)
    expect(analytics.recommendYes).toBe(2)
    expect(analytics.recommendNo).toBe(1)
    expect(analytics.recommendPercentage).toBe(66.7)
  })

  it('reports nulls rather than zero when nothing was measurable', () => {
    const analytics = computeAnalytics([])

    // Zero would read as "the average rating is 0", which is not a possible
    // answer to a 1-5 question.
    expect(analytics.averageOverallRating).toBeNull()
    expect(analytics.recommendPercentage).toBeNull()
    expect(analytics.analysedResponses).toBe(0)
  })

  it('skips and counts responses on an unknown form version', () => {
    const analytics = computeAnalytics([
      response({ overall_rating: 5 }),
      response({ overall_rating: 1 }, 'feedback-v2'),
    ])

    expect(analytics.analysedResponses).toBe(1)
    expect(analytics.unreadableFormVersions).toBe(1)
    // The v2 response must not drag the average down: its scale is unknown.
    expect(analytics.averageOverallRating).toBe(5)
  })

  it('ignores a non-integer rating rather than inventing a bucket for it', () => {
    const analytics = computeAnalytics([
      response({ overall_rating: 5 }),
      // In range, but not a possible answer to a 1-5 question. Counting it would
      // both move the average and create a "2.5" key in the distribution.
      response({ overall_rating: 2.5 }),
      response({ overall_rating: 4.999999 }),
    ])

    expect(analytics.averageOverallRating).toBe(5)
    expect(analytics.ratingCounts).toEqual({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 1 })
    expect(Object.keys(analytics.ratingCounts)).toEqual(['1', '2', '3', '4', '5'])
    // The responses are still counted as analysed: they were readable v1
    // responses, they simply carried no usable rating.
    expect(analytics.analysedResponses).toBe(3)
  })

  it('ignores answers outside the questionnaire domain', () => {
    const analytics = computeAnalytics([
      response({ overall_rating: 9, experience: 'sublime', recommend: 'yes' }),
    ])

    expect(analytics.analysedResponses).toBe(1)
    expect(analytics.averageOverallRating).toBeNull()
    expect(analytics.experienceCounts).toEqual({
      very_poor: 0,
      poor: 0,
      okay: 0,
      good: 0,
      excellent: 0,
    })
    expect(analytics.recommendYes).toBe(0)
    expect(analytics.recommendNo).toBe(0)
  })
})

describe('computeCoverage', () => {
  it('counts participants who responded at all, including ambiguous ones', () => {
    const coverage = computeCoverage(
      run({
        registrationCount: 10,
        matchedRegistrations: 6,
        registrationsWithMultipleFeedback: 2,
        registrationsWithoutFeedback: 2,
      }),
    )

    // 8 of 10 responded; only 6 of them can be analysed. Two different numbers,
    // deliberately.
    expect(coverage.registrationsWithFeedback).toBe(8)
    expect(coverage.totalRegistrations).toBe(10)
    expect(coverage.percentage).toBe(80)
  })

  it('reports null rather than dividing by zero', () => {
    expect(computeCoverage(run({ registrationCount: 0 })).percentage).toBeNull()
  })
})

describe('computeCampaignAnalytics', () => {
  function campaignResponse(
    answers: Record<string, unknown>,
    formVersion = FLYING_FLEA_FORM_VERSION,
  ): AnalysableResponse {
    return { formVersion, answers }
  }

  const complete = {
    testRideExperience: 7,
    rotaryKnobUsage: 6,
    rideModesExperience: 5,
    overallExperienceRating: 7,
    topThreeFeatures: 'Torque',
    overallExperienceComments: 'Brilliant',
  }

  function ratingFor(
    analytics: ReturnType<typeof computeCampaignAnalytics>,
    key: string,
  ) {
    const summary = analytics.ratings.find((rating) => rating.key === key)
    expect(summary).toBeDefined()
    return summary as NonNullable<typeof summary>
  }

  it('averages each question separately and reports its distribution', () => {
    const analytics = computeCampaignAnalytics(
      [
        campaignResponse(complete),
        campaignResponse({ ...complete, testRideExperience: 5 }),
      ],
      FLYING_FLEA_QUESTIONS,
    )

    expect(analytics.analysedResponses).toBe(2)
    expect(ratingFor(analytics, 'testRideExperience').average).toBe(6)
    expect(ratingFor(analytics, 'testRideExperience').distribution[7]).toBe(1)
    expect(ratingFor(analytics, 'testRideExperience').distribution[5]).toBe(1)
    expect(ratingFor(analytics, 'rotaryKnobUsage').average).toBe(6)
  })

  it('quotes the campaign question, never the machine key', () => {
    const analytics = computeCampaignAnalytics(
      [campaignResponse(complete)],
      FLYING_FLEA_QUESTIONS,
    )

    expect(ratingFor(analytics, 'rotaryKnobUsage').prompt).toBe(
      'How do you rate usage of the rotary knob for changing modes?',
    )
  })

  it('never reads a feedback-v1 response as a campaign one', () => {
    /*
     * The failure this prevents: a 1-5 `overall_rating` counted as if it were a
     * 1-7 campaign answer, dragging every campaign average down by an amount
     * nothing on the screen would explain.
     */
    const analytics = computeCampaignAnalytics(
      [
        campaignResponse(complete),
        campaignResponse(
          { overall_rating: 1, experience: 'very_poor', recommend: false },
          'feedback-v1',
        ),
      ],
      FLYING_FLEA_QUESTIONS,
    )

    expect(analytics.analysedResponses).toBe(1)
    expect(analytics.unreadableFormVersions).toBe(1)
    expect(ratingFor(analytics, 'overallExperienceRating').average).toBe(7)
  })

  it('excludes a rating that is not a whole number from 1 to 7', () => {
    const analytics = computeCampaignAnalytics(
      [
        campaignResponse(complete),
        campaignResponse({ ...complete, testRideExperience: 8 }),
        campaignResponse({ ...complete, testRideExperience: 3.5 }),
      ],
      FLYING_FLEA_QUESTIONS,
    )

    const rating = ratingFor(analytics, 'testRideExperience')
    // All three responses are analysed; only one carried a usable answer to
    // this question, and the average says so.
    expect(analytics.analysedResponses).toBe(3)
    expect(rating.responses).toBe(1)
    expect(rating.average).toBe(7)
    expect(Object.values(rating.distribution).reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('reports null rather than zero when a question was never answered', () => {
    const analytics = computeCampaignAnalytics([], FLYING_FLEA_QUESTIONS)

    for (const rating of analytics.ratings) {
      // Zero would read as "riders rated it 0", which is not on the scale.
      expect(rating.average).toBeNull()
      expect(rating.responses).toBe(0)
    }
  })

  it('counts how many riders wrote anything, per free-text question', () => {
    const analytics = computeCampaignAnalytics(
      [
        campaignResponse(complete),
        campaignResponse({ ...complete, topThreeFeatures: '   ' }),
        campaignResponse({
          testRideExperience: 4,
          rotaryKnobUsage: 4,
          rideModesExperience: 4,
          overallExperienceRating: 4,
        }),
      ],
      FLYING_FLEA_QUESTIONS,
    )

    // Whitespace is not an answer, and an absent field certainly is not.
    expect(analytics.textAnswers.topThreeFeatures).toBe(1)
    expect(analytics.textAnswers.overallExperienceComments).toBe(2)
  })
})

describe('reporting quotes the shared questionnaire', () => {
  it('renders the shared question objects, not a server-side copy', () => {
    /*
     * `server/reporting/campaign.ts` is a re-export of
     * `shared/campaign/flyingFlea.ts`. Asserting identity rather than equality
     * is what makes a divergent copy impossible: a second array would fail here
     * even if somebody kept both in step by hand today.
     */
    const analytics = computeCampaignAnalytics(
      [
        {
          formVersion: FLYING_FLEA_FORM_VERSION,
          answers: {
            testRideExperience: 7,
            rotaryKnobUsage: 6,
            rideModesExperience: 5,
            overallExperienceRating: 7,
          },
        },
      ],
      FLYING_FLEA_QUESTIONS,
    )

    for (const rating of analytics.ratings) {
      const shared = FLYING_FLEA_QUESTIONS.find(
        (question) => question.key === rating.key,
      )
      expect(shared).toBeDefined()
      expect(rating.prompt).toBe(shared?.prompt)
    }
  })
})
