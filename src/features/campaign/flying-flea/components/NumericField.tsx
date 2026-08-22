import { useId, type ChangeEvent } from 'react'
import { Label } from '../../../../components/ui/label'
import { cn } from '../../../../lib/ui/cn'

/*
 * A fixed-length number: the phone number and the pincode.
 *
 * ## What this replaces, and what survived
 *
 * V1 rendered these two fields as the campaign's circular dial: a round pod with
 * a sweeping teal arc, the digits as individual slots, an `n / len` readout and
 * a three-column keypad, driven by a transparent real input laid over the top.
 * Its own comment was candid that the keypad was decoration with a real field
 * underneath, kept for the look rather than for speed.
 *
 * The useful half of that control was the readout. An operator can see without
 * counting that seven of ten digits are in, and a half-typed phone number is the
 * most common thing wrong with a registration. That is kept, as a live
 * `n / len` inside the field.
 *
 * The pod and the keypad are gone. Two circles were the largest block of
 * vertical space on the form, roughly a third of step 03 for two fields out of
 * six, and the keypad was a slower way to do what the tablet's own numeric
 * keyboard already does. On a terminal used several hundred times a shift that
 * space is scrolling, and scrolling is paid per rider.
 *
 * ## What did not change
 *
 * Everything about the input. `type="text"` with `inputMode="numeric"`, never
 * `type="number"`: a number input strips the leading zero off a pincode and adds
 * spinners nobody wants on a phone number. Paste, the caller's paste rule,
 * append-on-paste, autofill, backspace and the length cap all behave exactly as
 * they did; `NumericField.test.tsx` carries the same assertions the dial's suite
 * did. The value is still a plain digit string, and this component still never
 * decides what is stored.
 */

interface NumericFieldProps {
  readonly label: string
  readonly value: string
  readonly onChange: (digits: string) => void
  /** How many digits the number has. Phone is 10, pincode is 6. */
  readonly length: number
  readonly required?: boolean
  readonly error?: string | undefined
  readonly disabled?: boolean
  /** `tel-national` lets a browser offer the rider's own number. */
  readonly autoComplete?: string
  /**
   * Applied to pasted text before it reaches the field.
   *
   * The phone field passes a rule that recognises `+91` and a leading trunk
   * zero; the pincode passes nothing, because a six-digit postcode has no
   * prefixes to strip. Keeping it a prop stops one field's semantics leaking
   * into the other.
   */
  readonly normalisePaste?: ((pasted: string) => string) | undefined
}

export function NumericField({
  label,
  value,
  onChange,
  length,
  required = false,
  error,
  disabled = false,
  autoComplete,
  normalisePaste,
}: NumericFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const countId = `${id}-count`
  const complete = value.length === length

  /** Digits only, never longer than the number is. */
  function accept(raw: string): void {
    onChange(raw.replace(/\D/g, '').slice(0, length))
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    accept(event.target.value)
  }

  /**
   * A paste, which is the whole reason this was never keypad-only.
   *
   * Into an empty field, the caller's normaliser decides what the pasted text
   * means; that is where `+91 98765 43210` becomes ten digits. Into a field that
   * already holds digits the paste appends, because there the operator is
   * extending what they typed rather than replacing it, and a prefix rule would
   * be nonsense applied to a fragment.
   */
  function handlePaste(pasted: string): void {
    if (value.length === 0 && normalisePaste !== undefined) {
      accept(normalisePaste(pasted))
      return
    }

    accept(value + pasted)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ml-1 text-accent">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
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
          onChange={handleChange}
          onPaste={(event) => {
            event.preventDefault()
            handlePaste(event.clipboardData.getData('text'))
          }}
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
          The readout. Described by the input rather than hidden, because "how
          many digits have I typed" is a question a screen-reader user has
          exactly as often as anybody else.
        */}
        <span
          id={countId}
          data-testid="numeric-count"
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
