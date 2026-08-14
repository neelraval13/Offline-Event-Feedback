import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeedbackScreen } from './FeedbackScreen'
import { FakeScanner } from './testScanner'
import { EVENT_CONFIG } from '../../config/event'
import {
  answerCampaignFeedback,
} from '../campaign/flying-flea/testSupport'
import { FLYING_FLEA_CAMPAIGN } from '../campaign/flying-flea/config'
import { db } from '../../lib/storage'
import { countFeedback } from '../../lib/storage/feedback'
import { OfflineEventDb } from '../../lib/storage/db'
import { deriveIssuerCode } from '../../lib/identity/issuerCode'
import { formatPublicCode } from '../../lib/identity/publicCode'
import {
  buildQrPayload,
  serializeQrPayload,
} from '../../lib/identity/qrPayload'
import { newParticipantId } from '../../lib/identity/uuid'
import {
  deviceId,
  eventId,
  stationId,
  type FeedbackRecord,
  type ParticipantId,
  type PublicParticipantCode,
} from '../../types'

const A1 = {
  stationId: stationId('A1'),
  issuerCode: deriveIssuerCode(deviceId('11111111-2222-4333-8444-555555555555')),
}
const B1 = { ...A1, stationId: stationId('B1') }

interface Sticker {
  readonly participantId: ParticipantId
  readonly publicCode: PublicParticipantCode
  readonly qr: string
}

/** A sticker as Point A would have printed it. */
function makeSticker(sequence = 1): Sticker {
  const participantId = newParticipantId()
  const publicCode = formatPublicCode(A1, sequence)

  return {
    participantId,
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

let scanner: FakeScanner

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
  return render(<FeedbackScreen createScanner={() => scanner} />)
}

async function startScanner() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Start scanner' }))
  await screen.findByText(/Point the camera/)
  return user
}

/** Delivers a decode the way a camera frame would: outside React's act scope. */
function emit(text: string) {
  act(() => {
    scanner.emit(text)
  })
}

async function answerAll(user: ReturnType<typeof userEvent.setup>) {
  await answerCampaignFeedback(user)
}

async function submitFeedback(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))
  await screen.findByText(FLYING_FLEA_CAMPAIGN.thanks)
}

/**
 * The save-failure notice.
 *
 * Queried by role rather than by text: the wording emphasises "not" with a
 * <strong>, so the sentence is split across elements and a text matcher cannot
 * span it.
 */
async function findSaveError(): Promise<HTMLElement> {
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toMatch(/was\s*not\s*saved/i)
  return alert
}

async function onlyRecord(): Promise<FeedbackRecord> {
  const records = await db.feedback.toArray()
  expect(records).toHaveLength(1)
  return records[0] as FeedbackRecord
}

