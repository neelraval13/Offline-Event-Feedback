import { useCallback, useState } from 'react'
import { EVENT_CONFIG } from '../../config/event'
import type { EventLocation } from '../../config/eventLocations'
import { readRememberedLocation, rememberLocation } from './eventLocation'

/*
 * The city this device is set to, as a piece of screen state.
 *
 * One hook for both stations. Point A and Point B ask the same question, store
 * the answer in the same place under the same event scope, and have the same
 * rule about the first use of a device, so they share this rather than each
 * growing their own copy that can drift.
 *
 * The hook is deliberately thin: it is the remembered value plus a setter that
 * writes through. It holds no form state and knows nothing about registrations
 * or responses, which is what lets the same three lines serve a form with ten
 * fields and a scanner with none.
 */

export interface EventLocationState {
  /**
   * The chosen city, or null when this device has not chosen one.
   *
   * Null is the state a fresh install is in, and it is also the state an
   * install with a stale or unrecognised stored value is in: the reader
   * validates, so an unusable preference is indistinguishable from no
   * preference, and both put the operator in front of the selector.
   */
  readonly location: EventLocation | null
  /** Chooses a city and remembers it on this device for this event. */
  readonly setLocation: (next: EventLocation) => void
  /** True once a valid city has been chosen. The gate both stations check. */
  readonly ready: boolean
}

export function useEventLocation(): EventLocationState {
  /*
   * Read once, in the initialiser, rather than in an effect.
   *
   * An effect would render the screen once with no location, which on a device
   * that has been set up for hours is a visible flash of "choose a location"
   * over a form the operator was about to type into. Reading synchronously also
   * means the first draft the form builds already carries the right city, so
   * there is no second render that replaces what the operator is looking at.
   */
  const [location, setStored] = useState<EventLocation | null>(() =>
    readRememberedLocation(EVENT_CONFIG.eventId),
  )

  const setLocation = useCallback((next: EventLocation) => {
    // Written through immediately rather than on submit. The operator changed
    // the city because the device is now at that city, and a crash or a reload
    // between the change and the next rider must not lose that.
    rememberLocation(EVENT_CONFIG.eventId, next)
    setStored(next)
  }, [])

  return { location, setLocation, ready: location !== null }
}
