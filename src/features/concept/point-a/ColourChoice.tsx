import { CheckIcon } from 'lucide-react'
import { MOTORCYCLE_ALT, MOTORCYCLE_IMAGES } from '@/features/campaign/flying-flea/assets'
import { COLOUR_SWATCHES } from '@/features/campaign/flying-flea/config'
import type { FlyingFleaColour } from '@/types'
import { cn } from '@/lib/ui/cn'

/*
 * "Interested in colour?": the motorcycle and the choice, as one control.
 *
 * The relationship V1 established is preserved exactly, and it is the good part
 * of the existing screen: there is one source of truth, the colour that will be
 * persisted, and the photograph is a function of it. Nothing here holds state.
 *
 * Two V1 properties are carried over deliberately, because losing them would
 * break the screen in ways that only show up at a venue:
 *
 *   - Both images stay in the DOM and cross-fade on opacity. A tablet that has
 *     been offline since the morning must switch instantly, and an image
 *     mounted at the moment of the tap would be decoded then. Both are
 *     precached and both are decoded on first paint.
 *   - The frame reserves its space with `aspect-ratio`, so choosing a colour
 *     never moves the form under the operator's finger.
 *
 * What changes is the arrangement. V1 stacked the picture above the swatches
 * inside a card, which cost most of a tablet viewport for one binary answer.
 * Here the photograph and the two choices sit side by side above 640px, so the
 * whole of step 02 is one band rather than one screen.
 *
 * The assets are the campaign's own local files. Nothing is fetched.
 */

interface ColourChoiceProps {
  readonly colours: readonly FlyingFleaColour[]
  readonly value: FlyingFleaColour
  readonly onChange: (colour: FlyingFleaColour) => void
  readonly disabled?: boolean
}

const ALL_COLOURS = Object.keys(MOTORCYCLE_IMAGES) as FlyingFleaColour[]

export function ColourChoice({
  colours,
  value,
  onChange,
  disabled = false,
}: ColourChoiceProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-center sm:gap-6">
      {/*
        The motorcycle, in the colour currently chosen.

        Bounded by height rather than by aspect ratio. Height is the scarce
        resource on a screen an operator returns to several hundred times, and
        an aspect ratio spends whatever the column happens to be: at the station
        measure a 16:9 frame came out 392px tall, which is a third of a tablet
        viewport for one binary answer. A fixed height reserves its space just
        as reliably, so choosing a colour still never moves the form, and
        `object-contain` keeps the bike whole at whatever width it is given.
      */}
      <div className="relative h-44 w-full overflow-hidden rounded-card border border-line bg-surface sm:h-52">
        {ALL_COLOURS.map((colour) => {
          const shown = colour === value

          return (
            <img
              key={colour}
              src={MOTORCYCLE_IMAGES[colour]}
              /*
               * Only the visible motorcycle is announced. The other is present
               * purely so the switch needs no network and no decode.
               */
              alt={shown ? MOTORCYCLE_ALT[colour] : ''}
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

        <span className="absolute bottom-2 left-3 font-ui text-caption font-semibold uppercase tracking-[0.16em] text-faint">
          {value}
        </span>
      </div>

      <div
        role="group"
        aria-label="Interested in colour?"
        className="flex flex-col gap-2"
      >
        {colours.map((colour) => {
          const selected = colour === value

          return (
            <button
              key={colour}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(colour)}
              className={cn(
                'flex min-h-touch items-center gap-3 rounded-control border px-3.5 py-2.5',
                'font-ui text-base font-medium transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
                'disabled:cursor-not-allowed disabled:opacity-45',
                selected
                  ? 'border-interactive bg-interactive-soft text-ink'
                  : 'border-line bg-surface text-muted hover:border-line-strong hover:bg-raised hover:text-ink',
              )}
            >
              <span
                aria-hidden="true"
                className="size-6 shrink-0 rounded-chip border border-line-strong"
                style={{ background: COLOUR_SWATCHES[colour] }}
              />
              <span className="min-w-0 flex-1 text-left">{colour}</span>
              {/* Never colour alone, least of all on a colour picker. */}
              {selected && (
                <CheckIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-interactive"
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
