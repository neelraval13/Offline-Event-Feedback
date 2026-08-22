import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NumericField } from './NumericField'
import { normalisePastedPhone } from '../registrationForm'

/*
 * Point A's fixed-length numbers.
 *
 * This suite is deliberately the same suite the circular dial had, minus the
 * assertions about the rendered keypad that V2 removed and plus the ones about
 * the completion count that replaced it. Every input behaviour the dial
 * guaranteed is asserted here: what changed in Phase 3 is the treatment, and
 * these are the tests that say so.
 */

afterEach(cleanup)

/**
 * A controlled wrapper, the way the form uses the control.
 *
 * The component is deliberately controlled, the form owns the draft, so a test
 * that did not re-render on every change would only ever see one keystroke.
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
    <NumericField
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
    count: () => screen.getByTestId('numeric-count').textContent,
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
    /*
     * `type="number"` strips the leading zero off a pincode and adds spinners
     * nobody wants on a phone number.
     */
    const { field } = setup({ length: 10 })

    expect(field().getAttribute('type')).toBe('text')
    expect(field().getAttribute('inputMode')).toBe('numeric')
  })

  it('accepts a paste, keeping only the digits', async () => {
    const { user, field, current } = setup({ length: 10 })

    await user.click(field())
    await user.paste('98765 43210')

    expect(current()).toBe('9876543210')
  })

  it('applies the caller’s paste rule to an empty field', async () => {
    const { user, field, current } = setup({
      length: 10,
      normalisePaste: normalisePastedPhone,
    })

    await user.click(field())
    await user.paste('+91 98765 43210')

    expect(current()).toBe('9876543210')
  })

  it('appends rather than re-normalising when the field already has digits', async () => {
    /*
     * A prefix rule applied to a fragment is nonsense. Into a field that
     * already holds digits the operator is extending what they typed.
     */
    const { user, field, current } = setup({
      length: 10,
      initial: '98765',
      normalisePaste: normalisePastedPhone,
    })

    await user.click(field())
    await user.paste('43210')

    expect(current()).toBe('9876543210')
  })

  it('deletes with backspace', async () => {
    const { user, field, current } = setup({ length: 10, initial: '9876' })

    await user.click(field())
    await user.keyboard('{Backspace}')

    expect(current()).toBe('987')
  })

  it('rejects letters and punctuation as they are typed', async () => {
    const { user, field, current } = setup({ length: 10 })

    await user.type(field(), '98a76-54()3210')

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

    await user.click(field())
    await user.paste('560 048')

    expect(current()).toBe('560048')
  })

  it('can be left empty', async () => {
    const { user, field, current } = setup({ length: 6, label: 'Pincode' })

    await user.click(field())
    await user.keyboard('{Backspace}')

    expect(current()).toBe('')
  })
})

describe('the completion count', () => {
  /*
   * The one part of the dial worth keeping. An operator can see without
   * counting that seven of ten digits are in, and a half-typed phone number is
   * the most common thing wrong with a registration.
   */

  it('counts up as digits arrive', async () => {
    const { user, field, count } = setup({ length: 10 })

    expect(count()).toBe('0 / 10')
    await user.type(field(), '98765')
    expect(count()).toBe('5 / 10')
  })

  it('states the length the campaign asks for, per field', () => {
    const phone = setup({ length: 10 })
    expect(phone.count()).toBe('0 / 10')
    cleanup()

    const pincode = setup({ length: 6, label: 'Pincode' })
    expect(pincode.count()).toBe('0 / 6')
  })

  it('is announced, not decoration', async () => {
    /*
     * "How many digits have I typed" is a question a screen-reader user has
     * exactly as often as anybody else, so the count is referenced by the
     * input rather than hidden from the accessibility tree.
     */
    const { field } = setup({ length: 10 })
    const described = field().getAttribute('aria-describedby')

    expect(described).not.toBeNull()
    expect(
      document.getElementById((described as string).split(' ')[0] as string)
        ?.textContent,
    ).toBe('0 / 10')
  })

  it('keeps the error reachable alongside the count', async () => {
    const { field } = setup({ length: 10, error: 'Enter a valid number.' })
    const described = (field().getAttribute('aria-describedby') ?? '').split(' ')

    expect(described).toHaveLength(2)
    expect(field().getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid number.')
  })
})

describe('what the dial treatment took with it', () => {
  it('renders no on-screen keypad', () => {
    /*
     * The reference's pod was keypad-only: ten taps on rendered buttons where
     * a keyboard would do one paste. The device keyboard does this job, and
     * removing the keypad is what let two fields stop being a third of the
     * form's height.
     */
    const { field } = setup({ length: 10 })

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(field().hasAttribute('disabled')).toBe(false)
  })

  it('leaves exactly one focusable control per field', () => {
    setup({ length: 10 })

    const focusable = document.querySelectorAll(
      'input, button, select, textarea, [tabindex]',
    )
    expect(focusable).toHaveLength(1)
  })
})
