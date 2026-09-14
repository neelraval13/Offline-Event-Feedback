import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeedbackScreen } from './FeedbackScreen'
import { FakeScanner } from './testScanner'
import { db } from '../../lib/storage'
import { deriveIssuerCode } from '../../lib/identity/issuerCode'
import { formatPublicCode } from '../../lib/identity/publicCode'
import { newParticipantId } from '../../lib/identity/uuid'
import { buildQrPayload, serializeQrPayload } from '../../lib/identity/qrPayload'
import { EVENT_CONFIG } from '../../config/event'
import {
  givenDeviceLocation,
  givenNoDeviceLocation,
  givenPreviousEventLocation,
  storedLocationRaw,
} from '../../test/eventLocation'
import { deviceId, stationId, type FeedbackRecord } from '../../types'

/*
 * Point B and the two cities.
 *
 * Every response carries the city it was captured in, whichever way its
 * identity was obtained. The contact path is the reason it has to: a scanned or
 * typed response points at a registration whose city could in principle be read
 * later, but a direct response points at nothing at all, so if the city is not
 * on the response it is gone.
 *
 * The gate here is harder than Point A's, and deliberately. Point A's operator
 * types for a minute and can be told at submit; Point B's rider answers six
 * questions in under a minute and would have to answer them all again.
 */

const ISSUER = deriveIssuerCode(deviceId('11111111-2222-4333-8444-555555555555'))

let scanner: FakeScanner

beforeEach(async () => {
  window.localStorage.clear()
  await db.open()
  await Promise.all([db.feedback.clear(), db.registrations.clear()])
  scanner = new FakeScanner()
})

afterEach(() => {
  cleanup()
})

function renderScreen() {
  return render(<FeedbackScreen createScanner={() => scanner} />)
}

function sticker(sequence = 1) {
  const participantId = newParticipantId()
  const publicCode = formatPublicCode(
    { stationId: stationId('A1'), issuerCode: ISSUER },
    sequence,
  )
  return {
    publicCode,
    qr: serializeQrPayload(
      buildQrPayload({
        eventId: EVENT_CONFIG.eventId,
        participantId,
        publicCode,
      }),
    ),
  }
}

async function answerEverything(user: ReturnType<typeof userEvent.setup>) {
  for (const group of screen.getAllByRole('radiogroup')) {
    await user.click(within(group).getByRole('radio', { name: 'Rate 5 out of 7' }))
  }
}

async function onlyResponse(): Promise<FeedbackRecord> {
  const all = await db.feedback.toArray()
  expect(all).toHaveLength(1)
  return all[0] as FeedbackRecord
}

describe('a device that has not been told where it is', () => {
  it('offers no way to start a response at all', () => {
    /*
     * Not a warning beside a working button. Every way in is withheld, because
     * discovering the problem after a rider has answered six questions means
     * asking them to do it again.
     */
    givenNoDeviceLocation()
    renderScreen()

    expect(screen.queryByRole('button', { name: 'Start scanner' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Enter code manually' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Continue without QR or code' }),
    ).toBeNull()
  })

  it('says what to do, as an instruction rather than an error', () => {
    givenNoDeviceLocation()
    renderScreen()

    const notice = screen.getByTestId('point-b-location-required')
    expect(notice.textContent).toContain('Choose the event location')
    // Nothing has gone wrong: a fresh device simply has not been set up yet.
    expect(notice.getAttribute('role')).toBe('status')
  })

  it('opens the selector with nothing chosen', () => {
    givenNoDeviceLocation()
    renderScreen()

    expect(
      (screen.getByTestId('point-b-location') as HTMLSelectElement).value,
    ).toBe('')
  })

  it('does not inherit the previous event’s venue', () => {
    givenPreviousEventLocation('ff-rc-2026-08-23', 'Richardson & Cruddas')
    renderScreen()

    expect(
      (screen.getByTestId('point-b-location') as HTMLSelectElement).value,
    ).toBe('')
    expect(screen.queryByRole('button', { name: 'Start scanner' })).toBeNull()
  })

  it('opens up as soon as a city is chosen', async () => {
    givenNoDeviceLocation()
    renderScreen()
    const user = userEvent.setup()

    await user.selectOptions(screen.getByTestId('point-b-location'), 'Hyderabad')

    expect(
      await screen.findByRole('button', { name: 'Start scanner' }),
    ).toBeDefined()
    expect(storedLocationRaw()).toBe('Hyderabad')
  })
})

