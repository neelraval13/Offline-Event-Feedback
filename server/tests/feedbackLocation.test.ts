import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { createMemoryStore, type MemoryStore } from './memoryStore.js'
import { hashDeviceToken } from '../auth/tokens.js'
import {
  batch,
  contactFeedback,
  DEVICE_A,
  EVENT_ID,
  feedback,
  publicCodeFor,
} from './fixtures.js'
import type { SyncBatchResponse } from '../../shared/sync/protocol.js'

/*
 * The capture location, from the wire to the store.
 *
 * Three things are worth proving here and nowhere else:
 *
 *   1. a location that arrives is kept, on every capture method
 *   2. a retry carrying the same location is `already_current`, so the device
 *      stops resending it, and a genuinely different one is a conflict
 *   3. a record with no location at all is still accepted, because a tablet
 *      that has been offline since August must be able to hand over what it
 *      holds
 *
 * The last is the one that would be quietly broken by making the column
 * required, and the one nobody would notice until an event.
 */

const ENROLLMENT_SECRET = 'a-shared-enrolment-code'
const TOKEN = 'a-device-token-for-tests'

let store: MemoryStore
let app: ReturnType<typeof createApp>

beforeEach(() => {
  store = createMemoryStore()
  app = createApp({
    store,
    enrollmentSecret: ENROLLMENT_SECRET,
    allowedOrigins: [],
    log: () => {},
  })

  // Through the store's own enrolment, rather than by writing its map: the key
  // format is the store's business, and a test that copied it would break the
  // day it changed for a reason nothing to do with this file.
  void store.enrollDevice({
    eventId: EVENT_ID,
    uploaderDeviceId: DEVICE_A,
    tokenHash: hashDeviceToken(TOKEN),
  })
})

async function upload(records: readonly unknown[]): Promise<SyncBatchResponse> {
  const response = await app.request('/v1/sync/batch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(batch(records as never)),
  })

  expect(response.status).toBe(200)
  return (await response.json()) as SyncBatchResponse
}

function statusOf(result: SyncBatchResponse, recordId: string): string {
  const found = result.results.find((entry) => entry.recordId === recordId)
  expect(found, `no result for ${recordId}`).toBeDefined()
  return found?.status as string
}

describe('persisting the capture location', () => {
  it('keeps it on a scanned response', async () => {
    const record = feedback({ location: 'Bengaluru' })

    expect(statusOf(await upload([record]), record.recordId)).toBe('accepted')
    expect((await store.getFeedback(record.recordId))?.location).toBe('Bengaluru')
  })

  it('keeps it on a manually typed response', async () => {
    const record = feedback({
      captureMethod: 'manual',
      participantId: undefined,
      publicCode: publicCodeFor(2),
      location: 'Hyderabad',
    })

    expect(statusOf(await upload([record]), record.recordId)).toBe('accepted')
    expect((await store.getFeedback(record.recordId))?.location).toBe('Hyderabad')
  })

  it('keeps it on a direct contact response', async () => {
    /*
     * The one that cannot be recovered any other way. A direct response matches
     * no registration, so if the server drops this field the city is gone from
     * the system entirely.
     */
    const record = contactFeedback({ location: 'Hyderabad' })

    expect(statusOf(await upload([record]), record.recordId)).toBe('accepted')

    const stored = await store.getFeedback(record.recordId)
    expect(stored?.location).toBe('Hyderabad')
    // And the identity is untouched by any of this.
    expect(stored?.captureMethod).toBe('contact')
    expect(stored?.publicCode).toBeUndefined()
    expect(stored?.participantId).toBeUndefined()
  })

  it('accepts a response with no location at all', async () => {
    /*
     * An August record from a tablet nobody updated. Accepted, and stored with
     * no location rather than with a defaulted one: NULL means "not captured",
     * and inventing a city would be indistinguishable afterwards from a real
     * one.
     */
    const record = feedback()

    expect(statusOf(await upload([record]), record.recordId)).toBe('accepted')

    const stored = await store.getFeedback(record.recordId)
    expect(stored).not.toBeNull()
    expect(stored?.location).toBeUndefined()
  })

  it('accepts a batch mixing both kinds', async () => {
    const withCity = feedback({ location: 'Bengaluru' })
    const without = feedback({ publicCode: publicCodeFor(3) })

    const result = await upload([withCity, without])

    expect(statusOf(result, withCity.recordId)).toBe('accepted')
    expect(statusOf(result, without.recordId)).toBe('accepted')
  })
})

describe('re-delivery', () => {
  it('is already_current when the same location comes back', async () => {
    /*
     * The property that lets a device stop resending. A retry of a request
     * whose response was lost must be acknowledged, not treated as a conflict,
     * or the record cycles forever and the operator sees a permanent error on a
     * record that arrived correctly the first time.
     */
    const record = feedback({ location: 'Bengaluru' })

    expect(statusOf(await upload([record]), record.recordId)).toBe('accepted')
    expect(statusOf(await upload([record]), record.recordId)).toBe(
      'already_current',
    )
  })

  it('is already_current for a record that never had one', async () => {
    // The same guarantee for August records: `undefined` equals `undefined`.
    const record = feedback()

    expect(statusOf(await upload([record]), record.recordId)).toBe('accepted')
    expect(statusOf(await upload([record]), record.recordId)).toBe(
      'already_current',
    )
  })

  it('is a conflict when the same revision claims a different city', async () => {
    /*
     * Two copies of one record at the same revision that disagree about where
     * it was captured are a genuine disagreement, and are treated exactly as a
     * disagreement about an answer already is: reported, not silently resolved
     * by whichever arrived second.
     */
    const record = feedback({ location: 'Bengaluru' })
    await upload([record])

    const result = await upload([{ ...record, location: 'Hyderabad' }])

    expect(statusOf(result, record.recordId)).toBe('conflict')
    // Nothing overwritten: the stored value is still the first one.
    expect((await store.getFeedback(record.recordId))?.location).toBe('Bengaluru')
  })

  it('accepts a corrected city as a new revision', async () => {
    /*
     * A location is mutable content, like the answers and unlike the identity.
     * A desk that moved between halls, or a device that was set to the wrong
     * city, has to be correctable, and the ordinary revision rules are what
     * make that safe.
     */
    const record = feedback({ location: 'Bengaluru' })
    await upload([record])

    const corrected = {
      ...record,
      location: 'Hyderabad',
      revision: 2,
      updatedAt: '2026-09-20T12:00:00.000Z',
    }

    expect(statusOf(await upload([corrected]), record.recordId)).toBe('accepted')
    expect((await store.getFeedback(record.recordId))?.location).toBe('Hyderabad')
  })

  it('does not let a location change the identity rules', async () => {
    /*
     * Identity stays immutable whatever else moves. A record arriving at a
     * higher revision with a different public code is refused as a conflict
     * carrying the immutable-mismatch code, exactly as it was before locations
     * existed: adding a mutable field must not widen what a revision may change.
     */
    const record = feedback({ location: 'Bengaluru' })
    await upload([record])

    const result = await upload([
      { ...record, publicCode: publicCodeFor(99), revision: 2 },
    ])

    const entry = result.results.find((row) => row.recordId === record.recordId)
    expect(entry?.status).toBe('conflict')
    expect(entry?.code).toBe('IMMUTABLE_FIELD_MISMATCH')

    // And the stored record is untouched, identity and location alike.
    const stored = await store.getFeedback(record.recordId)
    expect(stored?.publicCode).toBe(record.publicCode)
    expect(stored?.location).toBe('Bengaluru')
  })
})