describe('scanning a valid sticker', () => {
  it('opens the feedback form for the scanned participant', async () => {
    const sticker = makeSticker()
    renderScreen()
    await startScanner()

    emit(sticker.qr)

    expect(await screen.findByTestId('participant-code')).toHaveProperty(
      'textContent',
      sticker.publicCode,
    )
    expect(screen.getByRole('button', { name: 'Submit Feedback' })).toBeDefined()
  })

  it('stops decoding once an identity is accepted', async () => {
    renderScreen()
    await startScanner()

    emit(makeSticker().qr)
    await screen.findByTestId('participant-code')

    expect(scanner.paused).toBe(true)
  })

  it('accepts one identity however many frames decode the same sticker', async () => {
    const sticker = makeSticker()
    renderScreen()
    const user = await startScanner()

    // Forty frames of the same stationary sticker, delivered regardless of
    // pause: exactly what a real camera does.
    act(() => {
      for (let i = 0; i < 40; i += 1) {
        scanner.emitRaw(sticker.qr)
      }
    })

    await screen.findByTestId('participant-code')
    expect(screen.getAllByTestId('participant-code')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Submit Feedback' })).toHaveLength(1)

    await answerAll(user)
    await submitFeedback(user)
    expect(await countFeedback(db)).toBe(1)
  })
})

describe('rejecting a QR that is not a participant sticker', () => {
  const CASES: readonly { readonly label: string; readonly decoded: string }[] = [
    { label: 'malformed JSON', decoded: '{"v":1,' },
    { label: 'an unrelated QR', decoded: 'https://example.com/menu' },
    {
      label: 'an unsupported version',
      decoded: JSON.stringify({
        v: 99,
        event: EVENT_CONFIG.eventId,
        participant: newParticipantId(),
        code: formatPublicCode(A1, 1),
      }),
    },
    {
      label: 'another event',
      decoded: serializeQrPayload(
        buildQrPayload({
          eventId: eventId('evt-last-year'),
          participantId: newParticipantId(),
          publicCode: formatPublicCode(A1, 1),
        }),
      ),
    },
    {
      label: 'the wrong issuing station',
      decoded: serializeQrPayload(
        buildQrPayload({
          eventId: EVENT_CONFIG.eventId,
          participantId: newParticipantId(),
          publicCode: formatPublicCode(B1, 1),
        }),
      ),
    },
    {
      label: 'a broken checksum',
      decoded: JSON.stringify({
        v: 1,
        event: EVENT_CONFIG.eventId,
        participant: newParticipantId(),
        code: 'A1-B8EFD9-00001-Z',
      }),
    },
  ]

  it.each(CASES)('rejects $label without opening the form', async ({ decoded }) => {
    renderScreen()
    await startScanner()

    emit(decoded)

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.queryByTestId('participant-code')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Submit Feedback' })).toBeNull()
    expect(await countFeedback(db)).toBe(0)
  })

  it('keeps scanning after a rejection', async () => {
    const sticker = makeSticker()
    renderScreen()
    await startScanner()

    emit('https://example.com/menu')
    await screen.findByRole('alert')
    expect(scanner.paused).toBe(false)

    // The next sticker is still picked up without restarting anything.
    emit(sticker.qr)
    expect(await screen.findByTestId('participant-code')).toHaveProperty(
      'textContent',
      sticker.publicCode,
    )
  })

  it('shows no technical detail', async () => {
    renderScreen()
    await startScanner()

    emit('{"v":1,')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      'This QR is not a valid participant sticker for this event.',
    )
  })
})

describe('manual code entry', () => {
  it('is offered before the camera is ever started', () => {
    renderScreen()
    expect(
      screen.getByRole('button', { name: 'Enter code manually' }),
    ).toBeDefined()
  })

  it('accepts a valid printed code', async () => {
    const code = formatPublicCode(A1, 6)
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Enter code manually' }))
    await user.type(screen.getByLabelText('Participant code'), code)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByTestId('participant-code')).toHaveProperty(
      'textContent',
      code,
    )
  })

  it('normalises what staff types', async () => {
    const code = formatPublicCode(A1, 6)
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Enter code manually' }))
    await user.type(
      screen.getByLabelText('Participant code'),
      code.toLowerCase().replace(/-/g, ' '),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByTestId('participant-code')).toHaveProperty(
      'textContent',
      code,
    )
  })

  it('rejects a bad check character and stays on the form', async () => {
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Enter code manually' }))
    await user.type(screen.getByLabelText('Participant code'), 'A1-B8EFD9-00001-Z')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.queryByTestId('participant-code')).toBeNull()
    expect(screen.getByLabelText('Participant code')).toBeDefined()
  })

  it('rejects a code from the feedback station', async () => {
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Enter code manually' }))
    await user.type(
      screen.getByLabelText('Participant code'),
      formatPublicCode(B1, 1),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'This code was not issued by the registration desk.',
    )
  })

  it('remains available when the camera has failed', async () => {
    scanner.startFailure = {
      kind: 'permission-denied',
      message: 'Camera access was refused.',
    }
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Start scanner' }))
    await screen.findByText('Camera unavailable')

    await user.click(screen.getByRole('button', { name: 'Enter code manually' }))
    await user.type(
      screen.getByLabelText('Participant code'),
      formatPublicCode(A1, 3),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByTestId('participant-code')).toBeDefined()
  })
})

