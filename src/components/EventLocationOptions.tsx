import { EVENT_LOCATIONS } from '../config/eventLocations'

/*
 * The `<option>` list for a location selector, and nothing else.
 *
 * Point A needs this inside a `BrandField` on the campaign form; Point B needs
 * it in a standalone control above the scanner. The two wrappers look nothing
 * alike, so what is shared is the part that must not differ: the cities, their
 * order, and the wording of the unchosen state.
 *
 * Sharing the whole control instead would have meant one component with a
 * variant flag, which is two components pretending to be one. Sharing only the
 * options keeps the markup honest at both call sites.
 */

interface EventLocationOptionsProps {
  /**
   * The unchosen placeholder, or false to omit it.
   *
   * Omitted once a city has been chosen: leaving "Select location" in the list
   * offers going back to nothing, which is not a state the operator should be
   * able to re-enter by a mis-tap.
   */
  readonly placeholder?: string | false
}

export function EventLocationOptions({
  placeholder = 'Select location',
}: EventLocationOptionsProps) {
  return (
    <>
      {placeholder !== false && (
        /*
         * An empty value, deliberately, and deliberately not disabled.
         *
         * The empty string is what validation recognises as "not chosen", so
         * the placeholder cannot be mistaken for a city by anything downstream.
         * It stays selectable rather than disabled so that a screen reader
         * announces the real initial state of the control instead of skipping
         * to the first city and implying one was picked.
         */
        <option value="">{placeholder}</option>
      )}
      {EVENT_LOCATIONS.map((location) => (
        <option key={location} value={location}>
          {location}
        </option>
      ))}
    </>
  )
}
