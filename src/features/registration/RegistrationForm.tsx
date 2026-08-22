import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AppButton, FormField } from '../../components/design-system'
import { Input } from '../../components/ui/input'
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
 * The generic contact-details form.
 *
 * Now reached on one path only: correcting a registration captured before this
 * campaign existed. Such a record has no vehicle, no colour and no venue,
 * because nobody was asked, and correcting it through the campaign form would
 * demand all three and default the colour, so an operator fixing a typo in an
 * email address would save a bike, a colour and a venue that rider never chose.
 *
 * Migrated to the V2 field components so both correction paths look like one
 * product. Nothing about its behaviour moved: `validateRegistrationForm` is
 * still the only rule, validation still runs on submit rather than per
 * keystroke, a failed submission still keeps every other field, Name is still
 * focused on arrival and Enter from any field still submits.
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
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <FormField label="Name" required error={errors.name}>
          {(field) => (
            <Input
              {...field}
              ref={nameRef}
              type="text"
              autoComplete="off"
              value={values.name}
              disabled={busy}
              onChange={(event) => update('name', event.target.value)}
            />
          )}
        </FormField>

        <FormField label="Email ID" required error={errors.email}>
          {(field) => (
            <Input
              {...field}
              type="email"
              autoComplete="off"
              autoCapitalize="none"
              value={values.email}
              disabled={busy}
              onChange={(event) => update('email', event.target.value)}
            />
          )}
        </FormField>

        {/*
          A plain text input rather than the campaign's `NumericField`. This
          path exists for records captured before the campaign, whose phone
          numbers were stored under the generic rule and are not guaranteed to
          be ten Indian digits. A control that silently dropped every character
          that did not fit that rule would turn opening a correction into an
          edit nobody asked for.
        */}
        <FormField label="Phone Number" required error={errors.phone}>
          {(field) => (
            <Input
              {...field}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={values.phone}
              disabled={busy}
              onChange={(event) => update('phone', event.target.value)}
            />
          )}
        </FormField>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-4">
        <AppButton type="submit" busy={busy} busyLabel="Saving…">
          {submitLabel}
        </AppButton>
      </div>
    </form>
  )
}
