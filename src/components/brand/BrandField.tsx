import { useId, type ReactNode } from 'react'

/*
 * A labelled campaign field.
 *
 * The styling in the supplied design is heavy, uppercase, letter-spaced, muted,
 * and it would be easy to render it as a styled `<div>`. This deliberately
 * does not: it emits a real `<label for>`, wires `aria-describedby` to the error
 * and hint, and sets `aria-invalid`, so the field stays operable by keyboard and
 * announceable by a screen reader. Brand styling changes what a control looks
 * like, never what it is.
 *
 * The control is passed as a render prop rather than as children so it cannot be
 * rendered without the id the label points at.
 */

interface BrandFieldProps {
  readonly label: string
  readonly required?: boolean
  readonly error?: string | undefined
  readonly hint?: string | undefined
  readonly children: (props: {
    readonly id: string
    readonly 'aria-invalid': boolean
    readonly 'aria-describedby': string | undefined
    readonly className: string
  }) => ReactNode
}

export function BrandField({
  label,
  required = false,
  error,
  hint,
  children,
}: BrandFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  const describedBy = [
    error === undefined ? '' : errorId,
    hint === undefined ? '' : hintId,
  ]
    .filter((value) => value.length > 0)
    .join(' ')

  return (
    <div className="ff-field">
      <label className="ff-field__label" htmlFor={id}>
        {label}
        {required && (
          <>
            {' '}
            <span className="ff-field__required" aria-hidden="true">
              *
            </span>
            <span className="visually-hidden"> (required)</span>
          </>
        )}
      </label>

      {children({
        id,
        'aria-invalid': error !== undefined,
        'aria-describedby': describedBy.length === 0 ? undefined : describedBy,
        className: `ff-field__control${error === undefined ? '' : ' ff-field__control--invalid'}`,
      })}

      {hint !== undefined && (
        <p id={hintId} className="ff-field__hint">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="ff-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
