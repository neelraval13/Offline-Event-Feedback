/*
 * Where this event is being run.
 *
 * The September event is one event in two cities on the same day. That is the
 * whole reason this module exists: the venue used to be a property of the
 * deployment, one address compiled into the build, and it is now a property of
 * each record, chosen on the device by the person operating it.
 *
 * ## One list, two stations
 *
 * Point A stamps a location onto every registration and Point B stamps one onto
 * every response. Both read the list from here. Writing `'Bengaluru'` into a
 * component instead would put the same two strings in at least four files, and
 * the one that gets missed is the one that silently writes a city nobody can
 * filter on: a reporting breakdown would then show `Bengaluru`, `Hyderabad` and
 * `bengaluru` as three venues.
 *
 * ## Why this is not in `shared/`
 *
 * The server deliberately does NOT enforce this list. It accepts any bounded
 * string as a location, exactly as it always has, because it holds August's
 * records too and those carry `Richardson & Cruddas`. A server that rejected
 * anything outside this list would refuse an August tablet's last unsynced
 * record, which is the one thing an offline-first system must never do.
 *
 * So this is a client-side deployment fact, like the vehicle list: it decides
 * what an operator may choose today, not what the database may hold. The bound
 * that both sides agree on is `MAX_LOCATION_LENGTH`, and that one IS shared.
 *
 * ## Changing this list
 *
 * Adding a city is a code change and should be. These strings are written into
 * records permanently and are grouped on by every report, so they are the kind
 * of value that has to be reviewed once rather than typed at a desk.
 */

/**
 * The cities this event runs in. Exactly these two, in the order they appear to
 * the operator.
 */
export const EVENT_LOCATIONS = ['Bengaluru', 'Hyderabad'] as const

/**
 * A location this build will accept.
 *
 * A literal union rather than `string`, so a component cannot pass a typo to
 * the store and a reader narrowing on it gets the two real cases.
 */
export type EventLocation = (typeof EVENT_LOCATIONS)[number]

/**
 * Whether a value is one of this event's locations.
 *
 * Used at every boundary where a location arrives as an unchecked string: the
 * remembered browser preference, a restored draft, a correction's stored value.
 * Anything else is treated as absent rather than as a location, which is what
 * stops a stale preference from an older event being silently trusted.
 */
export function isEventLocation(value: unknown): value is EventLocation {
  return (
    typeof value === 'string' &&
    (EVENT_LOCATIONS as readonly string[]).includes(value)
  )
}
