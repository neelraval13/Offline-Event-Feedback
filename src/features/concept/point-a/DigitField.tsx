import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/ui/cn'

/*
 * A fixed-length number: the phone number and the pincode.
 *
 * ## What is kept from V1's instrument cluster, and what is not
 *
 * V1 renders these two fields as the campaign's circular dial: a round pod with
 * a sweeping teal arc, the digits shown as individual slots, an `n / len`
 * readout, and a three-column keypad, driven by a transparent real input laid
 * over the top. Its own comment is candid that the keypad is decoration with a
 * real field underneath, kept for the look rather than for speed.
 *
 * The genuinely useful part of that control is the readout: an operator can see
 * without counting that seven of ten digits are in, and a half-typed phone
 * number is the most common thing wrong with a registration. That part is kept.
 *
 * The pod and the keypad are not. Two circular dials are the single largest
 * block of vertical space on the existing form, roughly a third of step 03 for
 * two fields out of six, and the keypad they carry is a slower way to do what
 * the tablet's own numeric keyboard already does. On a terminal an operator
 * uses several hundred times a shift, that space is scrolling, and scrolling is
 * the cost paid per rider.
 *
 * So this is a normal-height field that still counts itself: digits tracked
 * apart so they read in groups, and a live `n / len` on the right.
 *
 * ## What does not change
 *
 * `type="text"` with `inputMode="numeric"`, never `type="number"`: a number
 * input strips the leading zero off a pincode and adds spinners nobody wants on
 * a phone number. Paste, autofill and the tablet's numeric keyboard all work
 * natively, exactly as they already do. The value is a plain digit string.
 *
 * This is a concept: it holds no validation rules of its own, and the real
 * field's normalising and validation behaviour is unchanged and untouched.
 */

interface DigitFieldProps {
  readonly label: string
  readonly value: string
  readonly onChange: (digits: string) => void
  /** How many digits the number has. Phone is 10, pincode is 6. */
  readonly length: number
  readonly required?: boolean
  readonly error?: string | undefined
  readonly disabled?: boolean
  readonly autoComplete?: string
}

export function DigitField({
  label,
  value,
  onChange,
  length,
  required = false,
  error,
  disabled = false,
  autoComplete,
}: DigitFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const countId = `${id}-count`
  const complete = value.length === length

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-accent">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </Label>

      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          /* Digits only, for browsers that honour it on soft keyboards. */
          pattern="[0-9]*"
          maxLength={length}
          value={value}
          disabled={disabled}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? countId : `${countId} ${errorId}`}
          {...(autoComplete === undefined ? {} : { autoComplete })}
          onChange={(event) =>
            onChange(event.target.value.replace(/\D/g, '').slice(0, length))
          }
          className={cn(
            'flex min-h-touch w-full rounded-control border border-line bg-field',
            // Room on the right for the counter, which sits over the field.
            'py-2 pr-16 pl-3.5',
            'font-mono text-base tabular-nums tracking-[0.28em] text-ink',
            'transition-[border-color,box-shadow] duration-150',
            'hover:border-line-strong',
            'focus-visible:border-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive/40',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/25',
          )}
        />

        {/*
          The readout. Announced, because "how many digits have I typed" is a
          question a screen-reader user has exactly as often as anyone else.
        */}
        <span
          id={countId}
          className={cn(
            'pointer-events-none absolute inset-y-0 right-3.5 flex items-center',
            'font-mono text-small tabular-nums',
            complete ? 'text-ok' : 'text-faint',
          )}
        >
          {value.length} / {length}
        </span>
      </div>

      {error !== undefined && (
        <p id={errorId} role="alert" className="font-ui text-small font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
