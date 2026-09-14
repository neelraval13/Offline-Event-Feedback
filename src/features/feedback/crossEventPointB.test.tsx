import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeedbackScreen } from './FeedbackScreen'
import { FakeScanner } from './testScanner'
import { usePointBTerminal } from './usePointBTerminal'
import { db, createFeedback, getOrCreateDeviceId } from '../../lib/storage'
import { deriveIssuerCode } from '../../lib/identity/issuerCode'
import { formatPublicCode } from '../../lib/identity/publicCode'
import { newParticipantId } from '../../lib/identity/uuid'
import { buildQrPayload, serializeQrPayload } from '../../lib/identity/qrPayload'
import { EVENT_CONFIG } from '../../config/event'
import { givenDeviceLocation } from '../../test/eventLocation'
import {
  deviceId as asDeviceId,
  eventDay,
  eventId,
  stationId,
  type FeedbackRecord,
} from '../../types'

/*
 * Point B on a device that also holds the previous event's responses, and the
 * one UX edge where a response could change city underneath a rider.
 */

const ISSUER = deriveIssuerCode(asDeviceId('11111111-2222-4333-8444-555555555555'))

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

function sticker(sequence: number) {
  const publicCode = formatPublicCode(
    { stationId: stationId('A1'), issuerCode: ISSUER },
    sequence,
  )
  return {
    publicCode,
    qr: serializeQrPayload(
      buildQrPayload({
        eventId: EVENT_CONFIG.eventId,
        participantId: newParticipantId(),
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

/** A response captured at the previous event, still on this browser. */
async function seedPreviousEventResponse(): Promise<FeedbackRecord> {
  const device = await getOrCreateDeviceId(db)
  return createFeedback(db, {
    eventId: eventId('ff-rc-2026-08-23'),
    eventDay: eventDay('2026-08-23'),
    stationId: stationId('B1'),
    deviceId: device,
    location: 'Bengaluru',
    identity: { captureMethod: 'manual', publicCode: formatPublicCode(
      { stationId: stationId('A1'), issuerCode: ISSUER }, 900,
    ) },
    formVersion: 'flying-flea-feedback-v1',
    answers: {
      testRideExperience: 5,
      rotaryKnobUsage: 5,
      rideModesExperience: 5,
      overallExperienceRating: 5,
    },
  })
}

describe('the rider-facing response count', () => {
  it('does not include the previous event’s responses', async () => {
    /*
     * The number answers "how is this event going". A device re-used without
     * being wiped would otherwise open the shift already reading one, which is
     * both wrong and quietly alarming to whoever is running the desk.
     */
    await seedPreviousEventResponse()
    givenDeviceLocation('Bengaluru')

    renderScreen()

    expect(
      await screen.findByText(
        /Responses saved on this device for this event: 0/,
      ),
    ).toBeDefined()
    // The previous event's response is still there; it is simply not counted.
    expect(await db.feedback.count()).toBe(1)
  })

  it('counts this event’s responses as they are saved', async () => {
    await seedPreviousEventResponse()
    givenDeviceLocation('Bengaluru')
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Start scanner' }))
    scanner.emit(sticker(1).qr)
    await screen.findByTestId('participant-code')
    await answerEverything(user)
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }))
    await screen.findByText(/Thank you/i)

    expect(
      await screen.findByText(
        /Responses saved on this device for this event: 1/,
      ),
    ).toBeDefined()
    expect(await db.feedback.count()).toBe(2)
  })
})

describe('the duplicate guard, across events', () => {
  /*
   * The guard answers "has this desk already recorded this rider at THIS
   * event", not "has this browser ever seen this code".
   *
   * The difference is not academic. A public code is station, issuer and
   * sequence, and the sequence restarts each event, so a Point A device that
   * was wiped and re-prepared issues the same codes again from 1. A Point B
   * device that was NOT wiped then meets a September sticker whose code matches
   * an August response it still holds. Unscoped, it refuses a real rider with
   * "Feedback already recorded" for a response nobody has given, and nothing on
   * screen explains why.
   *
   * Point A and Point B are different physical devices, so one being wiped
   * while the other is not is an ordinary outcome of a rollover, not a stretch.
   */

  /** The same printed code, issued at both events by the same Point A device. */
  const SHARED_CODE = formatPublicCode(
    { stationId: stationId('A1'), issuerCode: ISSUER },
    1,
  )

  async function seedAugustResponseFor(code: string) {
    const device = await getOrCreateDeviceId(db)
    return createFeedback(db, {
      eventId: eventId('ff-rc-2026-08-23'),
      eventDay: eventDay('2026-08-23'),
      stationId: stationId('B1'),
      deviceId: device,
      location: 'Bengaluru',
      identity: { captureMethod: 'manual', publicCode: code as never },
      formVersion: 'flying-flea-feedback-v1',
      answers: {
        testRideExperience: 4,
        rotaryKnobUsage: 4,
        rideModesExperience: 4,
        overallExperienceRating: 4,
      },
    })
  }

  it('does not block a September rider whose code an August response used', async () => {
    await seedAugustResponseFor(SHARED_CODE)
    givenDeviceLocation('Bengaluru')
    renderScreen()
    const user = userEvent.setup()

    // A September sticker: the QR names the September event, as a real one does.
    await user.click(screen.getByRole('button', { name: 'Start scanner' }))
    scanner.emit(
      serializeQrPayload(
        buildQrPayload({
          eventId: EVENT_CONFIG.eventId,
          participantId: newParticipantId(),
          publicCode: SHARED_CODE as never,
        }),
      ),
    )

    // The questionnaire, not the refusal.
    expect(await screen.findByTestId('participant-code')).toBeDefined()
    expect(screen.queryByText(/already recorded/i)).toBeNull()
  })

  it('saves that September response, with this event on it', async () => {
    await seedAugustResponseFor(SHARED_CODE)
    givenDeviceLocation('Hyderabad')
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Start scanner' }))
    scanner.emit(
      serializeQrPayload(
        buildQrPayload({
          eventId: EVENT_CONFIG.eventId,
          participantId: newParticipantId(),
          publicCode: SHARED_CODE as never,
        }),
      ),
    )
    await screen.findByTestId('participant-code')
    await answerEverything(user)
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }))
    await screen.findByText(/Thank you/i)

    const saved = await db.feedback
      .where('publicCode')
      .equals(SHARED_CODE)
      .toArray()

    // Two rows sharing a code, one per event, which is the truth about them.
    expect(saved).toHaveLength(2)
    const september = saved.find(
      (record) => record.eventId === EVENT_CONFIG.eventId,
    )
    expect(september?.location).toBe('Hyderabad')
  })

  it('still blocks a second attempt at the same code within this event', async () => {
    /*
     * The guard must not be weakened by the scoping. Scanning the same sticker
     * twice at one event is the mistake it exists to catch, and it is the
     * common one: an operator working through a queue.
     */
    await seedAugustResponseFor(SHARED_CODE)
    givenDeviceLocation('Bengaluru')
    renderScreen()
    const user = userEvent.setup()

    const payload = serializeQrPayload(
      buildQrPayload({
        eventId: EVENT_CONFIG.eventId,
        participantId: newParticipantId(),
        publicCode: SHARED_CODE as never,
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Start scanner' }))
    scanner.emit(payload)
    await screen.findByTestId('participant-code')
    await answerEverything(user)
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }))
    await screen.findByText(/Thank you/i)

    // The same sticker again, at the same event.
    await user.click(screen.getByRole('button', { name: 'Next rider' }))
    scanner.emit(payload)

    expect(await screen.findByText(/already recorded/i)).toBeDefined()

    // And nothing was written the second time.
    const saved = await db.feedback
      .where('publicCode')
      .equals(SHARED_CODE)
      .toArray()
    expect(saved.filter((r) => r.eventId === EVENT_CONFIG.eventId)).toHaveLength(
      1,
    )
  })
})

