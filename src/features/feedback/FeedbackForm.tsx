import type { FormEvent } from 'react'
import { MAX_COMMENTS_LENGTH, type ExperienceValue, type OverallRating } from '../../types'
import {
  EXPERIENCE_OPTIONS,
  QUESTION_PROMPTS,
  RATING_OPTIONS,
  type FeedbackDraft,
  type FeedbackFieldErrors,
} from './questionnaire'

interface FeedbackFormProps {
  readonly draft: FeedbackDraft
  readonly errors: FeedbackFieldErrors
  readonly busy: boolean
  readonly onChange: (patch: Partial<FeedbackDraft>) => void
  readonly onSubmit: () => void
}

/*
 * The four questions of `feedback-v1`.
 *
 * A participant fills this in standing up, on someone else's tablet, in under a
 * minute. So the choices are large buttons rather than radio inputs — a native
 * radio is a 13px target, and this is the interaction the whole station exists
 * to collect. Selection state is carried by `aria-pressed`, so it survives for
 * screen readers and for tests without depending on colour.
 */
export function FeedbackForm({
  draft,
  errors,
  busy,
  onChange,
  onSubmit,
}: FeedbackFormProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!busy) {
      onSubmit()
    }
  }

  return (
    <form className="feedback-form" onSubmit={handleSubmit} noValidate>
      <fieldset className="question">
        <legend className="question__prompt">
          {QUESTION_PROMPTS.overall_rating}
        </legend>
        <div className="choice-row choice-row--rating">
          {RATING_OPTIONS.map((rating: OverallRating) => (
            <button
              key={rating}
              type="button"
              className="choice choice--rating"
              aria-pressed={draft.overall_rating === rating}
              onClick={() => onChange({ overall_rating: rating })}
            >
              {rating}
            </button>
          ))}
        </div>
        <FieldError message={errors.overall_rating} />
      </fieldset>

      <fieldset className="question">
        <legend className="question__prompt">
          {QUESTION_PROMPTS.experience}
        </legend>
        <div className="choice-row">
          {EXPERIENCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="choice"
              aria-pressed={draft.experience === option.value}
              onClick={() =>
                onChange({ experience: option.value satisfies ExperienceValue })
              }
            >
              {option.label}
            </button>
          ))}
        </div>
        <FieldError message={errors.experience} />
      </fieldset>

      <fieldset className="question">
        <legend className="question__prompt">
          {QUESTION_PROMPTS.recommend}
        </legend>
        <div className="choice-row">
          <button
            type="button"
            className="choice"
            aria-pressed={draft.recommend === true}
            onClick={() => onChange({ recommend: true })}
          >
            Yes
          </button>
          <button
            type="button"
            className="choice"
            aria-pressed={draft.recommend === false}
            onClick={() => onChange({ recommend: false })}
          >
            No
          </button>
        </div>
        <FieldError message={errors.recommend} />
      </fieldset>

      <div className="question">
        <label className="question__prompt" htmlFor="feedback-comments">
          {QUESTION_PROMPTS.comments}
        </label>
        <textarea
          id="feedback-comments"
          className="feedback-form__comments"
          rows={3}
          maxLength={MAX_COMMENTS_LENGTH}
          value={draft.comments}
          onChange={(event) => onChange({ comments: event.target.value })}
        />
        <FieldError message={errors.comments} />
      </div>

      <button type="submit" className="button button--primary" disabled={busy}>
        {busy ? 'Saving…' : 'Submit feedback'}
      </button>
    </form>
  )
}

function FieldError({ message }: { readonly message: string | undefined }) {
  if (message === undefined) {
    return null
  }
  return (
    <p className="field__error" role="alert">
      {message}
    </p>
  )
}