describe('questionnaire', () => {
  it('refuses to submit until the required questions are answered', async () => {
    renderScreen()
    const user = await startScanner()
    emit(makeSticker().qr)
    await screen.findByTestId('participant-code')

    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))

    // One per unanswered rating question: the campaign has four.
    expect(await screen.findAllByRole('alert')).toHaveLength(4)
    expect(await countFeedback(db)).toBe(0)
    expect(screen.queryByText(FLYING_FLEA_CAMPAIGN.thanks)).toBeNull()
  })

  it('treats comments as optional', async () => {
    renderScreen()
    const user = await startScanner()
    emit(makeSticker().qr)
    await screen.findByTestId('participant-code')

    await answerAll(user)
    await submitFeedback(user)

    const record = await onlyRecord()
    expect('topThreeFeatures' in record.answers).toBe(false)
    expect('overallExperienceComments' in record.answers).toBe(false)
  })

  it('persists canonical values and the questionnaire version', async () => {
    renderScreen()
    const user = await startScanner()
    emit(makeSticker().qr)
    await screen.findByTestId('participant-code')

    await answerCampaignFeedback(user, [2, 3, 5, 7])
    await user.type(
      screen.getByLabelText(
        FLYING_FLEA_CAMPAIGN.textQuestions[1]?.prompt ?? '',
      ),
      '  Queue was long.  ',
    )
    await submitFeedback(user)

    const record = await onlyRecord()
    expect(record.formVersion).toBe('flying-flea-feedback-v1')
    expect(record.answers).toEqual({
      testRideExperience: 2,
      rotaryKnobUsage: 3,
      rideModesExperience: 5,
      overallExperienceRating: 7,
      overallExperienceComments: 'Queue was long.',
    })
  })
})