describe('changing the city while a rider is answering', () => {
  it('locks the selector once a response has started', async () => {
    /*
     * The rule is that a response is filed under the city it started in. The
     * selector is disabled while one is open so that the rule is visible, not
     * merely true: a live control here would tell the operator they had changed
     * something about the rider in front of them when they had not.
     */
    givenDeviceLocation('Bengaluru')
    renderScreen()
    const user = userEvent.setup()

    const selector = screen.getByTestId('point-b-location') as HTMLSelectElement
    expect(selector.disabled).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Start scanner' }))
    scanner.emit(sticker(2).qr)
    await screen.findByTestId('participant-code')

    expect(
      (screen.getByTestId('point-b-location') as HTMLSelectElement).disabled,
    ).toBe(true)
    expect(screen.getByTestId('point-b-location-locked').textContent).toContain(
      'Bengaluru',
    )
  })

  it('saves the city the response started in, even if the device is re-pointed', async () => {
    /*
     * The failure this prevents: a rider answers six questions in Bengaluru,
     * the device is changed to Hyderabad for some unrelated reason, and the
     * answers are filed under Hyderabad. Nothing on screen would show it and
     * nothing downstream could detect it.
     *
     * Driven through the hook rather than the screen, and deliberately. The
     * screen disables the selector once a response is open, so a test that went
     * through the UI could not change the location at all and would pass
     * whether or not anything was frozen. Calling `setLocation` directly is the
     * only way to prove the state machine itself holds the line, which is what
     * has to be true if the control is ever re-enabled or another caller
     * appears.
     */
    givenDeviceLocation('Bengaluru')

    const { result } = renderHook(() =>
      usePointBTerminal({ createScanner: () => scanner }),
    )

    await waitFor(() => expect(result.current.locationReady).toBe(true))

    // Start a response, by the path that needs no camera.
    await act(async () => {
      result.current.openManualEntry()
    })
    await act(async () => {
      await result.current.submitManualCode(sticker(3).publicCode)
    })
    await waitFor(() => expect(result.current.state.status).toBe('feedback'))

    // The device is re-pointed while the rider is part-way through.
    await act(async () => {
      result.current.setLocation('Hyderabad')
    })
    expect(result.current.location).toBe('Hyderabad')

    await act(async () => {
      await result.current.submitFeedback({
        testRideExperience: 5,
        rotaryKnobUsage: 5,
        rideModesExperience: 5,
        overallExperienceRating: 5,
      })
    })
    await waitFor(() => expect(result.current.state.status).toBe('success'))

    const [saved] = await db.feedback.toArray()
    // Filed where it started, not where the device now points.
    expect(saved?.location).toBe('Bengaluru')
  })

  it('frees the selector again once the response is finished', async () => {
    givenDeviceLocation('Bengaluru')
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Start scanner' }))
    scanner.emit(sticker(4).qr)
    await screen.findByTestId('participant-code')
    await answerEverything(user)
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }))
    await screen.findByText(/Thank you/i)

    expect(
      (screen.getByTestId('point-b-location') as HTMLSelectElement).disabled,
    ).toBe(false)
    expect(screen.queryByTestId('point-b-location-locked')).toBeNull()
  })

  it('applies a change made between riders to the next one', async () => {
    /*
     * The other half of the rule. Freezing must not mean the device is stuck:
     * a desk that moves between cities changes the selector after a rider and
     * the next response is filed under the new city.
     */
    givenDeviceLocation('Bengaluru')
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Start scanner' }))
    scanner.emit(sticker(5).qr)
    await screen.findByTestId('participant-code')
    await answerEverything(user)
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }))
    await screen.findByText(/Thank you/i)

    // Between riders, with the control live again.
    await user.selectOptions(screen.getByTestId('point-b-location'), 'Hyderabad')

    /*
     * "Next rider" resumes the authorised camera rather than returning to the
     * start screen, so the next sticker is simply scanned; there is no button
     * to press in between. That is the real flow at a desk.
     */
    await user.click(screen.getByRole('button', { name: 'Next rider' }))
    scanner.emit(sticker(6).qr)
    await screen.findByTestId('participant-code')
    await answerEverything(user)
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }))
    await screen.findByText(/Thank you/i)

    const saved = await db.feedback.orderBy('createdAt').toArray()
    expect(saved.map((record) => record.location)).toEqual([
      'Bengaluru',
      'Hyderabad',
    ])
  })

  it('locks the selector for the contact path too', async () => {
    // The direct path holds a name, a phone number, an email and six answers.
    // It is the flow with the most to lose from a silent change of city.
    givenDeviceLocation('Hyderabad')
    renderScreen()
    const user = userEvent.setup()

    await user.click(
      screen.getByRole('button', { name: 'Continue without QR or code' }),
    )

    expect(
      (screen.getByTestId('point-b-location') as HTMLSelectElement).disabled,
    ).toBe(true)

    await user.type(screen.getByLabelText(/^Name/), 'Grace Hopper')
    await user.type(screen.getByLabelText(/^Phone/), '9876543210')
    await user.type(screen.getByLabelText(/^Email/), 'grace@example.invalid')
    await answerEverything(user)

    givenDeviceLocation('Bengaluru')

    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }))
    await screen.findByText(/Thank you/i)

    const [saved] = await db.feedback.toArray()
    expect(saved?.location).toBe('Hyderabad')
  })
})
