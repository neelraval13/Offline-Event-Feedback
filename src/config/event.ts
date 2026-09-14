import {
  eventDay,
  eventId,
  stationId,
  type EventDay,
  type EventId,
  type StationId,
} from '../types'

/** The two station roles that exist in V1. */
export type StationRole = 'registration' | 'feedback'

export interface StationConfig {
  readonly role: StationRole
  readonly stationId: StationId
  /** Wording staff sees on screen, e.g. "Point A". */
  readonly label: string
}

export interface EventConfig {
  readonly eventId: EventId
  readonly eventName: string
  readonly eventDay: EventDay
  readonly registrationStation: StationConfig
  readonly feedbackStation: StationConfig
}

/**
 * The single hardcoded operational setup for V1.
 *
 * V1 deliberately exposes no UI for changing any of this. The point of having
 * it as typed configuration rather than inline literals is that every record
 * written in the field is stamped with event/day/station identity, so adding a
 * second event, day or station later is a configuration and data-loading
 * change, not a redesign of participant identity.
 *
 * `deviceId` is deliberately NOT here. A station is an operational post that
 * this configuration names; a device is a physical browser installation that
 * identifies itself. See `src/lib/identity/deviceIdentity.ts`.
 *
 * ## The event identity is real, and it is permanent
 *
 * These three values are stamped onto every registration and every feedback
 * response the moment it is written, they travel on the wire, and they are what
 * a reconciliation run groups by. A build that went to a desk carrying a
 * placeholder would label the whole day's data as a development event, and
 * nothing downstream could tell the difference afterwards.
 *
 * `eventId` is therefore stable and derived from facts that cannot change:
 * campaign, venue, day. It is never regenerated, and it is not a UUID, because
 * an operator reading an export filename or a reconciliation run has to
 * recognise it.
 *
 * It is deliberately ABBREVIATED, though. `ff` is the campaign, and the reason
 * for the shorthand is physical: this string is encoded verbatim into every QR
 * sticker, and every character of it costs a byte of payload on a symbol printed
 * at 26 mm. Spelling a venue out in full previously took the payload from 114
 * bytes to 139 and pushed every sticker from 45 modules to 49, which is a denser
 * code on every label for information no scanner reads.
 *
 * ## Why this event ID names no venue
 *
 * The August event ran at one address and its ID said so: `ff-rc-2026-08-23`.
 * This one runs at two, Bengaluru and Hyderabad, on the same day, and it is
 * still ONE event: one questionnaire, one participant population, one
 * reconciliation run, one workbook. Splitting it into two event IDs would split
 * the reconciliation and force every combined figure to be re-assembled by hand
 * in a spreadsheet, which is exactly the work this system exists to remove.
 *
 * So the venue is no longer part of the event's identity. It is per-record data
 * instead: each registration and each response carries the city it was captured
 * in, chosen by the operator on the device. See `src/config/eventLocations.ts`.
 *
 * The ID is three characters shorter than August's as a side effect: the QR
 * payload measures 111 bytes rather than 114, so this change moved away from
 * the size boundary rather than towards it.
 *
 * See the measurement note in `src/lib/qr/qrCode.ts` before lengthening it.
 */
export const EVENT_CONFIG: EventConfig = {
  eventId: eventId('ff-2026-09-20'),
  eventName: 'Flying Flea Test Ride - Bengaluru & Hyderabad',
  eventDay: eventDay('2026-09-20'),
  registrationStation: {
    role: 'registration',
    stationId: stationId('A1'),
    label: 'Point A',
  },
  feedbackStation: {
    role: 'feedback',
    stationId: stationId('B1'),
    label: 'Point B',
  },
}

/** Resolves the station this surface is operating as. */
export function stationFor(role: StationRole): StationConfig {
  return role === 'registration'
    ? EVENT_CONFIG.registrationStation
    : EVENT_CONFIG.feedbackStation
}