describe('the city on a saved response', () => {
  it('is stamped on a QR capture', async () => {
    givenDeviceLocation('Bengaluru')
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Start scanner' }))
    scanner.emit(sticker().qr)
    await screen.findByTestId('participant-code')
    await answerEverything(user)
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }))
    await screen.findByText(/Thank you/i)

    const record = await onlyResponse()
    expect(record.captureMethod).toBe('qr')
    expect(record.location).toBe('Bengaluru')
  })

  it('is stamped on a manually typed code', async () => {
    givenDeviceLocation('Hyderabad')
    renderScreen()
    const user = userEvent.setup()

    await user.click(
      screen.getByRole('button', { name: 'Enter code manually' }),
    )
    await user.type(
      screen.getByLabelText('Participant code'),
      sticker(2).publicCode,
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByTestId('participant-code')
    await answerEverything(user)
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }))
    await screen.findByText(/Thank you/i)

    const record = await onlyResponse()
    expect(record.captureMethod).toBe('manual')
    expect(record.location).toBe('Hyderabad')
  })

  it('is stamped on a direct contact response, which has nothing else', async () => {
    /*
     * The case the whole field exists for. This response matches no
     * registration, so there is no second row anywhere that could say which
     * city it came from. The value on the record is the only account of it.
     */
    givenDeviceLocation('Hyderabad')
    renderScreen()
    const user = userEvent.setup()

    await user.click(
      screen.getByRole('button', { name: 'Continue without QR or code' }),
    )
    await user.type(screen.getByLabelText(/^Name/), 'Grace Hopper')
    await user.type(screen.getByLabelText(/^Phone/), '9876543210')
    await user.type(screen.getByLabelText(/^Email/), 'grace@example.com')
    await answerEverything(user)
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }))
    await screen.findByText(/Thank you/i)

    const record = await onlyResponse()
    expect(record.captureMethod).toBe('contact')
    expect(record.location).toBe('Hyderabad')
  })

  it('keeps the city between riders without re-asking', async () => {
    givenDeviceLocation('Bengaluru')
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Start scanner' }))
    scanner.emit(sticker(3).qr)
    await screen.findByTestId('participant-code')
    await answerEverything(user)
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }))
    await screen.findByText(/Thank you/i)

    // The selector is still on screen and still set, so the next rider needs
    // no setup and the operator can still see which city is being recorded.
    expect(
      (screen.getByTestId('point-b-location') as HTMLSelectElement).value,
    ).toBe('Bengaluru')
  })
})

describe('the city is not identity', () => {
  it('leaves the contact identity shape exactly as it was', async () => {
    /*
     * A location says where the desk was, not who the rider is. Putting it
     * inside the identity would have made it a fourth thing reconciliation
     * matches on, which is precisely wrong: two riders in Bengaluru are not one
     * person, and the same rider in Hyderabad is not a different one.
     *
     * The three respondent fields are therefore asserted to be exactly what
     * they were before this change, with the city sitting beside them.
     */
    givenDeviceLocation('Bengaluru')
    renderScreen()
    const user = userEvent.setup()

    await user.click(
      screen.getByRole('button', { name: 'Continue without QR or code' }),
    )
    await user.type(screen.getByLabelText(/^Name/), 'Grace Hopper')
    await user.type(screen.getByLabelText(/^Phone/), '9876543210')
    await user.type(screen.getByLabelText(/^Email/), 'grace@example.com')
    await answerEverything(user)
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }))
    await screen.findByText(/Thank you/i)

    const record = await onlyResponse()

    expect(record).toMatchObject({
      captureMethod: 'contact',
      respondentName: 'Grace Hopper',
      respondentPhone: '9876543210',
      respondentEmail: 'grace@example.com',
    })
    // Still no fabricated sticker identity, exactly as before.
    expect(Object.hasOwn(record, 'publicCode')).toBe(false)
    expect(Object.hasOwn(record, 'participantId')).toBe(false)
    // And the city is a sibling of those fields, not one of them.
    expect(record.location).toBe('Bengaluru')
  })
})
