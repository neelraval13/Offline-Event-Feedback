import { Ffc6Mark } from './marks/Ffc6Mark'
import { ParachuteMark } from './marks/ParachuteMark'

/*
 * The campaign topbar: parachute, wordmark, and the venue this device is
 * standing in.
 *
 * The venue is optional here. Point A and Point B state it, with the event
 * date, in `EventMeta` under the banner, so they pass nothing and the badge
 * does not render twice on one screen. The home screen, which has no banner,
 * still uses it.
 */

interface FlyingFleaBrandHeaderProps {
  readonly venue?: string | undefined
}

export function FlyingFleaBrandHeader({ venue }: FlyingFleaBrandHeaderProps) {
  return (
    <div className="ff-topbar">
      <span className="ff-topbar__marks">
        <ParachuteMark height={30} />
        <Ffc6Mark height={14} />
      </span>
      {venue !== undefined && venue.length > 0 && (
        <span className="ff-topbar__venue">{venue}</span>
      )}
    </div>
  )
}
