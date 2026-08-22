import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CampaignFeedbackForm } from './CampaignFeedbackForm'
import { CampaignRegistrationForm } from './CampaignRegistrationForm'
import { FLYING_FLEA_CAMPAIGN } from '../config'

/*
 * One form, adapting.
 *
 * The requirement behind these assertions is not "it looks right on a phone",
 * which jsdom cannot see. It is that there is only ever *one* of each control
 * in the document, and that its content is the campaign's rather than a layout
 * decision. The tempting way to make a dense form fit a small screen is to
 * render a second, simpler copy behind a media query, and that is exactly how a
 * registration desk ends up with two inputs bound to one field, a duplicated
 * label a screen reader reads twice, and a phone number typed into the copy
 * that is not submitted.
 *
 * The layout itself is CSS, verified at real widths by hand; see
 * `docs/flying-flea-qa.md`.
 */

afterEach(cleanup)

function renderRegistration() {
  render(
    <CampaignRegistrationForm onSubmit={vi.fn()} busy={false} resetKey={0} />,
  )
}

describe('Point A renders one of everything', () => {
  it('has a single form, not a mobile copy beside a desktop one', () => {
    renderRegistration()

    expect(document.querySelectorAll('form')).toHaveLength(1)
  })

  it('asks each personal detail exactly once', () => {
    renderRegistration()

    for (const label of [
      'Name',
      'Email ID',
      'Gender',
      'Driving Licence No',
    ]) {
      expect(screen.getAllByLabelText(new RegExp(`^${label}`))).toHaveLength(1)
    }
  })

  it('keeps all six rider details in one grid', () => {
    /*
     * The two-into-one-column behaviour needs every field to be a sibling in
     * the same grid. Splitting them across containers to force a layout would
     * freeze the column count, and V1 did exactly that: four fields in a grid
     * and the two numbers in a separate block below, because the dial pods
     * needed their own row. With the pods gone all six sit together, which is
     * what lets the required ones lead the reading order.
     */
    renderRegistration()

    const controls = [
      ...document.querySelectorAll<HTMLElement>('form input, form select'),
    ]
    expect(controls).toHaveLength(6)

    /*
     * Every one of them under the same grid: asserted as "they share a grid
     * ancestor", rather than by naming a container class, so this keeps meaning
     * the same thing after the next restyle.
     */
    const grids = controls.map((control) => control.closest('.grid'))
    expect(new Set(grids).size).toBe(1)
    expect(grids[0]).not.toBeNull()
  })

  it('offers every vehicle and every colour once', () => {
    renderRegistration()

    for (const vehicle of FLYING_FLEA_CAMPAIGN.vehicles) {
      expect(screen.getAllByRole('button', { name: vehicle })).toHaveLength(1)
    }
    for (const colour of FLYING_FLEA_CAMPAIGN.colours) {
      expect(screen.getAllByRole('button', { name: colour })).toHaveLength(1)
    }
  })
})

describe('what Point A no longer asks', () => {
  /*
   * There is one venue and one day, and the ride is happening now. Both values
   * are still stored on every registration; they are attached at submit from
   * configuration and the venue clock instead of being typed. What must not
   * come back is a control: a disabled or read-only input holding an answer the
   * operator cannot change still costs a tab stop and a glance, several hundred
   * times a day.
   */

  it('offers no venue control of any kind', () => {
    renderRegistration()

    expect(screen.queryByLabelText(/^Location/)).toBeNull()
    expect(document.querySelectorAll('select')).toHaveLength(1) // Gender only.
    expect(screen.queryByText('Select location')).toBeNull()
  })

  it('offers no date or time control of any kind', () => {
    renderRegistration()

    expect(screen.queryByLabelText(/^Test Ride Date/)).toBeNull()

    for (const type of ['datetime-local', 'date', 'time']) {
      expect(document.querySelectorAll(`input[type="${type}"]`)).toHaveLength(0)
    }
  })

  it('leaves no read-only or disabled field standing in for them', () => {
    renderRegistration()

    for (const control of document.querySelectorAll('input, select, textarea')) {
      expect(control.hasAttribute('readonly')).toBe(false)
      expect(control.hasAttribute('disabled')).toBe(false)
    }
  })
})

describe('the two numbers', () => {
  it('are a phone of ten digits and a pincode of six', () => {
    // The length is the campaign's rule, never a function of the viewport.
    renderRegistration()

    const counts = [...document.querySelectorAll('[data-testid="numeric-count"]')]
    expect(counts.map((count) => count.textContent)).toEqual(['0 / 10', '0 / 6'])
  })

  it('keep one real, focusable input each', () => {
    /*
     * The input is what opens the device keyboard and what accepts a paste, so
     * it must survive any layout change, and there must not be a second one.
     * V2 removed the rendered keypad that used to sit over it; the assertion
     * that matters is unchanged, and there are now fewer things that could
     * break it.
     */
    renderRegistration()

    const inputs = document.querySelectorAll('input[inputmode="numeric"]')
    expect(inputs).toHaveLength(2)

    for (const input of inputs) {
      expect(input.getAttribute('type')).toBe('text')
      expect(input.hasAttribute('disabled')).toBe(false)
      expect(input.getAttribute('tabindex')).toBeNull()
    }
  })

  it('renders no on-screen keypad', () => {
    /*
     * The dial's keypad was ten taps where the tablet's own keyboard does one
     * paste, and it cost two fields a third of the form's height. Every button
     * left on this form belongs to a vehicle plate or a colour, plus submit.
     */
    renderRegistration()

    const buttons = [...document.querySelectorAll('button')]
    for (const key of ['0', '1', '5', '9', '⌫']) {
      expect(buttons.some((button) => button.textContent?.trim() === key)).toBe(
        false,
      )
    }
  })
})

describe('Point B renders one of everything', () => {
  it('shows every campaign question once, in order', () => {
    render(<CampaignFeedbackForm onSubmit={vi.fn()} busy={false} />)

    for (const question of [
      ...FLYING_FLEA_CAMPAIGN.ratingQuestions,
      ...FLYING_FLEA_CAMPAIGN.textQuestions,
    ]) {
      expect(screen.getAllByText(question.prompt)).toHaveLength(1)
    }
  })

  it('gives every rating question all seven values, in order', () => {
    /*
     * The scale rearranges across rows on a narrow screen. What may never
     * change is that all seven are present and that 1 reads before 7.
     */
    render(<CampaignFeedbackForm onSubmit={vi.fn()} busy={false} />)

    const scales = document.querySelectorAll('.ff-rating')
    expect(scales).toHaveLength(FLYING_FLEA_CAMPAIGN.ratingQuestions.length)

    for (const scale of scales) {
      const options = [...scale.querySelectorAll('[role="radio"]')]
      expect(options.map((option) => option.getAttribute('aria-label'))).toEqual(
        FLYING_FLEA_CAMPAIGN.ratingScale.map(
          (value) => `Rate ${value} out of 7`,
        ),
      )
    }
  })

  it('gives each free-text answer a real textarea', () => {
    render(<CampaignFeedbackForm onSubmit={vi.fn()} busy={false} />)

    const areas = document.querySelectorAll('textarea')
    expect(areas).toHaveLength(FLYING_FLEA_CAMPAIGN.textQuestions.length)

    for (const area of areas) {
      // Labelled, so the prompt is not merely painted above the box.
      expect(area.getAttribute('id')).not.toBeNull()
      expect(
        document.querySelector(`label[for="${area.getAttribute('id')}"]`),
      ).not.toBeNull()
    }
  })
})
