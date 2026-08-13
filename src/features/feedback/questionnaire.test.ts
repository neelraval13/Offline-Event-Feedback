import { describe, expect, it } from 'vitest'
import {
  EMPTY_DRAFT,
  EXPERIENCE_OPTIONS,
  FEEDBACK_FORM_VERSION,
  isDraftComplete,
  RATING_OPTIONS,
  validateFeedbackDraft,
  type FeedbackDraft,
} from './questionnaire'
import { MAX_COMMENTS_LENGTH } from '../../types'

const COMPLETE: FeedbackDraft = {
  overall_rating: 4,
  experience: 'good',
  recommend: true,
  comments: '',
}

describe('feedback-v1 definition', () => {
  it('is version feedback-v1', () => {
    expect(FEEDBACK_FORM_VERSION).toBe('feedback-v1')
  })

  it('offers ratings 1 to 5', () => {
    expect([...RATING_OPTIONS]).toEqual([1, 2, 3, 4, 5])
  })

  it('offers the five experience values with their visible labels', () => {
    expect(EXPERIENCE_OPTIONS.map((option) => option.value)).toEqual([
      'very_poor',
      'poor',
      'okay',
      'good',
      'excellent',
    ])
    expect(EXPERIENCE_OPTIONS.map((option) => option.label)).toEqual([
      'Very Poor',
      'Poor',
      'Okay',
      'Good',
      'Excellent',
    ])
  })

  it('asks exactly four questions', () => {
    expect(Object.keys(EMPTY_DRAFT).sort()).toEqual([
      'comments',
      'experience',
      'overall_rating',
      'recommend',
    ])
  })
})

describe('required answers', () => {
  it('rejects an untouched form', () => {
    const result = validateFeedbackDraft(EMPTY_DRAFT)

    expect(result.ok).toBe(false)
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual([
      'experience',
      'overall_rating',
      'recommend',
    ])
  })

  it('requires overall_rating', () => {
    const result = validateFeedbackDraft({ ...COMPLETE, overall_rating: null })
    expect(!result.ok && result.errors.overall_rating).toBeDefined()
  })

  it('requires experience', () => {
    const result = validateFeedbackDraft({ ...COMPLETE, experience: null })
    expect(!result.ok && result.errors.experience).toBeDefined()
  })

  it('requires recommend', () => {
    const result = validateFeedbackDraft({ ...COMPLETE, recommend: null })
    expect(!result.ok && result.errors.recommend).toBeDefined()
  })

  it('accepts recommend = false as an answer, not as missing', () => {
    const result = validateFeedbackDraft({ ...COMPLETE, recommend: false })
    expect(result.ok).toBe(true)
    expect(result.ok && result.answers.recommend).toBe(false)
  })

  it('treats comments as optional', () => {
    expect(isDraftComplete(COMPLETE)).toBe(true)
  })
})

describe('canonical persisted values', () => {
  it('stores the machine values, not the visible labels', () => {
    const result = validateFeedbackDraft({
      overall_rating: 5,
      experience: 'very_poor',
      recommend: false,
      comments: 'Mixed feelings',
    })

    expect(result.ok && result.answers).toEqual({
      overall_rating: 5,
      experience: 'very_poor',
      recommend: false,
      comments: 'Mixed feelings',
    })
  })

  it('accepts every rating and every experience value', () => {
    for (const rating of RATING_OPTIONS) {
      for (const option of EXPERIENCE_OPTIONS) {
        const result = validateFeedbackDraft({
          overall_rating: rating,
          experience: option.value,
          recommend: true,
          comments: '',
        })
        expect(result.ok && result.answers.overall_rating).toBe(rating)
        expect(result.ok && result.answers.experience).toBe(option.value)
      }
    }
  })
})

describe('comments', () => {
  it('trims surrounding whitespace', () => {
    const result = validateFeedbackDraft({
      ...COMPLETE,
      comments: '   Loved the timing.  \n',
    })

    expect(result.ok && result.answers.comments).toBe('Loved the timing.')
  })

  it('stores nothing at all when left blank', () => {
    const result = validateFeedbackDraft({ ...COMPLETE, comments: '' })

    expect(result.ok).toBe(true)
    expect(result.ok && 'comments' in result.answers).toBe(false)
  })

  it('stores nothing at all when only whitespace was typed', () => {
    // "said nothing" and "typed three spaces" must not become different data.
    const result = validateFeedbackDraft({ ...COMPLETE, comments: '   \n\t ' })

    expect(result.ok && 'comments' in result.answers).toBe(false)
  })

  it('accepts a comment at the maximum length', () => {
    const result = validateFeedbackDraft({
      ...COMPLETE,
      comments: 'x'.repeat(MAX_COMMENTS_LENGTH),
    })

    expect(result.ok).toBe(true)
  })

  it('rejects a comment beyond the maximum length', () => {
    const result = validateFeedbackDraft({
      ...COMPLETE,
      comments: 'x'.repeat(MAX_COMMENTS_LENGTH + 1),
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.errors.comments).toBeDefined()
  })

  it('measures length after trimming', () => {
    const result = validateFeedbackDraft({
      ...COMPLETE,
      comments: `  ${'x'.repeat(MAX_COMMENTS_LENGTH)}  `,
    })

    expect(result.ok).toBe(true)
  })
})
