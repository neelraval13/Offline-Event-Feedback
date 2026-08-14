import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import {
  ChecksumException,
  FormatException,
  NotFoundException,
  Result,
} from '@zxing/library'
import { FeedbackScreen } from './FeedbackScreen'
import { createZxingScanner } from '../../lib/scanner'
import { EVENT_CONFIG } from '../../config/event'
import { answerCampaignFeedback } from '../campaign/flying-flea/testSupport'
import { FLYING_FLEA_CAMPAIGN } from '../campaign/flying-flea/config'
import { db } from '../../lib/storage'
import { countFeedback } from '../../lib/storage/feedback'
import { deriveIssuerCode } from '../../lib/identity/issuerCode'
import { formatPublicCode } from '../../lib/identity/publicCode'
import {
  buildQrPayload,
  serializeQrPayload,
} from '../../lib/identity/qrPayload'
import { newParticipantId } from '../../lib/identity/uuid'
import { deviceId, stationId } from '../../types'

/*
 * The Phase 3 field defect, end to end.
 *
 * Point B's camera "failed" on every device even though every piece of media
 * plumbing worked: permission granted, stream acquired, video playing at
 * 640x480. The cause was upstream of none of that — the decode callback treated
 * ZXing's ordinary "no QR in this frame" exception as a camera fault and pushed
 * the terminal into CAMERA_ERROR on the first frame it ever looked at.
 *
 * These tests wire the **real** ZXing adapter into the **real** screen and mock
 * only `decodeFromConstraints`, so the entire path under test is production
 * code: adapter classification, state machine, and UI.
 */

const A1 = {
  stationId: stationId('A1'),
  issuerCode: deriveIssuerCode(deviceId('11111111-2222-4333-8444-555555555555')),
}

type DecodeCallback = (
  result: Result | undefined,
  error: Error | undefined,
  controls: IScannerControls,
) => void

const originalMediaDevices = Object.getOwnPropertyDescriptor(
  navigator,
  'mediaDevices',
)

let callback: DecodeCallback
let controls: IScannerControls

function stickerPayload(): { publicCode: string; qr: string } {
  const publicCode = formatPublicCode(A1, 1)
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

beforeEach(async () => {
  await db.open()
  await Promise.all([db.feedback.clear(), db.registrations.clear()])

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  })

  controls = { stop: vi.fn() } as IScannerControls

  vi.spyOn(
    BrowserQRCodeReader.prototype,
    'decodeFromConstraints',
  ).mockImplementation(
    async (_constraints, _video, decodeCallback): Promise<IScannerControls> => {
      callback = decodeCallback as DecodeCallback
      return controls
    },
  )
})

afterEach(() => {
  cleanup()
  if (originalMediaDevices === undefined) {
    Reflect.deleteProperty(navigator, 'mediaDevices')
  } else {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
  }
  vi.restoreAllMocks()
})

/** Renders Point B against the genuine ZXing adapter. */
function renderScreen() {
  return render(<FeedbackScreen createScanner={createZxingScanner} />)
}

async function startScanner() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Start scanner' }))
  await screen.findByText(/Point the camera/)
  return user
}

/** Frames arrive from the camera, outside React's act scope. */
function frames(error: Error, count = 1): void {
  act(() => {
    for (let i = 0; i < count; i += 1) {
      callback(undefined, error, controls)
    }
  })
}

function decodedFrame(text: string): void {
  act(() => {
    callback({ getText: () => text } as Result, undefined, controls)
  })
}

function expectStillScanning(): void {
  expect(screen.queryByText('Camera unavailable')).toBeNull()
  expect(
    screen.queryByText('The scanner could not be started.'),
  ).toBeNull()
  expect(screen.getByText(/Point the camera/)).toBeDefined()
}

describe('ordinary frames with no QR in them', () => {
  it('leave the scanner running', async () => {
    renderScreen()
    await startScanner()

    frames(new NotFoundException())

    expectStillScanning()
  })

  it('do not stop decoding', async () => {
    renderScreen()
    await startScanner()

    frames(new NotFoundException(), 100)

    expect(controls.stop).not.toHaveBeenCalled()
    expectStillScanning()
  })

  it('survive a sustained run, as a camera on a desk produces', async () => {
    renderScreen()
    await startScanner()

    // Roughly a minute of pointing at nothing in particular.
    frames(new NotFoundException(), 1_800)

    expectStillScanning()
  })

  it('still let a real sticker through afterwards', async () => {
    const sticker = stickerPayload()
    renderScreen()
    const user = await startScanner()

    frames(new NotFoundException(), 250)
    expectStillScanning()

    decodedFrame(sticker.qr)

    // The whole point: the scanner was still alive to see it.
    expect(await screen.findByTestId('participant-code')).toHaveProperty(
      'textContent',
      sticker.publicCode,
    )

    await answerCampaignFeedback(user)
    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }))

    await screen.findByText(FLYING_FLEA_CAMPAIGN.thanks)
    expect(await countFeedback(db)).toBe(1)
  })
})

describe('candidate symbols that fail to validate', () => {
  it('a failed checksum leaves the scanner running', async () => {
    renderScreen()
    await startScanner()

    frames(new ChecksumException(), 20)

    expectStillScanning()
  })

  it('a failed format leaves the scanner running', async () => {
    renderScreen()
    await startScanner()

    frames(new FormatException(), 20)

    expectStillScanning()
  })

  it('a realistic mixed stream leaves the scanner running', async () => {
    // A sticker moving through frame: mostly nothing, occasionally a partial
    // symbol that cannot be resolved.
    renderScreen()
    await startScanner()

    act(() => {
      for (let i = 0; i < 300; i += 1) {
        const error =
          i % 17 === 0
            ? new ChecksumException()
            : i % 23 === 0
              ? new FormatException()
              : new NotFoundException()
        callback(undefined, error, controls)
      }
    })

    expectStillScanning()
  })

  it('never reports a decode miss to staff', async () => {
    renderScreen()
    await startScanner()

    frames(new NotFoundException(), 50)
    frames(new ChecksumException(), 50)
    frames(new FormatException(), 50)

    // No transient notice either: a frame that did not decode is not news.
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('genuine startup failure still reaches the camera error state', () => {
  it('shows Camera unavailable when the camera cannot be started', async () => {
    vi.spyOn(
      BrowserQRCodeReader.prototype,
      'decodeFromConstraints',
    ).mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    )

    renderScreen()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Start scanner' }))

    expect(await screen.findByText('Camera unavailable')).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Enter code manually' }),
    ).toBeDefined()
  })

  it('distinguishes a start failure from a decode miss', async () => {
    // The distinction the fix exists to make: one of these is a camera fault
    // and the other is a Tuesday.
    renderScreen()
    await startScanner()
    frames(new NotFoundException(), 500)
    expectStillScanning()

    cleanup()

    vi.spyOn(
      BrowserQRCodeReader.prototype,
      'decodeFromConstraints',
    ).mockRejectedValue(
      Object.assign(new Error('busy'), { name: 'NotReadableError' }),
    )

    renderScreen()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Start scanner' }))

    expect(await screen.findByText('Camera unavailable')).toBeDefined()
  })
})
