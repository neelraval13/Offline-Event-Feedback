import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeedbackScreen } from './FeedbackScreen'
import { FakeScanner } from './testScanner'
import { db } from '../../lib/storage'
import { countFeedback } from '../../lib/storage/feedback'
import { CampaignFeedbackForm } from '../campaign/flying-flea/components/CampaignFeedbackForm'
import { RATING_QUESTIONS } from '../campaign/flying-flea/feedbackForm'

/*
 * What survives when a save fails, and what each outcome looks like.
 *
 * The point of this suite is that a failed local write costs the rider nothing
 * but a second tap. On the sticker path that means six answers; on the contact
 * path it means six answers *and* a name, an email and a phone number, and the
 * answer to "please type all that in again" at an event is usually no.
 *
 * The terminal already guarantees the state; these check the screen does not
 * throw it away, which it would the moment somebody unmounted a form around a
 * save or moved the contact path to its own saving status.
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

/** Answers every rating question, leaving the optional half alone. */
async function answerRatings(
  user: ReturnType<typeof userEvent.setup>,
  rating = 5,
) {
  for (const scale of document.querySelectorAll('[data-slot="rating-scale"]')) {
    await user.click(
      within(scale as HTMLElement).getByRole('radio', {
        name: `Rate ${rating} out of 7`,
      }),
    )
  }
}

function failNextWrite() {
  vi.spyOn(db.feedback, 'add').mockRejectedValueOnce(
    new Error('QuotaExceededError'),
  )
}

describe('a failed save on the sticker path', () => {
  async function reachFeedback(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /^Enter code/ }))
    const field = screen.getByLabelText('Participant code')
    await user.type(field, 'A1-B8EFD9-00001-X')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByTestId('participant-code')
  }

  it('says the response does not exist, in red', async () => {
    const user = renderScreen()
    await reachFeedback(user)
    await answerRatings(user)

    failNextWrite()
    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))

    const alert = await screen.findByText(/Feedback not saved/)
    const banner = alert.closest('[data-slot="alert"]') as HTMLElement

    expect(banner.className).toContain('bg-danger-soft')
    expect(banner.textContent).toMatch(/does not exist yet/i)
    expect(await countFeedback(db)).toBe(0)
  })

  it('keeps every answer, and the identity, on screen', async () => {
    const user = renderScreen()
    await reachFeedback(user)
    await answerRatings(user, 6)
    const code = screen.getByTestId('participant-code').textContent

    failNextWrite()
    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))
    await screen.findByText(/Feedback not saved/)

    // Identity intact: not sent back to the scanner, not re-captured.
    expect(screen.getByTestId('participant-code').textContent).toBe(code)
    // Every rating still selected.
    expect(screen.getAllByText('6 / 7')).toHaveLength(RATING_QUESTIONS.length)
    expect(screen.queryByText('Not rated')).toBeNull()
  })

  it('saves on the next tap, without a second identity', async () => {
    const user = renderScreen()
    await reachFeedback(user)
    await answerRatings(user)

    failNextWrite()
    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))
    await screen.findByText(/Feedback not saved/)

    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))

    await screen.findByText('Feedback saved')
    expect(await countFeedback(db)).toBe(1)
  })
})

describe('a failed save on the contact path', () => {
  async function fillContact(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /^No QR or code/ }))
    await user.type(screen.getByLabelText(/^Name/), 'Ada Lovelace')
    await user.type(screen.getByLabelText(/^Email ID/), 'ada@example.com')
    await user.type(screen.getByLabelText(/^Phone Number/), '9876543210')
    await answerRatings(user, 7)
  }

  it('keeps the contact details as well as the answers', async () => {
    /*
     * The reason the terminal keeps `busy` inside `contact-entry` instead of
     * moving to a separate saving status: this form must never be unmounted
     * around a save.
     */
    const user = renderScreen()
    await fillContact(user)

    failNextWrite()
    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))
    await screen.findByText(/Feedback not saved/)

    expect(screen.getByLabelText(/^Name/)).toHaveProperty('value', 'Ada Lovelace')
    expect(screen.getByLabelText(/^Email ID/)).toHaveProperty(
      'value',
      'ada@example.com',
    )
    expect(screen.getByLabelText(/^Phone Number/)).toHaveProperty(
      'value',
      '9876543210',
    )
    expect(screen.getAllByText('7 / 7')).toHaveLength(RATING_QUESTIONS.length)
    expect(await countFeedback(db)).toBe(0)
  })

  it('is one tap from being saved after the problem clears', async () => {
    const user = renderScreen()
    await fillContact(user)

    failNextWrite()
    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))
    await screen.findByText(/Feedback not saved/)

    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))

    await screen.findByText('Feedback saved')
    expect(await countFeedback(db)).toBe(1)
  })

  it('has no local duplicate guard, deliberately', async () => {
    /*
     * The guard is a question about a public code and a contact capture has
     * none. Two riders can share a tablet, and a rider whose first response
     * failed to reach the server must not be refused by the desk. Whether two
     * contact responses are the same person is a question reconciliation
     * answers centrally, on the normalised phone and email pair.
     */
    const user = renderScreen()
    await fillContact(user)
    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))
    await screen.findByText('Feedback saved')

    await user.click(screen.getByRole('button', { name: 'Next rider' }))
    await fillContact(user)
    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))

    await screen.findByText('Feedback saved')
    expect(await countFeedback(db)).toBe(2)
  })
})

