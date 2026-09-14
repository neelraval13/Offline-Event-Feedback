import { describe, expect, it } from 'vitest'
import { EVENT_LOCATIONS, isEventLocation } from './eventLocations'
import { MAX_LOCATION_LENGTH } from '../../shared/campaign/flyingFlea'

/*
 * The two cities, and nothing else.
 *
 * This list is the single client-side definition of where the September event
 * runs. Every control that offers a venue and every validator that accepts one
 * reads it, so the assertions below are about the list being exactly what it
 * claims and about the guard rejecting everything outside it.
 */

describe('the event’s locations', () => {
  it('is exactly Bengaluru and Hyderabad, in that order', () => {
    /*
     * Pinned as a list rather than as a length, because both the membership and
     * the order are visible: the order is the order of the options an operator
     * reads at a desk, and a silent reordering would move the option under
     * somebody's thumb.
     */
    expect([...EVENT_LOCATIONS]).toEqual(['Bengaluru', 'Hyderabad'])
  })

  it('accepts each of them and nothing else', () => {
    for (const location of EVENT_LOCATIONS) {
      expect(isEventLocation(location)).toBe(true)
    }

    for (const wrong of [
      // The August venue. Still valid data on an August record, and not a
      // choice this build may offer.
      'Richardson & Cruddas',
      // Case and whitespace variants: three spellings of one city in a report
      // is exactly what a closed list exists to prevent.
      'bengaluru',
      'BENGALURU',
      ' Bengaluru',
      'Bengaluru ',
      'Bangalore',
      'Hyderbad',
      '',
      '   ',
    ]) {
      expect(isEventLocation(wrong), `accepted ${JSON.stringify(wrong)}`).toBe(
        false,
      )
    }
  })

  it('rejects anything that is not a string', () => {
    // The guard runs on values read back from browser storage, which is a
    // string store that anything on the origin can write to.
    for (const wrong of [null, undefined, 0, 1, {}, [], true]) {
      expect(isEventLocation(wrong)).toBe(false)
    }
  })

  it('fits the bound the wire and the database agree on', () => {
    /*
     * The client's list is narrower than the server's rule, deliberately: the
     * server accepts any bounded string because it holds more than one event's
     * data. What must never happen is a city this build offers being one the
     * wire would refuse, which would be a record that cannot leave the device.
     */
    for (const location of EVENT_LOCATIONS) {
      expect(location.length).toBeGreaterThan(0)
      expect(location.length).toBeLessThanOrEqual(MAX_LOCATION_LENGTH)
    }
  })
})
