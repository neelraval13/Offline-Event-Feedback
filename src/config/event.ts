import {
  deviceId,
  eventDay,
  eventId,
  stationId,
  type DeviceId,
  type EventDay,
  type EventId,
  type StationId,
} from '../types'

/** The two station roles that exist in V1. */
export type StationRole = 'registration' | 'feedback'

export interface StationConfig {
  readonly role: StationRole
  readonly stationId: StationId
  readonly deviceId: DeviceId
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
 * written in the field is stamped with event/day/station/device identity, so
 * adding a second event, day, station or device later is a configuration and
 * data-loading change — not a redesign of participant identity.
 *
 * Values below are development defaults. Provisioning real ones (in particular
 * a per-device `deviceId`) is a later-phase concern.
 */
export const EVENT_CONFIG: EventConfig = {
  eventId: eventId('evt-dev-001'),
  eventName: 'Development Event',
  eventDay: eventDay('2026-01-01'),
  registrationStation: {
    role: 'registration',
    stationId: stationId('A1'),
    deviceId: deviceId('dev-a1-001'),
    label: 'Point A',
  },
  feedbackStation: {
    role: 'feedback',
    stationId: stationId('B1'),
    deviceId: deviceId('dev-b1-001'),
    label: 'Point B',
  },
}

/** Resolves the station this surface is operating as. */
export function stationFor(role: StationRole): StationConfig {
  return role === 'registration'
    ? EVENT_CONFIG.registrationStation
    : EVENT_CONFIG.feedbackStation
}
