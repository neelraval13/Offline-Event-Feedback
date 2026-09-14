import { EVENT_CONFIG } from '../../../../config/event'
import { EVENT_LOCATIONS, type EventLocation } from '../../../../config/eventLocations'
import { formatEventDay } from '../../../../config/eventTime'

/*
 * Where the event is and when: stated, never asked.
 *
 * This replaces a form control for the date. It is deliberately not a disabled
 * input or a read-only field: those read as "something you could have changed",
 * they take a tab stop, and staff scanning the form for what still needs typing
 * have to skip them every time. This is a caption, and it looks like one.
 *
 * It sits under the banner rather than over the photograph, so the hero's
 * geometry is unchanged and the text is read against a solid background rather
 * than a gradient.
 *
 * ## The venue is no longer a single fact, so this caption has two modes
 *
 * The September event runs in Bengaluru and Hyderabad on the same day. There is
 * therefore no one venue to state, and a caption that named one would be
 * telling the operator something false on half the devices at the event.
 *
 * With a `location`, this reports what THIS DEVICE is recording, which is the
 * question an operator at a desk actually has. Without one, it describes the
 * event as a whole, which is the honest answer on a screen that is not
 * capturing anything.
 *
 * The device's city is stated here rather than only inside the form's selector
 * because the selector is one control among ten and reads as an input to fill
 * in. This line reads as a statement of fact about the desk, which is what
 * makes a wrongly-set tablet noticeable before a hundred records carry the
 * wrong city rather than after.
 */

interface EventMetaProps {
  /**
   * The city this device is recording, or null for the event in general.
   *
   * Null is not a failure state and is not styled as one. The home screen has
   * no station and legitimately has no city.
   */
  readonly location?: EventLocation | null
}

/** How the event is described when no single city applies. */
export const ALL_EVENT_LOCATIONS_LABEL = EVENT_LOCATIONS.join(' / ')

export function EventMeta({ location = null }: EventMetaProps) {
  return (
    <p className="ff-event-meta">
      <span className="ff-event-meta__venue" data-testid="event-meta-venue">
        {location ?? ALL_EVENT_LOCATIONS_LABEL}
      </span>
      <span className="ff-event-meta__date">
        {formatEventDay(EVENT_CONFIG.eventDay)}
      </span>
    </p>
  )
}
