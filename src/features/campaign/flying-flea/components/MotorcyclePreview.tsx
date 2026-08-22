import { cn } from '../../../../lib/ui/cn'
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
 * Unchanged from V1, and it matters more here than in the reference it came
 * from: a tablet that has been offline since the morning must switch instantly,
 * and an image mounted only when its colour is chosen would be decoded at the
 * moment of the tap. Both are precached, both are decoded on first paint, and
 * the switch is a composited opacity change.
 *
 * ## Why the frame is bounded by height rather than by aspect ratio
 *
 * The space is still reserved, so selecting a colour never moves the form under
 * the operator's finger. But height is the scarce resource on a screen an
 * operator returns to several hundred times a shift, and an aspect ratio spends
 * whatever the column happens to be: at the station measure a 16:9 frame came
 * out 392px tall, a third of a tablet viewport for one binary answer. A fixed
 * height reserves just as reliably, and `object-contain` keeps the bike whole
 * at whatever width it is given, so nothing is ever cropped.
 */

interface MotorcyclePreviewProps {
  readonly colour: FlyingFleaColour
}

const COLOURS = Object.keys(MOTORCYCLE_IMAGES) as FlyingFleaColour[]

export function MotorcyclePreview({ colour }: MotorcyclePreviewProps) {
  return (
    <div className="relative h-44 w-full overflow-hidden rounded-card border border-line bg-surface sm:h-52">
      {COLOURS.map((key) => {
        const shown = key === colour

        return (
          <img
            key={key}
            /*
             * Which photograph is painted, as data rather than as a class name.
             * V1's tests read this off `.ff-bike__image--shown`, which tied a
             * behavioural guarantee to a stylesheet; the guarantee is that the
             * picture follows the persisted colour, and it should survive any
             * restyling.
             */
            data-motorcycle={key}
            data-shown={shown ? 'true' : 'false'}
            src={MOTORCYCLE_IMAGES[key]}
            /*
             * Only the visible motorcycle is announced. The other is present
             * purely so the switch needs no network and no decode, and an empty
             * alt keeps it out of the accessibility tree.
             */
            alt={shown ? MOTORCYCLE_ALT[key] : ''}
            aria-hidden={shown ? undefined : true}
            loading="eager"
            decoding="sync"
            draggable={false}
            className={cn(
              'absolute inset-0 size-full object-contain p-3',
              'transition-opacity duration-200',
              shown ? 'opacity-100' : 'opacity-0',
            )}
          />
        )
      })}

      <p className="absolute bottom-2 left-3 font-ui text-caption font-semibold uppercase tracking-[0.16em] text-faint">
        {colour}
      </p>
    </div>
  )
}
