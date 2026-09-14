import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RegistrationScreen } from './RegistrationScreen'
import {
  db,
  createRegistration,
  getOrCreateDeviceId,
  listRecentRegistrations,
} from '../../lib/storage'
import { RECENT_REGISTRATION_LIMIT } from './useRegistrationTerminal'
import { EVENT_CONFIG } from '../../config/event'
import { givenDeviceLocation } from '../../test/eventLocation'
import { eventDay, eventId, stationId } from '../../types'

/*
 * Point A on a device that also holds the previous event's registrations.
 *
 * The station's recent list is not a browsing tool. It is the operational
 * surface an operator reprints from, and reprinting is the route to the
 * correction form. So an unscoped list does not merely show an extra row: it
 * offers a rider from a finished event for correction on a screen that will
 * ask for a city from this event's list and write the answer back onto their
 * record.
 *
 * The previous event's rows stay in the database. They are somebody's
 * registrations, they may be the only copy, and Admin reports that they are
 * there. They are simply not this station's work.
 */

const PREVIOUS = {
  eventId: eventId('ff-rc-2026-08-23'),
  eventDay: eventDay('2026-08-23'),
}

beforeEach(async () => {
  window.localStorage.clear()
  givenDeviceLocation('Bengaluru')
  await db.open()
  await Promise.all([
    db.registrations.clear(),
    db.feedback.clear(),
    db.sequences.clear(),
  ])
  window.print = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function seedPreviousEventRider(name: string) {
  const deviceId = await getOrCreateDeviceId(db)
  return createRegistration(db, {
    ...PREVIOUS,
    stationId: stationId('A1'),
    deviceId,
    name,
    phone: '9876543210',
    email: `${name.toLowerCase()}@example.invalid`,
    vehicle: 'Vehicle 1',
    interestedColour: 'Flea Green',
    location: 'Richardson & Cruddas',
  })
}

async function seedCurrentEventRider(name: string) {
  const deviceId = await getOrCreateDeviceId(db)
  return createRegistration(db, {
    eventId: EVENT_CONFIG.eventId,
    eventDay: EVENT_CONFIG.eventDay,
    stationId: stationId('A1'),
    deviceId,
    name,
    phone: '9876543211',
    email: `${name.toLowerCase()}@example.invalid`,
    vehicle: 'Vehicle 1',
    interestedColour: 'Flea Green',
    location: 'Bengaluru',
  })
}

describe('the recent registrations list', () => {
  it('does not offer a previous event’s rider', async () => {
    /*
     * A September rider is seeded alongside so the assertion has something
     * positive to wait for. Waiting only for the form would let this test pass
     * because the list had not loaded yet rather than because it excluded the
     * August row, which is the difference between a test and a coin toss.
     */
    const august = await seedPreviousEventRider('AugustRider')
    const september = await seedCurrentEventRider('SeptemberRider')

    render(<RegistrationScreen />)

    await screen.findByText(september.publicCode)
    expect(screen.queryByText(august.publicCode)).toBeNull()
  })

  it('shows this event’s riders, and only those', async () => {
    await seedPreviousEventRider('AugustRider')
    const september = await seedCurrentEventRider('SeptemberRider')

    render(<RegistrationScreen />)

    expect(await screen.findByText(september.publicCode)).toBeDefined()
    expect(
      screen.getByRole('heading', {
        name: 'Recent registrations on this device',
      }),
    ).toBeDefined()

    // One row, not two: the list is the section's list items.
    const codes = screen
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
    expect(codes).toHaveLength(1)
  })

  it('has nothing to show when only the previous event has riders', async () => {
    /*
     * A device holding only August records must look like a fresh device to
     * Point A, because for Point A's purposes it is one.
     *
     * Asserted against the query rather than the rendered screen, and
     * deliberately. An absence with no positive signal to wait for cannot be
     * tested through the DOM without racing the asynchronous load: the list is
     * empty on the first tick whether or not the scoping works, so a rendered
     * assertion would pass against a build with no filter at all. The query is
     * where the rule lives, and it answers deterministically.
     */
    await seedPreviousEventRider('AugustRider')
    await seedPreviousEventRider('AnotherAugustRider')

    const forThisEvent = await listRecentRegistrations(
      db,
      RECENT_REGISTRATION_LIMIT,
      EVENT_CONFIG.eventId,
    )

    expect(forThisEvent).toEqual([])
    // The rows are still on the device, which is the other half of the rule.
    expect(await db.registrations.count()).toBe(2)
  })

  it('leaves the previous event’s rows in the database', async () => {
    // Scoped away from the station, not deleted. They may be the only copy.
    const august = await seedPreviousEventRider('AugustRider')
    await seedCurrentEventRider('SeptemberRider')

    render(<RegistrationScreen />)
    await screen.findByLabelText(/^Name/)

    expect(await db.registrations.get(august.recordId)).toEqual(august)
    expect(await db.registrations.count()).toBe(2)
  })

  it('gives a previous event’s rider no route to the correction form', async () => {
    /*
     * The consequence that matters. Correction is reached by reprinting from
     * this list, so a rider who is not in the list cannot be corrected here,
     * and this event's form can never rewrite their record.
     *
     * Both events are seeded, so the list is populated and the single Reprint
     * button that exists is provably the September rider's.
     */
    const august = await seedPreviousEventRider('AugustRider')
    const september = await seedCurrentEventRider('SeptemberRider')

    render(<RegistrationScreen />)
    await screen.findByText(september.publicCode)

    expect(screen.queryByText(august.publicCode)).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Reprint' })).toHaveLength(1)
    // Correction is only reachable after reprinting, so it is not on screen yet.
    expect(screen.queryByRole('button', { name: 'Correct details' })).toBeNull()
  })
})
