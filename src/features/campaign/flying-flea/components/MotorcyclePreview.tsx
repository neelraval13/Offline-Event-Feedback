import type { FlyingFleaColour } from '../../../../types'
import { MOTORCYCLE_ALT, MOTORCYCLE_IMAGES } from '../assets'

/*
 * The motorcycle, in the colour currently selected.
 *
 * Presentation only: it takes the selected colour and renders the matching
 * local image. It holds no state, so the picture cannot disagree with the answer
 * that will be stored.
 *
 * ## Why both images are always in the DOM
 *
 * The reference cross-fades between two `<img>` elements that are both present,
 * toggling opacity. That is kept, and it matters more here than there: a tablet
 * that has been offline since the morning must switch instantly, and an image
 * mounted only when its colour is chosen would be decoded at the moment of the
 * tap. Both are precached, both are decoded on first paint, and the switch is a
 * composited opacity change.
 *
 * The frame reserves its space with `aspect-ratio`, so selecting a colour never
 * moves the form under the operator's finger. Both photographs share a canvas
 * and are drawn with `object-fit: contain`, so the bike keeps its proportions
 * and nothing (wheel, mirror, tail) is ever cropped away.
 */

interface MotorcyclePreviewProps {
  readonly colour: FlyingFleaColour
}

const COLOURS = Object.keys(MOTORCYCLE_IMAGES) as FlyingFleaColour[]

export function MotorcyclePreview({ colour }: MotorcyclePreviewProps) {
  return (
    <div className="ff-bike">
      <div className="ff-bike__stage">
        {COLOURS.map((key) => {
          const shown = key === colour

          return (
            <img
              key={key}
              className={`ff-bike__image${shown ? ' ff-bike__image--shown' : ''}`}
              src={MOTORCYCLE_IMAGES[key]}
              /*
               * Only the visible motorcycle is announced. The other is present
               * purely so the switch needs no network and no decode, and an
               * empty alt keeps it out of the accessibility tree.
               */
              alt={shown ? MOTORCYCLE_ALT[key] : ''}
              aria-hidden={shown ? undefined : true}
              loading="eager"
              decoding="sync"
              draggable={false}
            />
          )
        })}
      </div>

      <p className="ff-bike__caption">{colour}</p>
    </div>
  )
}
