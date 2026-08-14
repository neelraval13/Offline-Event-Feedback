import { describe, expect, it } from 'vitest'
import {
  computeAnalytics,
  computeCoverage,
  SUPPORTED_FORM_VERSION,
  type AnalysableResponse,
} from './analytics'
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
