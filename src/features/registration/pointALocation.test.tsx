import { EVENT_CONFIG } from '../../config/event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegistrationScreen } from './RegistrationScreen'
import { fillCampaignRegistration } from '../campaign/flying-flea/testSupport'
import { db } from '../../lib/storage'
import { listRecentRegistrations } from '../../lib/storage/registrations'
import {
  givenDeviceLocation,
  givenNoDeviceLocation,
  givenPreviousEventLocation,
  storedLocationRaw,
} from '../../test/eventLocation'
import type { RegistrationRecord } from '../../types'

/*
 * Point A and the two cities.
 *
 * The September event runs in Bengaluru and Hyderabad on the same day, under
 * one event ID. Which city a registration was taken in is therefore no longer
 * a property of the build and cannot be recovered afterwards from anything
 * else on the record, so the operator answers it, once, and the device
 * remembers.
 *
 * Everything below is about the four things that can go wrong with that: a
 * silent default, a venue that is not offered, a choice that is forgotten
 * between riders, and a correction that changes more than it was asked to.
 */

const PARTICIPANT = {
  name: 'Ada Lovelace',
  phone: '9876543210',
  email: 'ada@example.com',
}

beforeEach(async () => {
  window.localStorage.clear()
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

async function onlyRecord(): Promise<RegistrationRecord> {
  const records = await listRecentRegistrations(db, 10, EVENT_CONFIG.eventId)
  expect(records).toHaveLength(1)
  return records[0] as RegistrationRecord
}

function locationSelect(): HTMLSelectElement {
  return screen.getByLabelText(/^Location/) as HTMLSelectElement
}

describe('the first use of a device', () => {
  it('chooses nothing for the operator', () => {
    /*
     * The single most important assertion in this file.
     *
     * Bengaluru and Hyderabad are indistinguishable in the data after the
     * event: there is no second field on a registration that could contradict a
     * wrong city, and no way to tell a defaulted value from a chosen one. A
     * plausible default is therefore worse than an empty control, because the
     * empty one gets noticed and corrected within a rider or two.
     */
    givenNoDeviceLocation()
    render(<RegistrationScreen />)

    expect(locationSelect().value).toBe('')
    expect(screen.getByText('Select location')).toBeDefined()
  })

  it('offers both cities and nothing else', () => {
    render(<RegistrationScreen />)

    const values = [...locationSelect().options].map((option) => option.value)

    // The placeholder, then the two cities.
    expect(values).toEqual(['', 'Bengaluru', 'Hyderabad'])
  })

  it('does not inherit the previous event’s venue', () => {
    /*
     * A tablet that ran the August event still has August's preference in this
     * browser. Scoping the key by event is what stops it opening already set to
     * a venue that is not even on this event's list.
     */
    givenPreviousEventLocation('ff-rc-2026-08-23', 'Richardson & Cruddas')
    render(<RegistrationScreen />)

    expect(locationSelect().value).toBe('')
  })

  it('refuses to save a registration with no city', async () => {
    givenNoDeviceLocation()
    render(<RegistrationScreen />)
    const user = userEvent.setup()

    // Everything except the city.
    await user.click(screen.getByRole('button', { name: 'Vehicle 1' }))
    await user.type(screen.getByLabelText(/^Name/), PARTICIPANT.name)
    await user.type(screen.getByLabelText(/^Email ID/), PARTICIPANT.email)
    await user.type(screen.getByLabelText(/^Phone Number/), PARTICIPANT.phone)

    await user.click(screen.getByRole('button', { name: 'Register & Print' }))

    expect(await screen.findByText('Select the event location.')).toBeDefined()
    // Nothing written, and no identity issued: a public code spent on a record
    // that was refused is a code that never appears again.
    expect(await db.registrations.count()).toBe(0)
    expect(screen.queryByTestId('sticker')).toBeNull()
  })
})

describe('recording each city', () => {
  it('stores Bengaluru', async () => {
    render(<RegistrationScreen />)
    const user = userEvent.setup()
    await fillCampaignRegistration(user, { ...PARTICIPANT, location: 'Bengaluru' })
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))
    await screen.findByTestId('sticker')

    expect((await onlyRecord()).location).toBe('Bengaluru')
  })

  it('stores Hyderabad', async () => {
    /*
     * The second city is asserted separately rather than by a loop, because the
     * failure this catches is a control that looks like a choice and writes a
     * constant. A single-city test passes under that bug.
     */
    render(<RegistrationScreen />)
    const user = userEvent.setup()
    await fillCampaignRegistration(user, { ...PARTICIPANT, location: 'Hyderabad' })
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))
    await screen.findByTestId('sticker')

    expect((await onlyRecord()).location).toBe('Hyderabad')
  })
})

