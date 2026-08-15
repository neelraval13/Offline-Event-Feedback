import { EVENT_CONFIG } from './event'

/*
 * The event's own clock and calendar.
 *
 * Two separate jobs, both of which the surrounding code used to leave to the
 * device:
 *
 *   - reading the wall-clock time *at the venue*, whatever the tablet's own
 *     timezone happens to be set to
 *   - writing the event day out for a human to read
 *
 * ## Why the timezone is named rather than assumed
 *
 * The event is in India. A tablet is a general-purpose computer that may have
 * been bought abroad, restored from a backup taken elsewhere, or simply never
 * had its timezone corrected, and the operator has no reason to check. Deriving
 * a stored time from `getHours()` would then record a rider's test ride at a
 * time nobody was at the venue, silently and unrecoverably: nothing in the
 * stored value says which zone produced it.
 *
 * `Asia/Kolkata` is asked for explicitly, so the value written is the venue's
 * wall clock on every device that captures one.
 *
 * ## Why the stored value stays a naive wall clock
 *
 * `testRideAt` is persisted as `YYYY-MM-DDTHH:mm` with no zone suffix, and that
 * contract is unchanged here. A test-ride slot is a wall-clock time at a venue;
 * converting it to UTC would move a 15:42 ride to 10:12 in every export read
 * outside India. This module produces exactly that shape and nothing else: no
 * `Z`, no `+05:30`, no seconds.
 */

/** The venue's timezone. Never inferred from the device. */
export const EVENT_TIME_ZONE = 'Asia/Kolkata'

/*
 * Built once. Constructing an `Intl.DateTimeFormat` is not cheap, and this is
 * called on every registration submitted at a desk with a queue.
 */
const VENUE_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: EVENT_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/**
 * The hour and minute at the venue, as `HH:mm` on a 24-hour clock.
 *
 * Assembled from parts rather than from the formatted string: some ICU builds
 * separate the two fields with a narrow no-break space instead of a colon, and
 * a stored value that differed by locale data would be a defect that only
 * appeared on some devices.
 */
export function venueTimeOfDay(now: Date): string {
  const parts = VENUE_CLOCK.formatToParts(now)
  const read = (type: 'hour' | 'minute'): string =>
    parts.find((part) => part.type === type)?.value ?? '00'

  return `${read('hour').padStart(2, '0')}:${read('minute').padStart(2, '0')}`
}

/**
 * The `testRideAt` value for a registration submitted now.
 *
 * The date half is the configured event day, always. The time half is the
 * venue's clock at the moment of the call. Taking the date from `now` as well
 * would stamp whatever calendar day the tablet believes it is, which during
 * testing, across midnight, or on a device with a wrong date is a ride recorded
 * on a day the event did not run.
 */
export function eventTestRideAt(now: Date): string {
  return `${EVENT_CONFIG.eventDay}T${venueTimeOfDay(now)}`
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/**
 * An ISO calendar day as a person reads it: `2026-08-23` to `23 August 2026`.
 *
 * Written out rather than handed to `Intl`, for two reasons. It is shown on a
 * device that may be running with any locale, and the event date must read the
 * same on all of them. And a `Date` is never constructed, so there is no
 * timezone in the path at all: no chance of the displayed day being the one
 * before the stored one.
 */
export function formatEventDay(day: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (parts === null) {
    return day
  }

  const [, year = '', month = '', dayOfMonth = ''] = parts
  const name = MONTHS[Number(month) - 1]
  if (name === undefined) {
    return day
  }

  return `${Number(dayOfMonth)} ${name} ${year}`
}
