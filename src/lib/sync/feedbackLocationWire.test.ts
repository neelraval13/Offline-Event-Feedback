import { describe, expect, it } from 'vitest'
import {
  feedbackWireSchema,
  MAX_BATCH_RECORDS,
  syncBatchSchema,
  SYNC_PROTOCOL_VERSION,
} from '../../../shared/sync/protocol'
import { MAX_LOCATION_LENGTH } from '../../../shared/campaign/flyingFlea'
import { toFeedbackWire } from './wire'
import type { FeedbackRecord } from '../../types'

/*
 * The capture location on the wire.
 *
 * Additive, and held to the rule that makes additive changes safe: a device
 * that has been offline all day running the previous build must still be able
 * to upload what it captured. That is why the field is optional here and
 * required in the application, and why this file spends as much effort on the
 * record that does NOT carry one.
 */

const BASE = {
  kind: 'feedback' as const,
  recordId: '019ffc65-4559-7125-9453-de82fb849ed8',
  eventId: 'ff-2026-09-20',
  eventDay: '2026-09-20',
  stationId: 'B1',
  deviceId: '11111111-2222-4333-8444-555555555555',
  formVersion: 'flying-flea-feedback-v1' as const,
  answers: {
    testRideExperience: 6,
    rotaryKnobUsage: 5,
    rideModesExperience: 6,
    overallExperienceRating: 7,
  },
  createdAt: '2026-09-20T11:00:00.000Z',
  updatedAt: '2026-09-20T11:00:00.000Z',
  revision: 1,
  syncStatus: 'pending' as const,
}

const QR = {
  captureMethod: 'qr' as const,
  publicCode: 'A1-B8EFD9-00001-X',
  participantId: '019ffc65-4559-7125-9453-e230415644f1',
}

describe('the feedback wire schema', () => {
  it('accepts a response carrying a city', () => {
    const parsed = feedbackWireSchema.safeParse({
      ...BASE,
      ...QR,
      location: 'Bengaluru',
    })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.location).toBe('Bengaluru')
  })

  it('accepts a response with no city at all', () => {
    /*
     * An August response, uploaded from a tablet that was never updated. This
     * is the case that decides whether the change is genuinely additive, and
     * the answer has to stay yes for as long as any device in the field might
     * still be holding one.
     */
    const parsed = feedbackWireSchema.safeParse({ ...BASE, ...QR })

    expect(parsed.success).toBe(true)
    expect(parsed.success && 'location' in parsed.data).toBe(false)
  })

  it('refuses a present-but-empty city', () => {
    // Absent and empty must not both be acceptable: one means "never captured"
    // and the other would be a city somebody failed to record.
    expect(
      feedbackWireSchema.safeParse({ ...BASE, ...QR, location: '' }).success,
    ).toBe(false)
  })

  it('refuses an explicit null, as every other optional does', () => {
    expect(
      feedbackWireSchema.safeParse({ ...BASE, ...QR, location: null }).success,
    ).toBe(false)
  })

  it('bounds the city by the same constant a registration uses', () => {
    const atLimit = 'x'.repeat(MAX_LOCATION_LENGTH)
    const overLimit = 'x'.repeat(MAX_LOCATION_LENGTH + 1)

    expect(
      feedbackWireSchema.safeParse({ ...BASE, ...QR, location: atLimit }).success,
    ).toBe(true)
    expect(
      feedbackWireSchema.safeParse({ ...BASE, ...QR, location: overLimit })
        .success,
    ).toBe(false)
  })

  it('accepts a venue this client would not offer', () => {
    /*
     * Deliberately not an enum of the current two cities. The server holds more
     * than one event, and an August record carrying `Richardson & Cruddas` has
     * to remain a valid record forever. What the client may CHOOSE is a
     * narrower question, answered in `src/config/eventLocations.ts`.
     */
    const parsed = feedbackWireSchema.safeParse({
      ...BASE,
      ...QR,
      location: 'Richardson & Cruddas',
    })

    expect(parsed.success).toBe(true)
  })

  it('takes no part in the identity rules', () => {
    /*
     * A location is not identity. It must be acceptable under all three capture
     * methods and required by none of them, which is what keeps it out of
     * `checkCaptureIdentity` entirely.
     */
    const shapes = [
      QR,
      { captureMethod: 'manual' as const, publicCode: 'A1-B8EFD9-00001-X' },
      {
        captureMethod: 'contact' as const,
        respondentName: 'Grace Hopper',
        respondentPhone: '9876543210',
        respondentEmail: 'grace@example.com',
      },
    ]

    for (const identity of shapes) {
      expect(
        feedbackWireSchema.safeParse({ ...BASE, ...identity, location: 'Hyderabad' })
          .success,
        `rejected ${identity.captureMethod} with a location`,
      ).toBe(true)
      expect(
        feedbackWireSchema.safeParse({ ...BASE, ...identity }).success,
        `rejected ${identity.captureMethod} without a location`,
      ).toBe(true)
    }
  })
})

describe('the protocol version', () => {
  it('is unchanged, because the change is additive', () => {
    /*
     * Bumping it would make every unsynced record on an un-updated tablet
     * unacceptable until somebody found that tablet, which is the one thing an
     * offline-first system must never require.
     */
    expect(SYNC_PROTOCOL_VERSION).toBe(1)
  })

  it('accepts a batch mixing records with and without a city', () => {
    // Exactly what a device holding both August and September records would
    // send, and what a September device sends after restoring an old backup.
    const parsed = syncBatchSchema.safeParse({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      batchId: '019ffc65-4559-7125-9453-de82fb849ed9',
      eventId: 'ff-2026-09-20',
      uploaderDeviceId: BASE.deviceId,
      records: [
        { ...BASE, ...QR, location: 'Bengaluru' },
        {
          ...BASE,
          ...QR,
          recordId: '019ffc65-4559-7125-9453-de82fb849eda',
          publicCode: 'A1-B8EFD9-00002-K',
        },
      ],
    })

    expect(parsed.success).toBe(true)
    expect(MAX_BATCH_RECORDS).toBeGreaterThan(2)
  })
})

describe('converting a local record for the wire', () => {
  it('carries the city when the record has one', () => {
    const wire = toFeedbackWire({ ...BASE, ...QR, location: 'Hyderabad' } as FeedbackRecord)

    expect(wire.location).toBe('Hyderabad')
    expect(feedbackWireSchema.safeParse(wire).success).toBe(true)
  })

  it('omits the key entirely when the record has none', () => {
    /*
     * Not `location: undefined`. The schema's optionals reject a key that is
     * present and empty, so spreading an undefined would stop an August record
     * uploading at all: the failure would look like a rejected batch rather
     * than like a missing field.
     */
    const wire = toFeedbackWire({ ...BASE, ...QR } as FeedbackRecord)

    expect('location' in wire).toBe(false)
    expect(feedbackWireSchema.safeParse(wire).success).toBe(true)
  })

  it('carries it on all three capture methods', () => {
    const contact = toFeedbackWire({
      ...BASE,
      captureMethod: 'contact',
      respondentName: 'Grace Hopper',
      respondentPhone: '9876543210',
      respondentEmail: 'grace@example.com',
      location: 'Hyderabad',
    } as FeedbackRecord)

    expect(contact.location).toBe('Hyderabad')
    // And the identity is still exactly the contact shape, with no sticker.
    expect(contact.publicCode).toBeUndefined()
    expect(contact.participantId).toBeUndefined()
    expect(feedbackWireSchema.safeParse(contact).success).toBe(true)
  })
})
