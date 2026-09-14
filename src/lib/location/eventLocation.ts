import { isEventLocation, type EventLocation } from '../../config/eventLocations'

/*
 * The city this device is currently recording, remembered between riders.
 *
 * Point A and Point B both ask for it once and then stop asking. An operator
 * registering two hundred riders in Bengaluru should choose Bengaluru once, not
 * two hundred times, and a control that has to be re-answered every time is a
 * control that will eventually be answered wrong at speed.
 *
 * ## Why this is localStorage and not IndexedDB
 *
 * `deviceIdentity` makes the opposite choice and explains why: identity belongs
 * with the records it stamps. This value must NOT travel with the records.
 *
 * A backup snapshot contains the whole `deviceConfig` table (see
 * `src/lib/backup/snapshot.ts`). Putting the venue there would mean restoring a
 * Bengaluru tablet's backup onto a replacement machine in Hyderabad silently
 * set that machine to Bengaluru, with nothing on screen having been chosen by
 * anybody, and every record it then wrote would claim the wrong city. That is
 * the exact failure this module is shaped to prevent, so the value is kept
 * somewhere a backup cannot reach.
 *
 * It is also not a secret and is not treated as one. It is a visible operating
 * setting, shown on screen and changeable at any time.
 *
 * ## Why the key carries the event ID
 *
 * `event-location:ff-2026-09-20`. A device that ran the August event has a
 * preference from August still sitting in this store; scoping the key means the
 * September build cannot read it, so an old venue can never be silently
 * inherited by a new event. The stale key is left in place rather than deleted:
 * it is a few bytes, nothing reads it, and a delete is a write that can fail on
 * a device whose storage is in an odd state.
 *
 * ## Why every read is validated
 *
 * `localStorage` is a string store that anything on the origin can write, and
 * the value read back is checked against the event's own list before it is
 * trusted. An unrecognised value is treated as no choice at all, which puts the
 * operator back in front of the selector rather than letting an unknown string
 * reach a record.
 */

const KEY_PREFIX = 'event-location:'

/** The storage key for one event. Exported so tests can assert the scoping. */
export function eventLocationKey(eventId: string): string {
  return `${KEY_PREFIX}${eventId}`
}

/*
 * Storage access is wrapped because it genuinely throws.
 *
 * Safari in private browsing, a device with site data disabled, and a storage
 * quota that is already full all raise on access rather than returning null. An
 * exception here must never take Point A down: the consequence of failing to
 * remember a venue is that the operator picks it again, which is a small
 * annoyance, where an unhandled throw at the desk is a blank screen with a
 * queue in front of it.
 */
function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * The location this device last chose for the given event.
 *
 * Null means no valid choice has been made on this device for this event, which
 * is the state a fresh install and a stale-value install are deliberately both
 * in: neither may proceed without the operator choosing.
 */
export function readRememberedLocation(eventId: string): EventLocation | null {
  const store = storage()
  if (store === null) {
    return null
  }

  let raw: string | null
  try {
    raw = store.getItem(eventLocationKey(eventId))
  } catch {
    return null
  }

  return isEventLocation(raw) ? raw : null
}

/**
 * Remembers a location for this event on this device.
 *
 * Validated here as well as at the call sites, because this is the write that
 * creates the value every later read trusts.
 */
export function rememberLocation(eventId: string, location: EventLocation): void {
  if (!isEventLocation(location)) {
    return
  }

  const store = storage()
  if (store === null) {
    return
  }

  try {
    store.setItem(eventLocationKey(eventId), location)
  } catch {
    // Full or disabled. The operator keeps the location for this session; it
    // simply will not survive a reload. Nothing about the record is affected.
  }
}

/** Forgets the remembered location for this event. Used by tests and resets. */
export function forgetLocation(eventId: string): void {
  const store = storage()
  if (store === null) {
    return
  }

  try {
    store.removeItem(eventLocationKey(eventId))
  } catch {
    // Nothing to do, and nothing depends on the removal succeeding.
  }
}
