import { FormField } from '@/components/design-system'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DigitField } from './DigitField'

/*
 * The six fields the operator types.
 *
 * Order is the thing being designed here, and it is not the V1 order. V1 runs
 * Name, Email, Gender, Licence in a two-column grid and then drops Phone and
 * Pincode into a separate full-width block underneath, because the dial pods
 * needed their own row. That puts the two most important fields on the form,
 * one of them required, below two of the least important.
 *
 * Reordered by how often the answer exists and how much it matters:
 *
 *   Name *            Email ID *        the two required identity fields
 *   Phone Number *    Pincode           the two numbers, side by side
 *   Gender            Driving Licence   the two optional ones, last
 *
 * Required fields therefore occupy the top-left, top-right and middle-left
 * positions, which is the reading order, and an operator scanning for what is
 * still empty finds the ones that will refuse the form first.
 *
 * Two columns above 640px, one below. Required is a lime asterisk on the label
 * plus "(required)" in the accessible name, never a tooltip and never an icon.
 * Errors render below their field and are wired with `aria-describedby` by
 * `FormField`, so the layout does not shift as they appear: each field is a
 * flex column and the message takes the space beneath it.
 *
 * The concept holds values but runs no validation. The real validation rules
 * are unchanged and are not called from here.
 */

export interface RiderDraft {
  readonly name: string
  readonly email: string
  readonly phone: string
  readonly pincode: string
  readonly gender: string
  readonly drivingLicence: string
}

export const EMPTY_RIDER: RiderDraft = {
  name: '',
  email: '',
  phone: '',
  pincode: '',
  gender: '',
  drivingLicence: '',
}

interface RiderDetailsProps {
  readonly value: RiderDraft
  readonly onChange: (patch: Partial<RiderDraft>) => void
  readonly genders: readonly string[]
  readonly errors?: Partial<Record<keyof RiderDraft, string>>
  readonly disabled?: boolean
}

export function RiderDetails({
  value,
  onChange,
  genders,
  errors = {},
  disabled = false,
}: RiderDetailsProps) {
  return (
    <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
      <FormField label="Name" required error={errors.name}>
        {(field) => (
          <Input
            {...field}
            type="text"
            autoComplete="off"
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
            autoComplete="off"
            autoCapitalize="none"
            value={value.email}
            disabled={disabled}
            onChange={(event) => onChange({ email: event.target.value })}
          />
        )}
      </FormField>

      <DigitField
        label="Phone Number"
        required
        length={10}
        autoComplete="tel-national"
        value={value.phone}
        {...(errors.phone === undefined ? {} : { error: errors.phone })}
        disabled={disabled}
        onChange={(phone) => onChange({ phone })}
      />

      <DigitField
        label="Pincode"
        length={6}
        autoComplete="postal-code"
        value={value.pincode}
        {...(errors.pincode === undefined ? {} : { error: errors.pincode })}
        disabled={disabled}
        onChange={(pincode) => onChange({ pincode })}
      />

      <FormField label="Gender" error={errors.gender}>
        {(field) => (
          <Select
            /*
             * Radix reads the empty string as "clear", and under
             * `exactOptionalPropertyTypes` an explicit `undefined` is not the
             * same as omitting the prop. So the prop is spread in only when
             * there is a value, which leaves the placeholder showing.
             */
            {...(value.gender === '' ? {} : { value: value.gender })}
            disabled={disabled}
            onValueChange={(gender) => onChange({ gender })}
          >
            <SelectTrigger
              id={field.id}
              aria-describedby={field['aria-describedby']}
            >
              <SelectValue placeholder="Select gender" />
            </SelectTrigger>
            <SelectContent>
              {genders.map((gender) => (
                <SelectItem key={gender} value={gender}>
                  {gender}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>

      <FormField label="Driving Licence No" error={errors.drivingLicence}>
        {(field) => (
          <Input
            {...field}
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            value={value.drivingLicence}
            disabled={disabled}
            onChange={(event) => onChange({ drivingLicence: event.target.value })}
          />
        )}
      </FormField>
    </div>
  )
}
