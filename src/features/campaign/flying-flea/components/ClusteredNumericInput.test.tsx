import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClusteredNumericInput } from './ClusteredNumericInput'
import { normalisePastedPhone } from '../registrationForm'

/*
 * The numeric cluster.
 *
 * The reference's version is keypad-only. This one looks the same and behaves
 * like a text field, because Point A is staff-operated with a rider waiting —
 * so the tests that matter most here are the ones about typing, pasting and
 * deleting, none of which the reference supports.
 */

afterEach(cleanup)

/**
 * A controlled wrapper, the way the form uses the control.
 *
 * The component is deliberately controlled — the form owns the draft — so a
 * test that did not re-render on every change would only ever see one keystroke.
 */
function Harness(props: {
  readonly length: number
  readonly label?: string | undefined
  readonly initial?: string | undefined
  readonly required?: boolean | undefined
  readonly error?: string | undefined
  readonly normalisePaste?: ((pasted: string) => string) | undefined
  readonly onValue: (value: string) => void
}) {
  const [value, setValue] = useState(props.initial ?? '')

  return (
    <ClusteredNumericInput
      label={props.label ?? 'Phone Number'}
      length={props.length}
      value={value}
      required={props.required ?? false}
      error={props.error}
      normalisePaste={props.normalisePaste}
      onChange={(next) => {
        setValue(next)
        props.onValue(next)
      }}
    />
  )
}

function setup(options: {
  length: number
  label?: string
  initial?: string
  required?: boolean
  error?: string
  normalisePaste?: (pasted: string) => string
}) {
  let latest = options.initial ?? ''

  render(
    <Harness
      length={options.length}
      label={options.label}
      initial={options.initial}
      required={options.required}
      error={options.error}
      normalisePaste={options.normalisePaste}
      onValue={(value) => {
        latest = value
      }}
    />,
  )

  return {
    user: userEvent.setup(),
    field: () =>
      screen.getByLabelText(new RegExp(`^${options.label ?? 'Phone Number'}`)),
    current: () => latest,
  }
}

describe('the control is a real input', () => {
  it('accepts typed digits', async () => {
    const { user, field, current } = setup({ length: 10 })

    await user.type(field(), '9876543210')

    expect(current()).toBe('9876543210')
  })

  it('is a text input in numeric mode, not a number input', () => {
    // `type="number"` strips leading zeros — fatal for a pincode — and adds
    // spinners nobody wants on a phone number.
    const { field } = setup({ length: 6, label: 'Pincode' })

    expect(field().getAttribute('type')).toBe('text')
    expect(field().getAttribute('inputMode')).toBe('numeric')
  })

  it('accepts a paste, keeping only the digits', async () => {
    const { user, field, current } = setup({ length: 10 })

    field().focus()
    await user.paste('98765 43210')

    // The formatting people paste is not part of the number.
    expect(current()).toBe('9876543210')
  })

  it('applies the caller’s paste rule to an empty field', async () => {
    const { user, field, current } = setup({
      length: 10,
      normalisePaste: normalisePastedPhone,
    })

    field().focus()
    await user.paste('+91 98765 43210')

    expect(current()).toBe('9876543210')
  })

  it('appends rather than re-normalising when the field already has digits', async () => {
    // Mid-edit, a prefix rule applied to a fragment would be nonsense.
    const { user, field, current } = setup({
      length: 10,
      initial: '98765',
      normalisePaste: normalisePastedPhone,
    })

    field().focus()
    await user.paste('43210')

    expect(current()).toBe('9876543210')
  })

  it('deletes with backspace', async () => {
    const { user, field, current } = setup({ length: 10, initial: '98765' })

    await user.type(field(), '{backspace}{backspace}')

    expect(current()).toBe('987')
  })
})

describe('it only ever holds digits', () => {
  it('rejects letters and punctuation as they are typed', async () => {
    const { user, field, current } = setup({ length: 10 })

    await user.type(field(), '98a7-6b5 43210')

    // Ten digits went in among the letters and punctuation; ten digits remain.
    expect(current()).toBe('9876543210')
  })

  it('stops at the configured length', async () => {
    const { user, field, current } = setup({ length: 10 })

    await user.type(field(), '98765432109999')

    expect(current()).toBe('9876543210')
    expect(current()).toHaveLength(10)
  })

  it('stops at six for a pincode', async () => {
    const { user, field, current } = setup({ length: 6, label: 'Pincode' })

    await user.type(field(), '5600489999')

    expect(current()).toBe('560048')
  })

  it('pastes into a pincode without any prefix rule', async () => {
    const { user, field, current } = setup({ length: 6, label: 'Pincode' })

    field().focus()
    await user.paste('560 048')

    expect(current()).toBe('560048')
  })

  it('can be left empty', async () => {
    // Pincode is optional in the campaign contract, and this control does not
    // change that: an untouched cluster reports an empty string.
    const { current } = setup({ length: 6, label: 'Pincode' })

    expect(current()).toBe('')
  })
})

describe('the keypad', () => {
  it('appends a digit when a key is tapped', async () => {
    const { user, current } = setup({ length: 6, label: 'Pincode' })

    await user.click(screen.getByRole('button', { name: '5' }))
    await user.click(screen.getByRole('button', { name: '6' }))

    expect(current()).toBe('56')
  })

  it('deletes the last digit', async () => {
    const { user, current } = setup({ length: 10, initial: '98765' })

    await user.click(
      screen.getByRole('button', { name: 'Delete last digit of Phone Number' }),
    )

    expect(current()).toBe('9876')
  })

  it('refuses to overfill', async () => {
    const { user, current } = setup({ length: 6, label: 'Pincode', initial: '560048' })

    await user.click(screen.getByRole('button', { name: '9' }))

    expect(current()).toBe('560048')
  })

  it('keeps the keys out of the tab order', () => {
    // The input is the labelled control staff tab to; twelve keypad buttons in
    // the tab order would put eleven stops between two fields.
    setup({ length: 10 })

    for (const key of ['7', '0', '9']) {
      expect(screen.getByRole('button', { name: key }).getAttribute('tabindex')).toBe(
        '-1',
      )
    }
  })
})

describe('presentation reflects the value', () => {
  it('shows one slot per digit, filled from the left', () => {
    setup({ length: 6, label: 'Pincode', initial: '5600' })

    const digits = document.querySelectorAll('.ff-dial__digits span')
    expect(digits).toHaveLength(6)
    expect([...digits].map((slot) => slot.textContent)).toEqual([
      '5',
      '6',
      '0',
      '0',
      '·',
      '·',
    ])
  })

  it('counts progress towards the full number', () => {
    setup({ length: 10, initial: '98765' })

    expect(document.querySelector('.ff-dial__count')?.textContent).toBe('5 / 10')
  })

  it('reports an error to assistive technology and marks the field invalid', () => {
    const { field } = setup({
      length: 10,
      error: 'Enter a valid 10-digit mobile number.',
    })

    expect(field().getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe(
      'Enter a valid 10-digit mobile number.',
    )
  })

  it('marks a required field for both sighted and screen-reader users', () => {
    setup({ length: 10, required: true })

    // Not carried by the asterisk alone.
    expect(screen.getByText('(required)')).toBeDefined()
  })
})
