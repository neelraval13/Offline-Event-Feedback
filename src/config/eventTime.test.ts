import { describe, expect, it } from 'vitest'
import { EVENT_CONFIG } from './event'
import {
  EVENT_TIME_ZONE,
  eventTestRideAt,
  formatEventDay,
  venueTimeOfDay,
} from './eventTime'

/*
 * The venue clock.
 *
 * Every instant below is written as a UTC instant, deliberately. That is the
 * only way to state "this exact moment" without depending on the machine
 * running the suite: whatever timezone the test process is in, `new
 * Date('2026-08-23T10:12:00.000Z')` is one point on the timeline, and the
 * question under test is what a clock on a wall in Mumbai reads at that point.
 *
 * India is UTC+05:30 all year; there is no daylight saving to straddle.
 */

describe('reading the wall clock at the venue', () => {
  it('names the timezone rather than trusting the device', () => {
    expect(EVENT_TIME_ZONE).toBe('Asia/Kolkata')
  })

  it('converts an instant to the venue hour and minute', () => {
    // 10:12 UTC is 15:42 in Kolkata.
    expect(venueTimeOfDay(new Date('2026-08-23T10:12:00.000Z'))).toBe('15:42')
    expect(venueTimeOfDay(new Date('2026-08-23T10:19:00.000Z'))).toBe('15:49')
  })

  it('pads to a fixed HH:mm on a 24-hour clock', () => {
    // 03:00 UTC is 08:30 local: the leading zero must survive, and the hour
    // must not come back as "8 am".
    expect(venueTimeOfDay(new Date('2026-08-23T03:00:00.000Z'))).toBe('08:30')
    // Just before local midnight, which a 12-hour clock would render as 12:00.
    expect(venueTimeOfDay(new Date('2026-08-23T18:35:00.000Z'))).toBe('00:05')
    expect(venueTimeOfDay(new Date('2026-08-23T18:29:00.000Z'))).toBe('23:59')
  })

  it('carries the half-hour offset, not a whole-hour approximation', () => {
    /*
     * The failure this rules out: a helper that shifted by 5 hours instead of
     * 5:30 would be right to the hour and thirty minutes wrong on every single
     * record, which is exactly the kind of error nobody spots in an export.
     */
    expect(venueTimeOfDay(new Date('2026-08-23T00:00:00.000Z'))).toBe('05:30')
  })

  it('reads the venue zone, not whichever zone this process runs in', () => {
    /*
     * The suite makes no assumption about where it is running, so the proof is
     * comparative: for one instant, the result must equal what a clock in
     * Kolkata reads and differ from what a clock in UTC reads. Only a helper
     * that names its timezone can satisfy both, on a machine set to either.
     */
    const instant = new Date('2026-08-23T10:12:00.000Z')
    const clockIn = (timeZone: string): string =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(instant)

    expect(venueTimeOfDay(instant)).toBe(clockIn('Asia/Kolkata'))
    expect(venueTimeOfDay(instant)).not.toBe(clockIn('UTC'))
  })
})

describe('the value stored as testRideAt', () => {
  it('takes its date from the event and its time from the clock', () => {
    expect(eventTestRideAt(new Date('2026-08-23T10:12:00.000Z'))).toBe(
      '2026-08-23T15:42',
    )
  })

  it('uses the configured event day even when the device is on another date', () => {
    /*
     * The failure this prevents: testing on 15 August and writing
     * `2026-08-15T15:42` onto a record for an event that ran on 23 August. The
     * date half is configuration, never the device calendar.
     */
    const wrongDay = new Date('2026-08-15T10:12:00.000Z')

    expect(eventTestRideAt(wrongDay)).toBe('2026-08-23T15:42')
    expect(eventTestRideAt(wrongDay).startsWith(EVENT_CONFIG.eventDay)).toBe(true)
  })

  it('keeps the naive wall-clock shape the store has always held', () => {
    const stamped = eventTestRideAt(new Date('2026-08-23T10:12:00.000Z'))

    // `YYYY-MM-DDTHH:mm`, and nothing else: no seconds, no `Z`, no `+05:30`.
    expect(stamped).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(stamped).not.toContain('Z')
    expect(stamped).not.toContain('+')
  })
})

describe('showing the event day to a person', () => {
  it('writes the configured day the way it is read aloud', () => {
    expect(formatEventDay('2026-08-23')).toBe('23 August 2026')
    expect(formatEventDay(EVENT_CONFIG.eventDay)).toBe('23 August 2026')
  })

  it('drops a leading zero from the day but never from the month name', () => {
    expect(formatEventDay('2026-01-05')).toBe('5 January 2026')
    expect(formatEventDay('2026-12-31')).toBe('31 December 2026')
  })

  it('returns anything it does not recognise untouched', () => {
    // A date is never invented from a value this cannot read.
    expect(formatEventDay('2026-13-01')).toBe('2026-13-01')
    expect(formatEventDay('not a day')).toBe('not a day')
  })
})
