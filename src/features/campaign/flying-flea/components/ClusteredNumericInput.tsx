import { useId, useRef, type ChangeEvent, type KeyboardEvent } from 'react'

/*
 * The campaign's numeric cluster: phone number and pincode.
 *
 * Reproduced from the reference's `.dial` / `.keypad` treatment: a round pod
 * with the digits shown as individual slots, a teal arc that sweeps as the
 * number fills, a `n / len` readout, and a three-column keypad. That is the
 * visual language of the C6's instrument cluster, and it is the most recognisable
 * control on the campaign's form.
 *
 * ## The one deliberate departure
 *
 * The reference's pod is keypad-ONLY: ten taps on rendered buttons, no keyboard,
 * no paste, no autofill. Point A is staff-operated with a rider waiting, and ten
 * taps where a keyboard would do one paste is the single slowest thing in the
 * reference design.
 *
 * So the pod is driven by a real, focusable `<input inputMode="numeric">` laid
 * transparently over it. Typing, pasting, backspace, autofill and a tablet's own
 * numeric keyboard all work natively; the rendered keypad stays for touch use
 * and for the look. The control LOOKS clustered and BEHAVES like a text field,
 * which is what §12 asks for.
 *
 * `type="text"` with `inputMode="numeric"`, never `type="number"`: a number
 * input strips leading zeros, fatal for a pincode, and adds spinners nobody
 * wants on a phone number.
 *
 * The value is a plain digit string. This component never changes what is
 * stored: the phone and pincode contracts are exactly what they were before it
 * existed.
 */

interface ClusteredNumericInputProps {
  readonly label: string
  readonly value: string
  readonly onChange: (digits: string) => void
  /** How many digits the number has. Phone is 10; pincode is 6. */
  readonly length: number
  readonly required?: boolean
  readonly error?: string | undefined
  readonly disabled?: boolean
  /** `tel` lets a browser offer the rider's own number. */
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

/** The reference's key order: 7-8-9 / 4-5-6 / 1-2-3 / (gap) 0 (backspace). */
const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '', '0', '⌫'] as const

export function ClusteredNumericInput({
  label,
  value,
  onChange,
  length,
  required = false,
  error,
  disabled = false,
  autoComplete,
  normalisePaste,
}: ClusteredNumericInputProps) {
  const id = useId()
  const errorId = `${id}-error`
  const inputRef = useRef<HTMLInputElement>(null)

  /** Digits only, never longer than the number is. */
  function accept(raw: string): void {
    onChange(raw.replace(/\D/g, '').slice(0, length))
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    accept(event.target.value)
  }

  /**
   * A paste, which is the whole reason this control is not keypad-only.
   *
   * Into an empty field, the caller's normaliser decides what the pasted text
   * means; that is where `+91 98765 43210` becomes ten digits. Into a field
   * that already holds digits the paste appends, because there the operator is
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

  function press(key: string): void {
    if (disabled) {
      return
    }

    if (key === '⌫') {
      onChange(value.slice(0, -1))
    } else if (value.length < length) {
      onChange(value + key)
    }

    // Keep the caret where the operator expects it after a tap.
    inputRef.current?.focus()
  }

  /*
   * The keypad buttons sit inside a form. Enter on one would submit the form
   * from a digit press, which at a registration desk means a half-typed
   * registration.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
    }
  }

  const slots = Array.from({ length }, (_, index) => value[index] ?? null)
  const progress = length === 0 ? 0 : value.length / length

  return (
    <div className="ff-cluster">
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

      <div
        className={`ff-dial${error === undefined ? '' : ' ff-dial--invalid'}`}
        /* The arc sweeps with completion, exactly as in the reference. */
        style={{ '--ff-dial-progress': progress } as React.CSSProperties}
      >
        <div className="ff-dial__face">
          <div className="ff-dial__arc" aria-hidden="true" />
          <div className="ff-dial__glass" aria-hidden="true" />

          {/*
            The real control. Transparent and full-bleed over the pod, so a tap
            anywhere on the cluster focuses it and raises the tablet's keyboard.
          */}
          <input
            ref={inputRef}
            id={id}
            className="ff-dial__input"
            type="text"
            inputMode="numeric"
            /* Digits only, for browsers that honour it on soft keyboards. */
            pattern="[0-9]*"
            maxLength={length}
            value={value}
            disabled={disabled}
            aria-invalid={error !== undefined}
            aria-describedby={error === undefined ? undefined : errorId}
            {...(autoComplete === undefined ? {} : { autoComplete })}
            onChange={handleChange}
            onPaste={(event) => {
              event.preventDefault()
              handlePaste(event.clipboardData.getData('text'))
            }}
          />

          <div className="ff-dial__digits" aria-hidden="true">
            {slots.map((digit, index) => (
              <span
                key={index}
                className={digit === null ? '' : 'ff-dial__digit--on'}
              >
                {digit ?? '·'}
              </span>
            ))}
          </div>

          <div className="ff-dial__count" aria-hidden="true">
            {value.length} / {length}
          </div>

          <div className="ff-dial__keypad">
            {KEYS.map((key, index) =>
              key === '' ? (
                <span key={index} className="ff-dial__key ff-dial__key--gap" />
              ) : (
                <button
                  key={index}
                  type="button"
                  className="ff-dial__key"
                  /* The input is the labelled control; these are a shortcut. */
                  tabIndex={-1}
                  aria-label={key === '⌫' ? `Delete last digit of ${label}` : key}
                  disabled={disabled}
                  onKeyDown={handleKeyDown}
                  onClick={() => press(key)}
                >
                  {key}
                </button>
              ),
            )}
          </div>
        </div>
      </div>

      {error !== undefined && (
        <p id={errorId} className="ff-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
