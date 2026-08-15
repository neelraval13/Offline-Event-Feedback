import { describe, expect, it } from 'vitest'
import { EVENT_CONFIG } from '../../../config/event'
import { FLYING_FLEA_CAMPAIGN } from './config'
import { stampEventFields } from './eventStamp'

/*
 * What the operator no longer answers, and what gets stored instead.
 *
 * The invariant is narrow and worth stating: this changes where two values come
 * from, and nothing else. Same keys, same shapes, same record.
 */

const RIDER = {
  name: 'Ada Lovelace',
  phone: '9876543210',
  email: 'ada@example.com',
  vehicle: 'Vehicle 2',
  interestedColour: 'Storm Black' as const,
  gender: 'Female' as const,
  drivingLicence: 'KA0120200001234',
  pincode: '560048',
}

/** 15:42 at the venue. */
const AT_1542 = new Date('2026-08-23T10:12:00.000Z')
/** 15:49 at the venue, seven minutes later. */
const AT_1549 = new Date('2026-08-23T10:19:00.000Z')

describe('stamping a new registration', () => {
  it('attaches the locked venue', () => {
    const stamped = stampEventFields(RIDER, AT_1542)

    expect(stamped.location).toBe('Richardson & Cruddas')
    expect(stamped.location).toBe(FLYING_FLEA_CAMPAIGN.lockedLocation)
  })

  it('attaches the event day and the time of submission', () => {
    expect(stampEventFields(RIDER, AT_1542).testRideAt).toBe('2026-08-23T15:42')
  })

  it('produces a different time for a rider registered later', () => {
    /*
     * The value is a function of the moment it is called, which is what makes
     * "read the clock at submit" different from "read it when the form was
     * built". Two riders at the same desk get the times they were actually
     * registered at.
     */
    expect(stampEventFields(RIDER, AT_1542).testRideAt).toBe('2026-08-23T15:42')
    expect(stampEventFields(RIDER, AT_1549).testRideAt).toBe('2026-08-23T15:49')
  })

  it('takes the date from configuration, never from the clock', () => {
    // A device running on some other calendar day still stamps the event day.
    const stamped = stampEventFields(RIDER, new Date('2026-08-15T10:12:00.000Z'))

    expect(stamped.testRideAt).toBe(`${EVENT_CONFIG.eventDay}T15:42`)
    expect(stamped.testRideAt).not.toContain('2026-08-15')
  })

  it('keeps the stored shape the rest of the system already validates', () => {
    const stamped = stampEventFields(RIDER, AT_1542)

    // The wire schema and the backup validator both enforce this shape
    // independently; nothing here is allowed to drift from it.
    expect(stamped.testRideAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('touches nothing else the operator typed', () => {
    const stamped = stampEventFields(RIDER, AT_1542)

    expect(stamped).toMatchObject(RIDER)
    // Two added keys, both already part of the record: no third field, no
    // renamed one.
    expect(Object.keys(stamped).sort()).toEqual(
      [...Object.keys(RIDER), 'location', 'testRideAt'].sort(),
    )
  })

  it('overrides a venue or a time that arrived from anywhere else', () => {
    /*
     * Defence against a stale draft: the form no longer offers either control,
     * but a restored draft or a future caller could still carry one, and the
     * event's own answer has to win.
     */
    const stamped = stampEventFields(
      { ...RIDER, location: 'Somewhere Else', testRideAt: '2026-01-01T09:00' },
      AT_1542,
    )

    expect(stamped.location).toBe('Richardson & Cruddas')
    expect(stamped.testRideAt).toBe('2026-08-23T15:42')
  })
})
