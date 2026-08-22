import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeedbackScreen } from './FeedbackScreen'
import { FakeScanner } from './testScanner'
import { ROUTES } from '../../app/routes'
import { db } from '../../lib/storage'
import {
  FLYING_FLEA_CAMPAIGN,
  REQUIRED_CAMPAIGN_FIELDS,
} from '../campaign/flying-flea/config'
import {
  RATING_QUESTIONS,
  TEXT_QUESTIONS,
} from '../campaign/flying-flea/feedbackForm'
import { MAX_CAMPAIGN_TEXT_LENGTH } from '../../types'

/*
 * The V2 Point B surface.
 *
 * These cover what the redesign is responsible for: which paths are offered,
 * what each state says, and which parts of a half-finished response survive a
 * failure. They deliberately do not re-test the terminal, the scanner
 * lifecycle or persistence, all of which have their own suites that this phase
 * left untouched.
 */

let scanner = new FakeScanner()

beforeEach(async () => {
  await db.open()
  await Promise.all([db.feedback.clear(), db.registrations.clear()])
  scanner = new FakeScanner()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderScreen() {
  render(<FeedbackScreen createScanner={() => scanner} />)
  return userEvent.setup()
}

/** The two paths that never need a camera, wherever they are rendered. */
const ENTER_CODE = /^Enter code/
const NO_QR = /^No QR or code/

describe('the shell Point B asks for', () => {
  it('is minimal chrome, so no station row sits over the questionnaire', () => {
    /*
     * A rider midway through six questions does not need a row of links to
     * Point A and Device Admin above them, and an operator reaching past the
     * tablet does not need to be one mis-tap from losing their answers.
     */
    const pointB = ROUTES.find((route) => route.path === '/b')

    expect(pointB?.chrome).toBe('minimal')
    expect(pointB?.context).toBe('Point B · Feedback')
    // Still a listed station: minimal chrome hides the row, not the route.
    expect(pointB?.showInNav).toBe(true)
  })
})

describe('the start screen', () => {
  it('offers all three identity paths immediately', async () => {
    /*
     * The direct-contact path is not a fallback. A rider who never registered
     * has nothing to scan and nothing to type, and making an operator break the
     * camera to reach their way in would be absurd.
     */
    renderScreen()

    expect(screen.getByRole('button', { name: /^Scan QR/ })).toBeDefined()
    expect(screen.getByRole('button', { name: ENTER_CODE })).toBeDefined()
    expect(screen.getByRole('button', { name: NO_QR })).toBeDefined()
  })

  it('says the three are equally valid, and only differ in speed', () => {
    renderScreen()

    expect(
      screen.getByText(/All three options save the same feedback/),
    ).toBeDefined()
  })

  it('gives the two alternates the same target height as each other', () => {
    /*
     * The weight difference between scanning and the rest is about
     * convenience. Between the two alternates it is zero, and that has to be
     * true in pixels rather than only in the copy.
     */
    renderScreen()

    const code = screen.getByRole('button', { name: ENTER_CODE })
    const contact = screen.getByRole('button', { name: NO_QR })

    expect(code.className).toBe(contact.className)
  })

  it('keeps the saved count as quiet metadata, not a metric', () => {
    renderScreen()

    const count = screen.getByText(/Responses saved on this device/)
    expect(count.className).toContain('text-faint')
    expect(count.className).toContain('text-small')
  })
})

describe('the scanner frame', () => {
  it('keeps the video mounted before the camera is ever started', () => {
    /*
     * The scanner attaches a MediaStream to an element that must already
     * exist. Unmounting it between states would drop the stream and leave the
     * capture light on, so the frame is always in the tree and only hides.
     */
    renderScreen()

    expect(screen.getByTestId('scanner-video')).toBeDefined()
  })

  it('shows the camera instruction as text, not only a spinner', async () => {
    const user = renderScreen()
    await user.click(screen.getByRole('button', { name: /^Scan QR/ }))

    await screen.findByText(/Hold the sticker/)
    expect(
      screen.getByRole('button', { name: ENTER_CODE }),
    ).toBeDefined()
    expect(screen.getByRole('button', { name: NO_QR })).toBeDefined()
  })

  it('reports a rejected sticker beside the camera, not instead of it', async () => {
    /*
     * The terminal stays in `scanning` and the stream keeps running. Replacing
     * the picture with an error screen would make an operator restart a camera
     * that never stopped.
     */
    const user = renderScreen()
    await user.click(screen.getByRole('button', { name: /^Scan QR/ }))
    await screen.findByText(/Hold the sticker/)

    scanner.emit('https://example.com/not-a-sticker')

    await screen.findByText(/That sticker was not accepted/)
    expect(screen.getByTestId('scanner-video')).toBeDefined()
    expect(screen.getByText(/Hold the sticker/)).toBeDefined()
  })
})

describe('camera trouble is not feedback trouble', () => {
  it('offers all three ways forward, in amber rather than red', async () => {
    scanner.startFailure = {
      kind: 'permission-denied',
      message: 'Camera access was refused.',
    }

    const user = renderScreen()
    await user.click(screen.getByRole('button', { name: /^Scan QR/ }))

    const alert = await screen.findByRole('alert')
    expect(alert.className).toContain('bg-warn-soft')
    expect(alert.className).not.toContain('bg-danger-soft')

    expect(
      screen.getByRole('button', { name: 'Try camera again' }),
    ).toBeDefined()
    expect(screen.getByRole('button', { name: ENTER_CODE })).toBeDefined()
    expect(screen.getByRole('button', { name: NO_QR })).toBeDefined()
  })
})

describe('the manual code field', () => {
  async function openManual() {
    const user = renderScreen()
    await user.click(screen.getByRole('button', { name: ENTER_CODE }))
    return user
  }

  it('takes focus on arrival', async () => {
    await openManual()

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText('Participant code'),
      ),
    )
  })

  it('shows the real printed shape as its example', async () => {
    await openManual()

    expect(
      screen.getByLabelText('Participant code').getAttribute('placeholder'),
    ).toBe('A1-B8EFD9-00001-X')
  })

  it('keeps what was typed when the code is rejected', async () => {
    /*
     * Clearing the box on rejection would make an operator re-read the sticker
     * to find out what they got wrong.
     */
    const user = await openManual()
    const field = screen.getByLabelText('Participant code')

    await user.type(field, 'A1-B8EFD9-00001-Z')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findByRole('alert')
    expect(field).toHaveProperty('value', 'A1-B8EFD9-00001-Z')
    expect(field.getAttribute('aria-invalid')).toBe('true')
  })

  it('still offers the contact path from here', async () => {
    await openManual()

    expect(screen.getByRole('button', { name: /^No code either/ })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Back to scanner' })).toBeDefined()
  })
})

describe('the questionnaire', () => {
  async function openContactForm() {
    const user = renderScreen()
    await user.click(screen.getByRole('button', { name: NO_QR }))
    return user
  }

  it('asks the campaign’s six questions, in the campaign’s wording', async () => {
    await openContactForm()

    for (const question of [
      ...FLYING_FLEA_CAMPAIGN.ratingQuestions,
      ...FLYING_FLEA_CAMPAIGN.textQuestions,
    ]) {
      expect(screen.getAllByText(question.prompt)).toHaveLength(1)
    }
  })

  it('numbers them by position, without touching the wording', async () => {
    await openContactForm()

    const numerals = [...document.querySelectorAll('span[aria-hidden="true"]')]
      .map((span) => span.textContent?.trim() ?? '')
      .filter((text) => /^0\d$/.test(text))

    expect(numerals).toEqual(['01', '02', '03', '04', '05', '06'])
  })

  it('marks the free-text half optional once, for both', async () => {
    await openContactForm()

    expect(screen.getByText('In your own words')).toBeDefined()
    expect(screen.getByText('Optional')).toBeDefined()

    const areas = document.querySelectorAll('textarea')
    expect(areas).toHaveLength(TEXT_QUESTIONS.length)
    for (const area of areas) {
      expect(area.getAttribute('maxlength')).toBe(
        String(MAX_CAMPAIGN_TEXT_LENGTH),
      )
      expect(area.hasAttribute('required')).toBe(false)
    }
  })
})

describe('the rating scale', () => {
  async function openContactForm() {
    const user = renderScreen()
    await user.click(screen.getByRole('button', { name: NO_QR }))
    return user
  }

  it('shows all seven values on every rating question', async () => {
    await openContactForm()

    const scales = document.querySelectorAll('[data-slot="rating-scale"]')
    expect(scales).toHaveLength(RATING_QUESTIONS.length)

    for (const scale of scales) {
      expect(
        [...scale.querySelectorAll('[role="radio"]')].map(
          (option) => option.textContent,
        ),
      ).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    }
  })

  it('reads "Not rated" until something is chosen', async () => {
    await openContactForm()

    expect(screen.getAllByText('Not rated')).toHaveLength(
      RATING_QUESTIONS.length,
    )
  })

  it('reports the chosen value in text as well as in colour', async () => {
    /*
     * The whole reason the scale is safe outdoors: whatever the fills are
     * doing, the answer is written down beside them.
     */
    const user = await openContactForm()
    const scale = document.querySelectorAll('[data-slot="rating-scale"]')[0]

    await user.click(
      within(scale as HTMLElement).getByRole('radio', {
        name: 'Rate 5 out of 7',
      }),
    )

    expect(screen.getByText('5 / 7')).toBeDefined()
    expect(screen.getAllByText('Not rated')).toHaveLength(
      RATING_QUESTIONS.length - 1,
    )
  })

  it('marks exactly one option chosen, and trails the ones below it', async () => {
    const user = await openContactForm()
    const scale = document.querySelectorAll(
      '[data-slot="rating-scale"]',
    )[0] as HTMLElement

    await user.click(
      within(scale).getByRole('radio', { name: 'Rate 5 out of 7' }),
    )

    const options = [...scale.querySelectorAll('[role="radio"]')]
    const checked = options.filter(
      (option) => option.getAttribute('aria-checked') === 'true',
    )

    expect(checked).toHaveLength(1)
    expect(checked[0]?.textContent).toBe('5')
    // The four below carry the trail; they are not reported as chosen.
    expect(options[3]?.className).toContain('bg-interactive-soft')
    expect(options[5]?.className).not.toContain('bg-interactive-soft')
  })

  it('is announced with the question it belongs to', async () => {
    await openContactForm()

    for (const question of RATING_QUESTIONS) {
      expect(
        screen.getByRole('radiogroup', { name: question.prompt }),
      ).toBeDefined()
    }
  })
})

describe('the contact path', () => {
  async function openContactForm() {
    const user = renderScreen()
    await user.click(screen.getByRole('button', { name: NO_QR }))
    return user
  }

  it('asks for three details and nothing Point A asks for', async () => {
    /*
     * This is Point B. No vehicle, no colour, no licence, no pincode, no venue,
     * and no sticker is printed.
     */
    await openContactForm()

    expect(screen.getByLabelText(/^Name/)).toBeDefined()
    expect(screen.getByLabelText(/^Email ID/)).toBeDefined()
    expect(screen.getByLabelText(/^Phone Number/)).toBeDefined()

    for (const absent of [/^Pincode/, /^Driving Licence/, /^Location/]) {
      expect(screen.queryByLabelText(absent)).toBeNull()
    }
    expect(
      screen.queryByRole('group', { name: 'Select vehicle number' }),
    ).toBeNull()
    // Vehicle is a required registration field; it is not a feedback one.
    expect(REQUIRED_CAMPAIGN_FIELDS).toContain('vehicle')
  })

  it('takes the phone through the compact numeric field, not a keypad', async () => {
    const user = await openContactForm()
    const phone = screen.getByLabelText(/^Phone Number/)

    expect(phone.getAttribute('inputMode')).toBe('numeric')
    expect(phone.getAttribute('type')).toBe('text')

    await user.type(phone, '98765')
    expect(screen.getByText('5 / 10')).toBeDefined()

    // No rendered keypad: every button on this form is a rating or the submit.
    for (const key of ['0', '9', '⌫']) {
      expect(
        [...document.querySelectorAll('button')].filter(
          (button) =>
            button.textContent?.trim() === key &&
            button.getAttribute('role') !== 'radio',
        ),
      ).toHaveLength(0)
    }
  })

  it('is one form with one submit, never a wizard', async () => {
    /*
     * A rider standing at a tablet having just got off a motorcycle. A second
     * screen is a second chance to walk away, and it is what would separate
     * their contact details from their answers when a save fails.
     */
    await openContactForm()

    expect(document.querySelectorAll('form')).toHaveLength(1)
    expect(
      screen.getAllByRole('button', { name: 'Submit Feedback' }),
    ).toHaveLength(1)
  })

  it('reports a bad contact detail and a missing rating together', async () => {
    const user = await openContactForm()

    await user.type(screen.getByLabelText(/^Name/), 'Ada Lovelace')
    await user.type(screen.getByLabelText(/^Email ID/), 'not-an-email')
    await user.type(screen.getByLabelText(/^Phone Number/), '9876543210')

    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))

    // Both halves, at once. Neither validator short-circuits the other.
    expect(await screen.findByText('Enter a valid email address.')).toBeDefined()
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(1)
    // And nothing the rider typed was cleared.
    expect(screen.getByLabelText(/^Name/)).toHaveProperty(
      'value',
      'Ada Lovelace',
    )
  })
})
