import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ColourSelector } from './ColourSelector'
import { SevenPointRating } from './SevenPointRating'
import { VehicleSelector } from './VehicleSelector'
import { FLYING_FLEA_CAMPAIGN } from '../config'

/*
 * The campaign's three custom controls, tested for behaviour rather than looks.
 *
 * Every one of them replaces a native control with something styled, which is
 * where accessibility usually gets lost: the questions are whether each option
 * is individually labelled, whether the chosen value is announced rather than
 * only coloured, and whether the control reports what the campaign configured
 * rather than what a component happened to hardcode.
 */

afterEach(cleanup)

describe('SevenPointRating', () => {
  it('offers exactly 1 to 7', () => {
    render(
      <>
        <span id="q">Rate it</span>
        <SevenPointRating value={null} onChange={vi.fn()} labelledBy="q" />
      </>,
    )

    const options = screen.getAllByRole('radio')
    expect(options).toHaveLength(7)
    expect(options.map((option) => option.getAttribute('aria-label'))).toEqual([
      'Rate 1 out of 7',
      'Rate 2 out of 7',
      'Rate 3 out of 7',
      'Rate 4 out of 7',
      'Rate 5 out of 7',
      'Rate 6 out of 7',
      'Rate 7 out of 7',
    ])
  })

  it('reports the value that was tapped', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <>
        <span id="q">Rate it</span>
        <SevenPointRating value={null} onChange={onChange} labelledBy="q" />
      </>,
    )

    await user.click(screen.getByRole('radio', { name: 'Rate 5 out of 7' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith(5)
  })

  it('marks exactly one option as chosen', () => {
    render(
      <>
        <span id="q">Rate it</span>
        <SevenPointRating value={5} onChange={vi.fn()} labelledBy="q" />
      </>,
    )

    const chosen = screen
      .getAllByRole('radio')
      .filter((option) => option.getAttribute('aria-checked') === 'true')

    expect(chosen).toHaveLength(1)
    expect(chosen[0]?.getAttribute('aria-label')).toBe('Rate 5 out of 7')
  })

  it('never hides the chosen value behind colour alone', () => {
    const { rerender } = render(
      <>
        <span id="q">Rate it</span>
        <SevenPointRating value={null} onChange={vi.fn()} labelledBy="q" />
      </>,
    )
    expect(screen.getByText('Not rated')).toBeDefined()

    rerender(
      <>
        <span id="q">Rate it</span>
        <SevenPointRating value={6} onChange={vi.fn()} labelledBy="q" />
      </>,
    )
    expect(screen.getByText('6 / 7')).toBeDefined()
  })

  it('is operable from the keyboard', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <>
        <span id="q">Rate it</span>
        <SevenPointRating value={null} onChange={onChange} labelledBy="q" />
      </>,
    )

    // Tab reaches the options because they are buttons, not decorated spans.
    await user.tab()
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('is announced with the question it belongs to', () => {
    render(
      <>
        <span id="q">How was your test ride?</span>
        <SevenPointRating value={null} onChange={vi.fn()} labelledBy="q" />
      </>,
    )

    expect(
      screen.getByRole('radiogroup', { name: 'How was your test ride?' }),
    ).toBeDefined()
  })
})

describe('VehicleSelector', () => {
  it('offers exactly the configured vehicles', () => {
    render(<VehicleSelector value={null} onChange={vi.fn()} />)

    const group = screen.getByRole('group', { name: 'Select vehicle number' })
    const plates = within(group).getAllByRole('button')

    expect(plates.map((plate) => plate.textContent)).toEqual([
      ...FLYING_FLEA_CAMPAIGN.vehicles,
    ])
  })

  it('reports the vehicle that was chosen and marks it', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const chosen = FLYING_FLEA_CAMPAIGN.vehicles[2] as string

    const { rerender } = render(
      <VehicleSelector value={null} onChange={onChange} />,
    )
    await user.click(screen.getByRole('button', { name: chosen }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(chosen)

    rerender(<VehicleSelector value={chosen} onChange={onChange} />)
    expect(
      screen.getByRole('button', { name: chosen }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('shows the error where staff will look for it', () => {
    render(
      <VehicleSelector
        value={null}
        onChange={vi.fn()}
        error="Select the test-ride vehicle."
      />,
    )

    expect(screen.getByRole('alert').textContent).toBe(
      'Select the test-ride vehicle.',
    )
  })
})

describe('ColourSelector', () => {
  it('offers exactly the configured colours', () => {
    render(<ColourSelector value="Flea Green" onChange={vi.fn()} />)

    const group = screen.getByRole('group', { name: 'Interested in colour?' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((option) => option.textContent),
    ).toEqual([...FLYING_FLEA_CAMPAIGN.colours])
  })

  it('is single-select: one colour is always chosen and only one', async () => {
    /*
     * The supplied control is a two-position toggle. It cannot express "both"
     * or "neither", so neither can this — a multi-select here would produce
     * answers the campaign's own form could not.
     */
    const onChange = vi.fn()
    const user = userEvent.setup()

    const { rerender } = render(
      <ColourSelector value="Flea Green" onChange={onChange} />,
    )

    const chosen = () =>
      screen
        .getAllByRole('button')
        .filter((option) => option.getAttribute('aria-pressed') === 'true')

    expect(chosen()).toHaveLength(1)
    expect(chosen()[0]?.textContent).toBe('Flea Green')

    await user.click(screen.getByRole('button', { name: 'Storm Black' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('Storm Black')

    rerender(<ColourSelector value="Storm Black" onChange={onChange} />)
    expect(chosen()).toHaveLength(1)
    expect(chosen()[0]?.textContent).toBe('Storm Black')
  })
})
