import { EVENT_CONFIG } from '../../../../config/event'
import { formatEventDay } from '../../../../config/eventTime'
import { FLYING_FLEA_CAMPAIGN } from '../config'

/*
 * Where the event is and when: stated, never asked.
 *
 * This replaces two form controls. It is deliberately not a disabled input or a
 * read-only field: those read as "something you could have changed", they take
 * a tab stop, and staff scanning the form for what still needs typing have to
 * skip them every time. This is a caption, and it looks like one.
 *
 * It sits under the banner rather than over the photograph, so the hero's
 * geometry is unchanged and the text is read against a solid background rather
 * than a gradient.
 *
 * The two values are the same ones the records carry: the venue is the venue
 * stamped onto every registration, and the day is the day stamped onto every
 * record captured at either station. Showing anything else here would be a
 * second source of truth about the event.
 */

export function EventMeta() {
  return (
    <p className="ff-event-meta">
      <span className="ff-event-meta__venue">
        {FLYING_FLEA_CAMPAIGN.lockedLocation}
      </span>
      <span className="ff-event-meta__date">
        {formatEventDay(EVENT_CONFIG.eventDay)}
      </span>
    </p>
  )
}
