import { describe, expect, it } from 'vitest'
import { EVENT_CONFIG } from '../../../config/event'
import { stampEventFields } from './eventStamp'

/*
 * What the operator no longer answers, and what gets stored instead.
 *
 * The invariant is narrow and worth stating: this changes where one value comes
 * from, and nothing else. Same key, same shape, same record.
 *
 * The venue used to be stamped here too, from a single compiled `lockedLocation`.
 * It is not any more, and the tests below pin the removal as hard as they once
 * pinned the behaviour. An event running in two cities on one day cannot have
 * its venue supplied by the build, and a helper that still wrote `location` on
 * the way to the store would silently discard whichever city the operator had
 * just chosen.
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
const AT_1542 = new Date('2026-09-20T10:12:00.000Z')
/** 15:49 at the venue, seven minutes later. */
const AT_1549 = new Date('2026-09-20T10:19:00.000Z')

describe('stamping a new registration', () => {
  it('attaches the event day and the time of submission', () => {
    expect(stampEventFields(RIDER, AT_1542).testRideAt).toBe('2026-09-20T15:42')
  })

  it('produces a different time for a rider registered later', () => {
    /*
     * The value is a function of the moment it is called, which is what makes
     * "read the clock at submit" different from "read it when the form was
     * built". Two riders at the same desk get the times they were actually
     * registered at.
     */
    expect(stampEventFields(RIDER, AT_1542).testRideAt).toBe('2026-09-20T15:42')
    expect(stampEventFields(RIDER, AT_1549).testRideAt).toBe('2026-09-20T15:49')
  })

  it('takes the date from configuration, never from the clock', () => {
    // A device running on some other calendar day still stamps the event day.
    // The date used is the previous event's, which is the wrong day a re-used
    // tablet is most likely to be sitting on.
    const stamped = stampEventFields(RIDER, new Date('2026-08-23T10:12:00.000Z'))

    expect(stamped.testRideAt).toBe(`${EVENT_CONFIG.eventDay}T15:42`)
    expect(stamped.testRideAt).not.toContain('2026-08-23')
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
    // One added key, already part of the record: no second field, no renamed
    // one, and in particular no `location`.
    expect(Object.keys(stamped).sort()).toEqual(
      [...Object.keys(RIDER), 'testRideAt'].sort(),
    )
  })

  it('does not add a location to a form that never carried one', () => {
    /*
     * The regression that matters most. While this helper stamped the venue,
     * `location` appeared on the output of a form that had not been asked for
     * one. If that came back, a device set to Hyderabad would still write
     * whatever the build named, and nothing on screen would show it.
     */
    const stamped = stampEventFields(RIDER, AT_1542)

    expect('location' in stamped).toBe(false)
  })

  it('passes the operator’s chosen city through untouched', () => {
    /*
     * The positive half of the same rule. The city now arrives from the form,
     * which is the only thing that knows it, and this function is on the path
     * between that form and the store. It must not rewrite it, reformat it, or
     * substitute a configured default for it.
     */
    for (const city of ['Bengaluru', 'Hyderabad']) {
      const stamped = stampEventFields({ ...RIDER, location: city }, AT_1542)

      expect(stamped.location).toBe(city)
    }
  })

  it('still overrides a test-ride time that arrived from anywhere else', () => {
    /*
     * Defence against a stale draft: the form does not offer this control, but
     * a restored draft or a future caller could still carry one, and the
     * event's own answer has to win. Unchanged from before, and deliberately
     * still true of the time even though it is no longer true of the venue:
     * the venue has a legitimate source now and the time does not.
     */
    const stamped = stampEventFields(
      { ...RIDER, location: 'Bengaluru', testRideAt: '2026-01-01T09:00' },
      AT_1542,
    )

    expect(stamped.testRideAt).toBe('2026-09-20T15:42')
    expect(stamped.location).toBe('Bengaluru')
  })
})
