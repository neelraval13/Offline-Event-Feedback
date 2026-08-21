import { useId, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/ui/cn'

/*
 * A labelled control, with its hint and its error.
 *
 * Wires up the accessibility that is tedious to repeat and easy to get wrong:
 * the label points at the control, the hint and the error are referenced by
 * `aria-describedby`, and an invalid control is marked `aria-invalid` so it
 * picks up the error styling from the primitive without the caller adding a
 * class.
 *
 * The render-prop shape is deliberate. The alternative, a `FormField` that
 * renders the input itself, needs a prop for every input type and every
 * attribute any caller might want; this hands the caller the wired-up ids and
 * gets out of the way, which is what lets Point A's numeric cluster and a
 * plain text field use the same wrapper.
 *
 * Errors sit below the control and are announced. Errors that appear while
 * somebody is still typing are noise at a desk, so validation timing stays the
 * caller's decision.
 */

interface FieldParts {
  readonly id: string
  readonly 'aria-describedby': string | undefined
  readonly 'aria-invalid': true | undefined
  readonly required: boolean
}

interface FormFieldProps {
  readonly label: ReactNode
  /** Guidance shown before the operator makes a mistake. */
  readonly hint?: ReactNode
  /** Present only after validation has actually failed. */
  readonly error?: string | undefined
  readonly required?: boolean
  readonly className?: string
  readonly children: (field: FieldParts) => ReactNode
}

export function FormField({
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: FormFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  const describedBy =
    [hint === undefined ? null : hintId, error === undefined ? null : errorId]
      .filter((value): value is string => value !== null)
      .join(' ') || undefined

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-accent">
            *
          </span>
        )}
        {/* The asterisk is decoration; this is what is announced. */}
        {required && <span className="sr-only"> (required)</span>}
      </Label>

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error === undefined ? undefined : true,
        required,
      })}

      {hint !== undefined && (
        <p id={hintId} className="font-body text-small text-faint">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} role="alert" className="font-ui text-small font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
