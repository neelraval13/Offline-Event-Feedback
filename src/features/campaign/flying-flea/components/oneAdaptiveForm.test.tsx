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
      'Location',
      'Gender',
      'Test Ride Date & Time',
      'Driving Licence No',
    ]) {
      expect(screen.getAllByLabelText(new RegExp(`^${label}`))).toHaveLength(1)
    }
  })

  it('keeps the six personal details in one grid', () => {
    /*
     * The two-into-one-column behaviour is `auto-fit`, which needs all six
     * fields to be siblings in the same grid. Splitting them across two
     * containers to force a layout would freeze the column count.
     */
    renderRegistration()

    const grids = document.querySelectorAll('.ff-grid2')
    expect(grids).toHaveLength(1)
    expect(grids[0]?.querySelectorAll('.ff-field')).toHaveLength(6)
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

describe('the numeric clusters', () => {
  it('are a phone of ten digits and a pincode of six', () => {
    // The slot count is the campaign's rule, never a function of the viewport.
    renderRegistration()

    const dials = document.querySelectorAll('.ff-dial')
    expect(dials).toHaveLength(2)
    expect(dials[0]?.querySelectorAll('.ff-dial__digits span')).toHaveLength(10)
    expect(dials[1]?.querySelectorAll('.ff-dial__digits span')).toHaveLength(6)
  })

  it('keep one real, focusable input per cluster', () => {
    /*
     * The keypad is a convenience. The input underneath it is what opens the
     * device keyboard and what accepts a paste, so it must survive any layout
     * change, and there must not be a second one.
     */
    renderRegistration()

    const inputs = document.querySelectorAll('input.ff-dial__input')
    expect(inputs).toHaveLength(2)

    for (const input of inputs) {
      expect(input.getAttribute('inputmode')).toBe('numeric')
      expect(input.hasAttribute('disabled')).toBe(false)
      expect(input.getAttribute('tabindex')).toBeNull()
    }
  })

  it('sit in one container, so the pair wraps rather than being duplicated', () => {
    renderRegistration()

    const clusters = document.querySelectorAll('.ff-clusters')
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.querySelectorAll('.ff-dial')).toHaveLength(2)
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
