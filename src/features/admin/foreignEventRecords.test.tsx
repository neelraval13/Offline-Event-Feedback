import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { LocalDataPanel } from './LocalDataPanel'
import {
  createFeedback,
  createRegistration,
  db,
  getLocalCounts,
  getOrCreateDeviceId,
  markRegistrationSyncError,
  markRegistrationSynced,
} from '../../lib/storage'
import { EVENT_CONFIG } from '../../config/event'
import { eventDay, eventId, stationId } from '../../types'

/*
 * Admin, on a device that holds more than one event's records.
 *
 * Two things must both be true, and they pull against each other:
 *
 *   - another event's records must NOT be counted as this event's outstanding
 *     work. "3 pending" on a September device that has synced everything, where
 *     the 3 are August records nothing here can deliver, sends an operator
 *     looking for a September fault that does not exist.
 *   - they must NOT be hidden. This build never syncs them, so nothing else on
 *     any screen would ever mention them, and somebody about to clear site data
 *     has to know they are here first.
 */

const PREVIOUS = {
  eventId: eventId('ff-rc-2026-08-23'),
  eventDay: eventDay('2026-08-23'),
}

beforeEach(async () => {
  await db.open()
  await Promise.all([db.registrations.clear(), db.feedback.clear(), db.sequences.clear()])
})

afterEach(() => {
  cleanup()
})

async function seedRegistration(which: 'current' | 'previous', name: string) {
  const deviceId = await getOrCreateDeviceId(db)
  const event =
    which === 'current'
      ? { eventId: EVENT_CONFIG.eventId, eventDay: EVENT_CONFIG.eventDay }
      : PREVIOUS

  return createRegistration(db, {
    ...event,
    stationId: stationId('A1'),
    deviceId,
    name,
    phone: '9876543210',
    email: `${name.toLowerCase()}@example.invalid`,
  })
}

async function seedFeedback(which: 'current' | 'previous', code: string) {
  const deviceId = await getOrCreateDeviceId(db)
  const event =
    which === 'current'
      ? { eventId: EVENT_CONFIG.eventId, eventDay: EVENT_CONFIG.eventDay }
      : PREVIOUS

  return createFeedback(db, {
    ...event,
    stationId: stationId('B1'),
    deviceId,
    location: 'Bengaluru',
    identity: { captureMethod: 'manual', publicCode: code as never },
    formVersion: 'flying-flea-feedback-v1',
    answers: {
      testRideExperience: 5,
      rotaryKnobUsage: 5,
      rideModesExperience: 5,
      overallExperienceRating: 5,
    },
  })
}

describe('counting a device that holds two events', () => {
  it('reports only this event’s records in the headline figures', async () => {
    const old = await seedRegistration('previous', 'August')
    await seedFeedback('previous', old.publicCode)
    const current = await seedRegistration('current', 'September')
    await seedFeedback('current', current.publicCode)

    const counts = await getLocalCounts(db, EVENT_CONFIG.eventId)

    expect(counts.registrations.total).toBe(1)
    expect(counts.registrations.pending).toBe(1)
    expect(counts.feedback.total).toBe(1)
    expect(counts.feedback.pending).toBe(1)
  })

  it('reports the other event’s records separately, and names the event', async () => {
    const old = await seedRegistration('previous', 'August')
    await seedFeedback('previous', old.publicCode)
    await seedRegistration('current', 'September')

    const counts = await getLocalCounts(db, EVENT_CONFIG.eventId)

    expect(counts.otherEvents.registrations).toBe(1)
    expect(counts.otherEvents.feedback).toBe(1)
    expect(counts.otherEvents.eventIds).toEqual(['ff-rc-2026-08-23'])
  })

  it('counts pending and errored foreign records as undelivered together', async () => {
    /*
     * Both statuses mean the same thing to the person deciding whether it is
     * safe to clear this device: the server is not known to hold them. A record
     * already parked in error is if anything the more urgent of the two.
     */
    const pendingOne = await seedRegistration('previous', 'AugustPending')
    const erroredOne = await seedRegistration('previous', 'AugustErrored')
    const deliveredOne = await seedRegistration('previous', 'AugustDelivered')

    await markRegistrationSyncError(db, erroredOne.recordId, 'WRONG_EVENT')
    await markRegistrationSynced(db, deliveredOne.recordId)

    const counts = await getLocalCounts(db, EVENT_CONFIG.eventId)

    expect(counts.otherEvents.registrations).toBe(3)
    expect(counts.otherEvents.undelivered).toBe(2)
    expect(pendingOne.syncStatus).toBe('pending')
  })

  it('reports nothing foreign on a device that has only run this event', async () => {
    await seedRegistration('current', 'September')

    const counts = await getLocalCounts(db, EVENT_CONFIG.eventId)

    expect(counts.otherEvents).toEqual({
      registrations: 0,
      feedback: 0,
      undelivered: 0,
      eventIds: [],
    })
  })
})

describe('the Local data panel', () => {
  it('says the other event’s records are there', async () => {
    const old = await seedRegistration('previous', 'August')
    await seedFeedback('previous', old.publicCode)

    render(<LocalDataPanel />)

    const notice = await screen.findByTestId('other-event-records')
    expect(notice.textContent).toContain('ff-rc-2026-08-23')
    expect(notice.textContent).toContain('Records from another event remain')
  })

  it('warns that undelivered ones must be dealt with before wiping', async () => {
    await seedRegistration('previous', 'August')

    render(<LocalDataPanel />)

    const warning = await screen.findByTestId('other-event-undelivered')
    expect(warning.textContent).toContain('not reached the central server')
    expect(warning.textContent).toContain('before you clear local storage')
  })

  it('does not add them to this event’s pending figures', async () => {
    await seedRegistration('previous', 'August')
    await seedRegistration('previous', 'AnotherAugust')
    await seedRegistration('current', 'September')

    render(<LocalDataPanel />)

    /*
     * Waited on the value, not on the element. The cells exist immediately
     * holding "Counting…", so `findByTestId` resolves before the counts have
     * loaded and would compare against the placeholder.
     */
    await waitFor(() => {
      expect(screen.getByTestId('count-registrations-pending').textContent).toBe(
        '1',
      )
    })
    // One, not three.
    expect(screen.getByTestId('count-registrations').textContent).toBe('1')
  })

  it('says nothing at all on a device with only this event’s records', async () => {
    /*
     * The notice is a warning, and a warning that is always on screen stops
     * being read. A device that has only ever run this event must not carry it.
     */
    await seedRegistration('current', 'September')

    render(<LocalDataPanel />)

    // Settle on a loaded figure before asserting the notice is absent, so this
    // cannot pass merely because nothing had rendered yet.
    await waitFor(() => {
      expect(screen.getByTestId('count-registrations').textContent).toBe('1')
    })
    expect(screen.queryByTestId('other-event-records')).toBeNull()
  })

  it('drops the urgent half once the foreign records are all delivered', async () => {
    // Still worth mentioning that they are on the device; no longer a warning
    // about losing them, because the server has them.
    const delivered = await seedRegistration('previous', 'August')
    await markRegistrationSynced(db, delivered.recordId)

    render(<LocalDataPanel />)

    expect(await screen.findByTestId('other-event-records')).toBeDefined()
    expect(screen.queryByTestId('other-event-undelivered')).toBeNull()
  })
})
