import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react'
import {
  validateRegistrationForm,
  type RegistrationFieldErrors,
  type RegistrationFormValues,
} from './validation'

const EMPTY: RegistrationFormValues = { name: '', phone: '', email: '' }

interface RegistrationFormProps {
  readonly onSubmit: (values: RegistrationFormValues) => void
  readonly busy: boolean
  /** Changing this resets the fields and returns focus to Name. */
  readonly resetKey: number
  readonly submitLabel?: string
  readonly initialValues?: RegistrationFormValues
}

/**
 * The participant details form.
 *
 * Built for someone doing this several hundred times with a queue in front of
 * them: Name is focused on arrival, tab order runs straight down the fields to
 * the button, and Enter from any field submits. The mouse is optional.
 *
 * Validation runs on submit rather than on every keystroke — errors that appear
 * while someone is still typing their address are noise — and a failed
 * submission never clears the other fields.
 */
export function RegistrationForm({
  onSubmit,
  busy,
  resetKey,
  submitLabel = 'Register & Print',
  initialValues = EMPTY,
}: RegistrationFormProps) {
  const [values, setValues] = useState<RegistrationFormValues>(initialValues)
  const [errors, setErrors] = useState<RegistrationFieldErrors>({})
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValues(initialValues)
    setErrors({})
    nameRef.current?.focus()
    // Keyed on resetKey alone on purpose: a new participant clears the desk,
    // and re-running whenever the initialValues object identity changed would
    // fight the operator's typing.
  }, [resetKey])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) {
      return
    }

    const result = validateRegistrationForm(values)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    onSubmit(result.values)
  }

  function update(field: keyof RegistrationFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  return (
    <form className="registration-form" onSubmit={handleSubmit} noValidate>
      <Field
        id="registration-name"
        label="Name"
        value={values.name}
        error={errors.name}
        onChange={(value) => update('name', value)}
        inputRef={nameRef}
        autoComplete="off"
        autoFocus
      />
      <Field
        id="registration-phone"
        label="Phone number"
        type="tel"
        value={values.phone}
        error={errors.phone}
        onChange={(value) => update('phone', value)}
        autoComplete="off"
      />
      <Field
        id="registration-email"
        label="Email address"
        type="email"
        value={values.email}
        error={errors.email}
        onChange={(value) => update('email', value)}
        autoComplete="off"
      />

      <button type="submit" className="button button--primary" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

interface FieldProps {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly error: string | undefined
  readonly onChange: (value: string) => void
  readonly type?: string
  readonly autoComplete?: string
  readonly autoFocus?: boolean
  readonly inputRef?: RefObject<HTMLInputElement | null>
}

function Field({
  id,
  label,
  value,
  error,
  onChange,
  type = 'text',
  autoComplete,
  autoFocus,
  inputRef,
}: FieldProps) {
  const errorId = `${id}-error`

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        className={error === undefined ? 'field__input' : 'field__input field__input--invalid'}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
      />
      {error !== undefined && (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
