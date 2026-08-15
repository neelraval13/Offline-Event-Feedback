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
 * It is deliberately ABBREVIATED, though. `ff` is the campaign and `rc` is the
 * venue, and the reason for the shorthand is physical: this string is encoded
 * verbatim into every QR sticker, and every character of it costs a byte of
 * payload on a symbol printed at 26 mm. Spelling the venue out in full took the
 * payload from 114 bytes to 139 and pushed every sticker from 45 modules to 49,
 * which is a denser code on every label for information no scanner reads. The
 * human-readable form of the same three facts is `eventName` above and
 * `lockedLocation` in the campaign config, neither of which is printed.
 *
 * See the measurement note in `src/lib/qr/qrCode.ts` before lengthening it.
 */
export const EVENT_CONFIG: EventConfig = {
  eventId: eventId('ff-rc-2026-08-23'),
  eventName: 'Flying Flea Test Ride - Richardson & Cruddas',
  eventDay: eventDay('2026-08-23'),
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
