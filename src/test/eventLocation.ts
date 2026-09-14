import { EVENT_CONFIG } from '../config/event'
import type { EventLocation } from '../config/eventLocations'
import {
  eventLocationKey,
  forgetLocation,
  rememberLocation,
} from '../lib/location/eventLocation'

/*
 * Putting a test's device into a known location, or into none.
 *
 * Both halves matter. Most Point B suites are about scanning, identity capture
 * or the questionnaire, and they need a device that is already set up, exactly
 * as a tablet at the event is by the time a rider reaches it. A handful of
 * suites are about the gate itself and need the opposite.
 *
 * The default is deliberately NOT applied automatically by the global test
 * setup. A device with no location is the real state of a fresh install, and a
 * harness that quietly configured every test would make the gate untestable by
 * construction: the one failure mode this feature exists to prevent would be
 * the one state the suite could never reach.
 */

/** Sets the remembered location, as choosing it in the UI would. */
export function givenDeviceLocation(location: EventLocation): void {
  rememberLocation(EVENT_CONFIG.eventId, location)
}

/** Returns the device to a fresh install, with no location chosen. */
export function givenNoDeviceLocation(): void {
  forgetLocation(EVENT_CONFIG.eventId)
}

/**
 * Writes a location under ANOTHER event's key.
 *
 * For the one thing worth proving about the scoping: a preference left behind
 * by a previous event must not be picked up by this one.
 */
export function givenPreviousEventLocation(
  previousEventId: string,
  location: string,
): void {
  window.localStorage.setItem(eventLocationKey(previousEventId), location)
}

/** Reads back what is stored, without going through the validating reader. */
export function storedLocationRaw(): string | null {
  return window.localStorage.getItem(eventLocationKey(EVENT_CONFIG.eventId))
}
