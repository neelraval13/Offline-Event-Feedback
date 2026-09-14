import { beforeEach, describe, expect, it } from 'vitest'
import { EVENT_CONFIG } from '../../config/event'
import { EXCLUDED_FROM_BACKUP_KEYS } from '../sync/syncCredentials'
import {
  eventLocationKey,
  forgetLocation,
  readRememberedLocation,
  rememberLocation,
} from './eventLocation'

/*
 * The device's remembered city.
 *
 * Four properties, each of which is a failure mode somebody has to live with at
 * a venue if it is wrong: it is remembered between riders, it is scoped to one
 * event, it is validated on the way out, and it never travels in a backup.
 */

const PREVIOUS_EVENT = 'ff-rc-2026-08-23'

beforeEach(() => {
  window.localStorage.clear()
})

describe('remembering the city on a device', () => {
  it('is absent until something is chosen', () => {
    // A fresh install. The station screens read this as "ask the operator".
    expect(readRememberedLocation(EVENT_CONFIG.eventId)).toBeNull()
  })

  it('reads back what was chosen', () => {
    rememberLocation(EVENT_CONFIG.eventId, 'Hyderabad')

    expect(readRememberedLocation(EVENT_CONFIG.eventId)).toBe('Hyderabad')
  })

  it('replaces the previous choice rather than accumulating', () => {
    rememberLocation(EVENT_CONFIG.eventId, 'Bengaluru')
    rememberLocation(EVENT_CONFIG.eventId, 'Hyderabad')

    expect(readRememberedLocation(EVENT_CONFIG.eventId)).toBe('Hyderabad')
  })

  it('can be forgotten', () => {
    rememberLocation(EVENT_CONFIG.eventId, 'Bengaluru')
    forgetLocation(EVENT_CONFIG.eventId)

    expect(readRememberedLocation(EVENT_CONFIG.eventId)).toBeNull()
  })
})

describe('scoping, so one event cannot inherit another’s venue', () => {
  it('keys the preference by event', () => {
    expect(eventLocationKey('ff-2026-09-20')).toBe('event-location:ff-2026-09-20')
    expect(eventLocationKey(PREVIOUS_EVENT)).not.toBe(
      eventLocationKey('ff-2026-09-20'),
    )
  })

  it('never reads a previous event’s choice', () => {
    /*
     * The concrete case: a tablet that ran the August event at Richardson &
     * Cruddas is re-used in September. Without the event scope it would open
     * already configured, with a venue nobody chose for this event and one that
     * is not even on this event's list.
     */
    window.localStorage.setItem(
      eventLocationKey(PREVIOUS_EVENT),
      'Richardson & Cruddas',
    )

    expect(readRememberedLocation(EVENT_CONFIG.eventId)).toBeNull()
  })

  it('keeps the two events’ choices apart when both are set', () => {
    window.localStorage.setItem(eventLocationKey(PREVIOUS_EVENT), 'Bengaluru')
    rememberLocation(EVENT_CONFIG.eventId, 'Hyderabad')

    expect(readRememberedLocation(EVENT_CONFIG.eventId)).toBe('Hyderabad')
    expect(window.localStorage.getItem(eventLocationKey(PREVIOUS_EVENT))).toBe(
      'Bengaluru',
    )
  })
})

describe('validating on the way out', () => {
  it('treats an unrecognised stored value as no choice at all', () => {
    /*
     * `localStorage` is a string store that anything on the origin can write.
     * An unusable value must be indistinguishable from an absent one, so that
     * the operator is put back in front of the selector rather than having an
     * unknown string reach a record.
     */
    for (const corrupt of ['Bangalore', 'bengaluru', '', 'null', '{}']) {
      window.localStorage.setItem(eventLocationKey(EVENT_CONFIG.eventId), corrupt)

      expect(readRememberedLocation(EVENT_CONFIG.eventId)).toBeNull()
    }
  })

  it('refuses to write a value outside the list', () => {
    rememberLocation(EVENT_CONFIG.eventId, 'Mumbai' as never)

    expect(
      window.localStorage.getItem(eventLocationKey(EVENT_CONFIG.eventId)),
    ).toBeNull()
  })
})

describe('the venue never travels in a backup', () => {
  it('is not stored in the table a backup snapshots', () => {
    /*
     * The requirement this module is shaped around: restoring a Bengaluru
     * tablet's backup onto a replacement machine in Hyderabad must not silently
     * set that machine to Bengaluru.
     *
     * A backup contains the whole `deviceConfig` table. This value is therefore
     * kept in `localStorage`, which a backup cannot reach, and the assertion is
     * that it lands there and nowhere else.
     */
    rememberLocation(EVENT_CONFIG.eventId, 'Bengaluru')

    const key = eventLocationKey(EVENT_CONFIG.eventId)
    expect(window.localStorage.getItem(key)).toBe('Bengaluru')

    /*
     * And it is not handled by the one mechanism that exists for keeping a
     * `deviceConfig` row out of a backup. Being absent from that list is only
     * meaningful because the value is absent from the table entirely: if it
     * ever moves into `deviceConfig`, this assertion stops being enough and the
     * key has to join the exclusion list instead.
     */
    expect(EXCLUDED_FROM_BACKUP_KEYS).not.toContain(key)
  })

  it('survives a reload, which is the only persistence it promises', () => {
    rememberLocation(EVENT_CONFIG.eventId, 'Hyderabad')

    // A reload is a fresh read of the same store, which is what this models.
    expect(readRememberedLocation(EVENT_CONFIG.eventId)).toBe('Hyderabad')
  })
})
