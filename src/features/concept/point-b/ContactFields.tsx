import { useId } from 'react'
import { FormField } from '@/components/design-system'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/ui/cn'

/*
 * The rider's own details, on the no-sticker path.
 *
 * Three fields, and only three. This is Point B: nothing here asks for a
 * vehicle, a colour, a licence, a pincode or a venue, nothing prints a sticker,
 * and no registration is created. The rider may never have been through Point A
 * at all, and inventing a registration for them would put a participant in the
 * event who never registered.
 *
 * ## The phone field
 *
 * Point A's V2 numeric treatment, not V1's circular dial: a normal field, the
 * device's own numeric keyboard, paste and autofill, and a live `n / 10`
 * readout so a half-typed number is visible without counting. No rendered
 * keypad. This is the same shape the registration desk now uses, which matters
 * beyond consistency: reconciliation matches a contact response to a
 * registration on the normalised phone and email pair, so the two desks must
 * accept and canonicalise a number identically or the same rider typing the
 * same number at both produces two values that never match.
 *
 * The concept holds values and runs no validation. The real rules live in
 * `contactCapture.ts` and are untouched.
 */

export interface ContactDraftFixture {
  readonly name: string
  readonly email: string
  readonly phone: string
}

export const EMPTY_CONTACT: ContactDraftFixture = {
  name: '',
  email: '',
  phone: '',
}

interface ContactFieldsProps {
  readonly value: ContactDraftFixture
  readonly onChange: (patch: Partial<ContactDraftFixture>) => void
  readonly errors?: Partial<Record<keyof ContactDraftFixture, string>>
  readonly disabled?: boolean
}

export function ContactFields({
  value,
  onChange,
  errors = {},
  disabled = false,
}: ContactFieldsProps) {
  return (
    <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
      <FormField label="Name" required error={errors.name}>
        {(field) => (
          <Input
            {...field}
            type="text"
            autoComplete="name"
            value={value.name}
            disabled={disabled}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        )}
      </FormField>

      <FormField label="Email ID" required error={errors.email}>
        {(field) => (
          <Input
            {...field}
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            value={value.email}
            disabled={disabled}
            onChange={(event) => onChange({ email: event.target.value })}
          />
        )}
      </FormField>

      <PhoneField
        value={value.phone}
        onChange={(phone) => onChange({ phone })}
        {...(errors.phone === undefined ? {} : { error: errors.phone })}
        disabled={disabled}
      />
    </div>
  )
}

interface PhoneFieldProps {
  readonly value: string
  readonly onChange: (digits: string) => void
  readonly error?: string | undefined
  readonly disabled: boolean
}

/**
 * Ten digits, counted.
 *
 * Deliberately a copy of Point A's `NumericField` shape rather than an import:
 * this is a concept, and it must not reach into the production registration
 * feature. When Point B is implemented the two become one component.
 */
function PhoneField({ value, onChange, error, disabled }: PhoneFieldProps) {
  const id = useId()
  const countId = `${id}-count`
  const errorId = `${id}-error`
  const complete = value.length === 10

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        Phone Number
        <span aria-hidden="true" className="ml-1 text-accent">
          *
        </span>
        <span className="sr-only"> (required)</span>
      </Label>

      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={10}
          autoComplete="tel-national"
          value={value}
          disabled={disabled}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? countId : `${countId} ${errorId}`}
          onChange={(event) =>
            onChange(event.target.value.replace(/\D/g, '').slice(0, 10))
          }
          className={cn(
            'flex min-h-touch w-full rounded-control border border-line bg-field',
            'py-2 pr-16 pl-3.5',
            'font-mono text-base tabular-nums tracking-[0.28em] text-ink',
            'transition-[border-color,box-shadow] duration-150',
            'hover:border-line-strong',
            'focus-visible:border-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive/40',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/25',
          )}
        />
        <span
          id={countId}
          className={cn(
            'pointer-events-none absolute inset-y-0 right-3.5 flex items-center',
            'font-mono text-small tabular-nums',
            complete ? 'text-ok' : 'text-faint',
          )}
        >
          {value.length} / 10
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
