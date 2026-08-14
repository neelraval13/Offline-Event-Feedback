import { Ffc6Mark } from './marks/Ffc6Mark'
import { ParachuteMark } from './marks/ParachuteMark'

/*
 * The campaign topbar: parachute, wordmark, and the venue this device is
 * standing in.
 *
 * The venue badge is not decoration. Two locations run simultaneously in this
 * campaign, and a tablet carried between them that still claims the old venue
 * mislabels every registration taken after the move.
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