describe('persistence', () => {
  it('stores a QR capture with its participant ID', async () => {
    const sticker = makeSticker()
    renderScreen()
    const user = await startScanner()
    emit(sticker.qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await submitFeedback(user)

    const record = await onlyRecord()
    expect(record.captureMethod).toBe('qr')
    expect(record.participantId).toBe(sticker.participantId)
    expect(record.publicCode).toBe(sticker.publicCode)
  })

  it('stores a manual capture with no participant ID', async () => {
    const code = formatPublicCode(A1, 9)
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Enter code manually' }))
    await user.type(screen.getByLabelText('Participant code'), code)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await submitFeedback(user)

    const record = await onlyRecord()
    expect(record.captureMethod).toBe('manual')
    expect(record.publicCode).toBe(code)
    expect(record.participantId).toBeUndefined()
    expect(Object.hasOwn(record, 'participantId')).toBe(false)
  })

  it('stamps Point B provenance', async () => {
    renderScreen()
    const user = await startScanner()
    emit(makeSticker().qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await submitFeedback(user)

    const record = await onlyRecord()
    expect(record.kind).toBe('feedback')
    expect(record.stationId).toBe('B1')
    expect(record.eventId).toBe(EVENT_CONFIG.eventId)
    expect(record.eventDay).toBe(EVENT_CONFIG.eventDay)
    expect(record.deviceId).toMatch(/^[0-9a-f-]{36}$/)
    expect(record.syncStatus).toBe('pending')
    expect(record.revision).toBe(1)
  })

  it('survives a database reopen', async () => {
    renderScreen()
    const user = await startScanner()
    emit(makeSticker().qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await submitFeedback(user)
    const record = await onlyRecord()

    db.close()
    const reopened = new OfflineEventDb(db.name)
    try {
      expect(await reopened.feedback.get(record.recordId)).toEqual(record)
    } finally {
      reopened.close()
    }
  })

  it('records only once when Submit is tapped repeatedly', async () => {
    renderScreen()
    const user = await startScanner()
    emit(makeSticker().qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)

    const submit = screen.getByRole('button', { name: 'Submit Feedback' })
    await Promise.all([user.click(submit), user.click(submit), user.click(submit)])

    await screen.findByText(FLYING_FLEA_CAMPAIGN.thanks)
    expect(await countFeedback(db)).toBe(1)
  })
})

describe('same-device duplicate', () => {
  it('refuses a second response and keeps the first', async () => {
    const sticker = makeSticker()
    renderScreen()
    const user = await startScanner()

    emit(sticker.qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await submitFeedback(user)
    const first = await onlyRecord()

    await user.click(screen.getByRole('button', { name: 'Next rider' }))
    emit(sticker.qr)

    expect(
      await screen.findByText('Feedback already recorded on this device'),
    ).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Submit Feedback' })).toBeNull()
    expect(await onlyRecord()).toEqual(first)
  })

  it('refuses a duplicate reached by manual entry too', async () => {
    const code = formatPublicCode(A1, 4)
    renderScreen()
    const user = userEvent.setup()

    for (const attempt of [1, 2]) {
      await user.click(
        screen.getByRole('button', { name: 'Enter code manually' }),
      )
      await user.type(screen.getByLabelText('Participant code'), code)
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      if (attempt === 1) {
        await screen.findByTestId('participant-code')
        await answerAll(user)
        await submitFeedback(user)
        await user.click(screen.getByRole('button', { name: 'Next rider' }))
      }
    }

    expect(
      await screen.findByText('Feedback already recorded on this device'),
    ).toBeDefined()
    expect(await countFeedback(db)).toBe(1)
  })

  it('shows the code so staff can see which participant it means', async () => {
    const sticker = makeSticker()
    renderScreen()
    const user = await startScanner()
    emit(sticker.qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await submitFeedback(user)
    await user.click(screen.getByRole('button', { name: 'Next rider' }))

    emit(sticker.qr)
    await screen.findByText('Feedback already recorded on this device')

    expect(screen.getByTestId('participant-code')).toHaveProperty(
      'textContent',
      sticker.publicCode,
    )
  })
})

describe('storage failure', () => {
  it('keeps the answers and does not report success', async () => {
    vi.spyOn(db.feedback, 'add').mockRejectedValue(new Error('QuotaExceededError'))

    renderScreen()
    const user = await startScanner()
    emit(makeSticker().qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))

    await findSaveError()
    expect(screen.queryByText(FLYING_FLEA_CAMPAIGN.thanks)).toBeNull()
    expect(await countFeedback(db)).toBe(0)

    // Every answer is still selected, and the form is still here.
    expect(
      screen
        .getAllByRole('radio', { name: 'Rate 4 out of 7' })[0]
        ?.getAttribute('aria-checked'),
    ).toBe('true')
    expect(screen.getByRole('button', { name: 'Submit Feedback' })).toBeDefined()
  })

  it('does not resume the scanner', async () => {
    vi.spyOn(db.feedback, 'add').mockRejectedValue(new Error('QuotaExceededError'))

    renderScreen()
    const user = await startScanner()
    emit(makeSticker().qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))
    await findSaveError()

    expect(scanner.paused).toBe(true)
  })

  it('saves once the storage problem clears, without a second identity', async () => {
    const sticker = makeSticker()
    const add = vi
      .spyOn(db.feedback, 'add')
      .mockRejectedValueOnce(new Error('QuotaExceededError'))

    renderScreen()
    const user = await startScanner()
    emit(sticker.qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))
    await findSaveError()

    add.mockRestore()
    await submitFeedback(user)

    const record = await onlyRecord()
    expect(record.publicCode).toBe(sticker.publicCode)
    expect(record.participantId).toBe(sticker.participantId)
  })
})

describe('next participant', () => {
  it('resumes the existing camera rather than restarting it', async () => {
    renderScreen()
    const user = await startScanner()
    emit(makeSticker().qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await submitFeedback(user)

    await user.click(screen.getByRole('button', { name: 'Next rider' }))

    await screen.findByText(/Point the camera/)
    expect(scanner.paused).toBe(false)
    // Reused, not re-authorised: staff is not asked for permission again.
    expect(scanner.startCalls).toBe(1)
    expect(scanner.disposed).toBe(false)
  })

  it('clears the previous answers', async () => {
    renderScreen()
    const user = await startScanner()
    emit(makeSticker(1).qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await submitFeedback(user)
    await user.click(screen.getByRole('button', { name: 'Next rider' }))

    emit(makeSticker(2).qr)
    await screen.findByTestId('participant-code')

    expect(
      screen
        .getAllByRole('radio', { name: 'Rate 4 out of 7' })[0]
        ?.getAttribute('aria-checked'),
    ).toBe('false')
    expect(
      screen.getByLabelText(FLYING_FLEA_CAMPAIGN.textQuestions[0]?.prompt ?? ''),
    ).toHaveProperty('value', '')
  })

  it('keeps every earlier record', async () => {
    renderScreen()
    const user = await startScanner()

    for (const sequence of [1, 2, 3]) {
      emit(makeSticker(sequence).qr)
      await screen.findByTestId('participant-code')
      await answerAll(user)
      await submitFeedback(user)
      await user.click(screen.getByRole('button', { name: 'Next rider' }))
    }

    expect(await countFeedback(db)).toBe(3)
  })

  it('reports how many responses this device holds', async () => {
    renderScreen()
    const user = await startScanner()
    emit(makeSticker().qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await submitFeedback(user)

    await waitFor(() =>
      expect(
        screen.getByText(/Responses saved on this device: 1/),
      ).toBeDefined(),
    )
  })
})

describe('camera lifecycle', () => {
  it('starts only when staff asks', () => {
    renderScreen()
    expect(scanner.startCalls).toBe(0)
  })

  it('surfaces a refused permission with manual entry still offered', async () => {
    scanner.startFailure = {
      kind: 'permission-denied',
      message: 'Camera access was refused.',
    }
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Start scanner' }))

    expect(await screen.findByText('Camera unavailable')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Try camera again' })).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Enter code manually' }),
    ).toBeDefined()
  })

  it('can retry the camera after a failure', async () => {
    scanner.startFailure = { kind: 'camera-busy', message: 'Camera is busy.' }
    renderScreen()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Start scanner' }))
    await screen.findByText('Camera unavailable')

    scanner.startFailure = null
    await user.click(screen.getByRole('button', { name: 'Try camera again' }))

    await screen.findByText(/Point the camera/)
    expect(scanner.running).toBe(true)
  })

  it('surfaces a camera that dies mid-shift', async () => {
    renderScreen()
    await startScanner()

    act(() => {
      scanner.fail({ kind: 'failed', message: 'The scanner stopped.' })
    })

    expect(await screen.findByText('Camera unavailable')).toBeDefined()
  })

  it('releases the camera when Point B is left', async () => {
    const { unmount } = renderScreen()
    await startScanner()
    expect(scanner.running).toBe(true)

    unmount()

    await waitFor(() => expect(scanner.disposed).toBe(true))
    expect(scanner.disposeCalls).toBe(1)
  })
})

describe('privacy at Point B', () => {
  it('never displays participant PII', async () => {
    // Point A's record for this participant exists on this test database; Point
    // B must not reach for it. In the field it would not even be here.
    const sticker = makeSticker()
    await db.registrations.add({
      kind: 'registration',
      recordId: crypto.randomUUID() as never,
      eventId: EVENT_CONFIG.eventId,
      eventDay: EVENT_CONFIG.eventDay,
      stationId: stationId('A1'),
      deviceId: deviceId('device-a'),
      createdAt: '2026-01-01T09:00:00.000Z' as never,
      updatedAt: '2026-01-01T09:00:00.000Z' as never,
      revision: 1,
      syncStatus: 'pending',
      participantId: sticker.participantId,
      publicCode: sticker.publicCode,
      name: 'Ada Lovelace',
      phone: '+44 20 7946 0958',
      email: 'ada@example.com',
    })

    const { container } = renderScreen()
    const user = await startScanner()
    emit(sticker.qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await submitFeedback(user)

    for (const secret of ['Ada', 'Lovelace', '7946', 'example.com']) {
      expect(container.textContent).not.toContain(secret)
    }
  })

  it('stores no PII on the feedback record', async () => {
    renderScreen()
    const user = await startScanner()
    emit(makeSticker().qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await submitFeedback(user)

    const record = await onlyRecord()
    expect(Object.keys(record).sort()).toEqual([
      'answers',
      'captureMethod',
      'createdAt',
      'deviceId',
      'eventDay',
      'eventId',
      'formVersion',
      'kind',
      'participantId',
      'publicCode',
      'recordId',
      'revision',
      'stationId',
      'syncStatus',
      'updatedAt',
    ])
  })

  it('works with no registrations on this device at all', async () => {
    // The real Point B condition: it has never seen Point A's database.
    expect(await db.registrations.count()).toBe(0)

    renderScreen()
    const user = await startScanner()
    emit(makeSticker().qr)
    await screen.findByTestId('participant-code')
    await answerAll(user)
    await submitFeedback(user)

    expect(await countFeedback(db)).toBe(1)
  })
})