describe('remembering the city between riders', () => {
  it('keeps the choice through Next rider, and clears the person', async () => {
    /*
     * The whole point of remembering. An operator registering two hundred
     * riders in Bengaluru answers this once; a control that reset with the rest
     * of the form would be answered wrong at speed on rider forty.
     */
    render(<RegistrationScreen />)
    const user = userEvent.setup()

    await fillCampaignRegistration(user, { ...PARTICIPANT, location: 'Hyderabad' })
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))
    await screen.findByTestId('sticker')

    await user.click(screen.getByRole('button', { name: 'Next rider' }))

    // The city stays.
    expect(locationSelect().value).toBe('Hyderabad')
    // The rider does not.
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/^Email ID/) as HTMLInputElement).value).toBe('')
  })

  it('survives a reload of the screen', async () => {
    render(<RegistrationScreen />)
    const user = userEvent.setup()
    await user.selectOptions(locationSelect(), 'Hyderabad')

    cleanup()
    render(<RegistrationScreen />)

    expect(locationSelect().value).toBe('Hyderabad')
    expect(storedLocationRaw()).toBe('Hyderabad')
  })

  it('stamps the remembered city on a second rider without re-asking', async () => {
    givenDeviceLocation('Hyderabad')
    render(<RegistrationScreen />)
    const user = userEvent.setup()

    // Note: no location is selected here. The draft opens carrying it.
    await user.click(screen.getByRole('button', { name: 'Vehicle 1' }))
    await user.type(screen.getByLabelText(/^Name/), PARTICIPANT.name)
    await user.type(screen.getByLabelText(/^Email ID/), PARTICIPANT.email)
    await user.type(screen.getByLabelText(/^Phone Number/), PARTICIPANT.phone)
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))
    await screen.findByTestId('sticker')

    expect((await onlyRecord()).location).toBe('Hyderabad')
  })
})

describe('changing the city', () => {
  it('lets the operator switch, and remembers the new one', async () => {
    // A desk that moved, or a tablet that was set up wrong. It must remain
    // changeable at any time, not only before the first rider.
    givenDeviceLocation('Bengaluru')
    render(<RegistrationScreen />)
    const user = userEvent.setup()

    await user.selectOptions(locationSelect(), 'Hyderabad')

    expect(locationSelect().value).toBe('Hyderabad')
    expect(storedLocationRaw()).toBe('Hyderabad')
  })

  it('applies the new city to the next registration', async () => {
    givenDeviceLocation('Bengaluru')
    render(<RegistrationScreen />)
    const user = userEvent.setup()

    await fillCampaignRegistration(user, { ...PARTICIPANT, location: 'Hyderabad' })
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))
    await screen.findByTestId('sticker')

    expect((await onlyRecord()).location).toBe('Hyderabad')
  })

  it('states the current city on screen, not only inside the control', () => {
    /*
     * A selector is something an operator opens; a caption is something they
     * see. A wrongly-set tablet is noticed because the screen says the wrong
     * city, not because somebody thought to check a dropdown.
     */
    givenDeviceLocation('Hyderabad')
    render(<RegistrationScreen />)

    expect(screen.getByTestId('event-meta-venue').textContent).toBe('Hyderabad')
  })
})

describe('correcting a registration', () => {
  it('changes the city without touching identity or the ride time', async () => {
    /*
     * A correction is not a new ride and not a new participant. Changing the
     * city has to reach the record and stop there: re-issuing identity would
     * orphan a sticker already in a rider's hand, and re-stamping the time
     * would rewrite a fact about the event to the moment somebody noticed a
     * mistake.
     */
    givenDeviceLocation('Bengaluru')
    render(<RegistrationScreen />)
    const user = userEvent.setup()

    await fillCampaignRegistration(user, PARTICIPANT)
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))
    await screen.findByTestId('sticker')

    const before = await onlyRecord()
    expect(before.location).toBe('Bengaluru')

    await user.click(screen.getByRole('button', { name: 'Correct details' }))

    const correction = screen.getByRole('heading', {
      name: 'Correct rider details',
    }).parentElement as HTMLElement
    const select = within(correction).getByLabelText(
      /^Location/,
    ) as HTMLSelectElement

    await user.selectOptions(select, 'Hyderabad')
    await user.click(
      within(correction).getByRole('button', { name: 'Save correction' }),
    )

    const after = await onlyRecord()

    expect(after.location).toBe('Hyderabad')

    // A new revision of the same record, not a second participant.
    expect(await db.registrations.count()).toBe(1)
    expect(after.recordId).toBe(before.recordId)
    expect(after.participantId).toBe(before.participantId)
    expect(after.publicCode).toBe(before.publicCode)
    expect(after.revision).toBe(before.revision + 1)

    // And the ride still happened when it happened.
    expect(after.testRideAt).toBe(before.testRideAt)
    expect(after.createdAt).toBe(before.createdAt)
  })

  it('does not re-point the desk when one record is corrected', async () => {
    /*
     * The trap in the previous test's feature. Correcting one rider's record to
     * say Hyderabad is a statement about that record. If it also changed the
     * device's remembered city, the next hundred riders registered in Bengaluru
     * would silently be recorded in Hyderabad, and the only visible cause would
     * be a correction somebody made an hour earlier.
     */
    givenDeviceLocation('Bengaluru')
    render(<RegistrationScreen />)
    const user = userEvent.setup()

    await fillCampaignRegistration(user, PARTICIPANT)
    await user.click(screen.getByRole('button', { name: 'Register & Print' }))
    await screen.findByTestId('sticker')
    await user.click(screen.getByRole('button', { name: 'Correct details' }))

    const correction = screen.getByRole('heading', {
      name: 'Correct rider details',
    }).parentElement as HTMLElement

    await user.selectOptions(
      within(correction).getByLabelText(/^Location/),
      'Hyderabad',
    )
    await user.click(
      within(correction).getByRole('button', { name: 'Save correction' }),
    )

    expect(storedLocationRaw()).toBe('Bengaluru')
  })
})
