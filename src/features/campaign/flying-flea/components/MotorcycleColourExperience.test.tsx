import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FlyingFleaColour } from '../../../../types'
import { MOTORCYCLE_ALT, MOTORCYCLE_IMAGES } from '../assets'
import { MotorcycleColourExperience } from './MotorcycleColourExperience'

/*
 * The picture follows the answer.
 *
 * The property under test is that there is one source of truth: the colour the
 * registration will persist. A preview that kept its own state would be a second
 * one, and the two would eventually disagree: a rider shown a green bike whose
 * record says Storm Black.
 */

afterEach(cleanup)

function Harness({ initial }: { readonly initial?: FlyingFleaColour }) {
  const [colour, setColour] = useState<FlyingFleaColour>(initial ?? 'Flea Green')

  return (
    <>
      <MotorcycleColourExperience value={colour} onChange={setColour} />
      {/* The value the form holds, surfaced so the test can read it. */}
      <output data-testid="persisted">{colour}</output>
    </>
  )
}

/** The photograph currently painted, read from its alt text. */
function shownColour(): string | null {
  return (
    document.querySelector('[data-shown="true"]')?.getAttribute('alt') ?? null
  )
}

/** The `src` of the photograph currently painted. */
function shownSource(): string | null {
  return (
    document.querySelector('[data-shown="true"]')?.getAttribute('src') ?? null
  )
}

describe('the default state', () => {
  it('starts on the campaign’s first colour and shows its motorcycle', () => {
    render(<Harness />)

    expect(screen.getByTestId('persisted').textContent).toBe('Flea Green')
    expect(shownColour()).toContain('Flea Green')
  })
})

describe('switching colour', () => {
  it('shows the Storm Black motorcycle when Storm Black is chosen', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Storm Black' }))

    expect(shownColour()).toContain('Storm Black')
    expect(screen.getByTestId('persisted').textContent).toBe('Storm Black')
  })

  it('shows the Flea Green motorcycle when Flea Green is chosen', async () => {
    const user = userEvent.setup()
    render(<Harness initial="Storm Black" />)

    await user.click(screen.getByRole('button', { name: 'Flea Green' }))

    expect(shownColour()).toContain('Flea Green')
    expect(screen.getByTestId('persisted').textContent).toBe('Flea Green')
  })

  it('keeps exactly one colour selected', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Storm Black' }))

    const pressed = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true')

    expect(pressed).toHaveLength(1)
    expect(pressed[0]?.textContent).toBe('Storm Black')
  })

  it('changes nothing but the colour', async () => {
    /*
     * The colour control is one field in a form of ten. A change here must not
     * reach into the rest of the draft.
     */
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(<MotorcycleColourExperience value="Flea Green" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Storm Black' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith('Storm Black')
  })
})

describe('the images are local', () => {
  it('never references a remote host', () => {
    /*
     * The reference hot-links both bikes from Royal Enfield's CDN. Carrying
     * those URLs over would mean a registration desk with no Wi-Fi shows two
     * broken images where the motorcycle should be.
     */
    for (const source of Object.values(MOTORCYCLE_IMAGES)) {
      expect(source.startsWith('/assets/flying-flea/')).toBe(true)
      expect(source).not.toContain('http://')
      expect(source).not.toContain('https://')
      expect(source).not.toContain('royalenfield')
    }
  })

  it('names one image per persisted colour value', () => {
    // Keyed by the stored answer, so a new colour cannot be added to the
    // campaign without an image being considered.
    expect(Object.keys(MOTORCYCLE_IMAGES).sort()).toEqual([
      'Flea Green',
      'Storm Black',
    ])
  })

  it('describes each motorcycle for screen readers', () => {
    for (const [colour, alt] of Object.entries(MOTORCYCLE_ALT)) {
      expect(alt).toContain(colour)
    }
  })

  it('paints the file that belongs to the selected colour', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(shownSource()).toBe(MOTORCYCLE_IMAGES['Flea Green'])

    await user.click(screen.getByRole('button', { name: 'Storm Black' }))
    expect(shownSource()).toBe(MOTORCYCLE_IMAGES['Storm Black'])
  })

  it('keeps both photographs mounted so a switch needs no network', () => {
    /*
     * The tablet is routinely offline. Mounting an image only when its colour
     * is chosen would mean the first switch waits on a decode and, on a build
     * where precaching had regressed, on a request.
     */
    render(<Harness />)

    const images = document.querySelectorAll('[data-motorcycle]')
    expect(images).toHaveLength(2)
    expect(
      document.querySelectorAll('[data-shown="true"]'),
    ).toHaveLength(1)
  })
})

describe('the hidden photograph', () => {
  it('is kept out of the accessibility tree', () => {
    // Two motorcycles are in the DOM; only one is on screen, and only that one
    // should be announced.
    render(<Harness />)

    const hidden = document.querySelector(
      '[data-shown="false"]',
    )

    expect(hidden?.getAttribute('aria-hidden')).toBe('true')
    expect(hidden?.getAttribute('alt')).toBe('')
  })
})