describe('the outcomes', () => {
  async function saveOneResponse(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /^Enter code/ }))
    await user.type(
      screen.getByLabelText('Participant code'),
      'A1-B8EFD9-00001-X',
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByTestId('participant-code')
    await answerRatings(user)
    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))
    await screen.findByText('Feedback saved')
  }

  it('clears the questionnaire on success', async () => {
    /*
     * A screen still full of answers reads as "not finished yet" from across a
     * stand, whatever it says at the top.
     */
    const user = renderScreen()
    await saveOneResponse(user)

    expect(document.querySelectorAll('[data-slot="rating-scale"]')).toHaveLength(
      0,
    )
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
    expect(
      screen.queryByRole('button', { name: 'Submit Feedback' }),
    ).toBeNull()
  })

  it('announces success and offers the next rider', async () => {
    const user = renderScreen()
    await saveOneResponse(user)

    const panel = screen.getByRole('status', { name: 'Feedback saved' })
    expect(panel.textContent).toMatch(/Nothing further is needed/i)
    expect(screen.getByRole('button', { name: 'Next rider' })).toBeDefined()
  })

  it('counts the response in the quiet footer', async () => {
    const user = renderScreen()
    await saveOneResponse(user)

    expect(
      screen.getByText(/Responses saved on this device . 1/),
    ).toBeDefined()
  })

  it('returns to the start when the next rider steps up', async () => {
    const user = renderScreen()
    await saveOneResponse(user)

    await user.click(screen.getByRole('button', { name: 'Next rider' }))

    // The camera was never started, so this falls back to idle, as the
    // terminal's `returnToScanner` specifies.
    expect(
      await screen.findByRole('button', { name: /^Scan QR/ }),
    ).toBeDefined()
  })

  it('treats an already-recorded rider as information, not an error', async () => {
    const user = renderScreen()
    await saveOneResponse(user)
    await user.click(screen.getByRole('button', { name: 'Next rider' }))

    await user.click(screen.getByRole('button', { name: /^Enter code/ }))
    await user.type(
      screen.getByLabelText('Participant code'),
      'A1-B8EFD9-00001-X',
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const panel = await screen.findByRole('status', {
      name: 'Feedback already recorded',
    })

    expect(panel.textContent).toMatch(/has not been changed/i)
    // Informational, never destructive.
    expect(panel.innerHTML).not.toContain('bg-danger-soft')
    expect(panel.innerHTML).toContain('bg-info-soft')
    // And the code, so staff can see which rider it means.
    expect(screen.getByTestId('participant-code').textContent).toBe(
      'A1-B8EFD9-00001-X',
    )
    expect(
      screen.getByRole('button', { name: /^Scan next rider/ }),
    ).toBeDefined()
    // The first response is untouched.
    expect(await countFeedback(db)).toBe(1)
  })
})

describe('while a save is in flight', () => {
  /*
   * Asserted on the form rather than by holding a Dexie write open. The
   * terminal's own suite already proves it reaches `saving` and refuses a
   * second submit; what this phase is responsible for is that the button says
   * so and cannot be pressed again.
   */
  it('disables the button and says what is happening', () => {
    render(<CampaignFeedbackForm busy onSubmit={vi.fn()} />)

    const saving = screen.getByRole('button', { name: /Saving/ })

    expect(saving).toHaveProperty('disabled', true)
    expect(saving.getAttribute('aria-busy')).toBe('true')
  })

  it('leaves every answer in place while it saves', () => {
    // `busy` disables the controls; it does not clear or unmount them.
    render(<CampaignFeedbackForm busy onSubmit={vi.fn()} />)

    expect(document.querySelectorAll('[data-slot="rating-scale"]')).toHaveLength(
      RATING_QUESTIONS.length,
    )
    for (const radio of document.querySelectorAll('[role="radio"]')) {
      expect(radio).toHaveProperty('disabled', true)
    }
  })
})
