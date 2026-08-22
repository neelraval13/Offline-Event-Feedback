import { CheckIcon } from 'lucide-react'
import { cn } from '../../../../lib/ui/cn'
import type { FlyingFleaColour } from '../../../../types'
import { COLOUR_SWATCHES, FLYING_FLEA_CAMPAIGN } from '../config'

/*
 * Which colour the rider is interested in.
 *
 * Single-select, because the supplied control is a two-position toggle that
 * always holds exactly one colour; it cannot express "both" or "neither", and
 * turning it into a multi-select here would produce answers the campaign's own
 * form could never produce.
 *
 * Two labelled swatches rather than the reference's image-driven switch, which
 * depended on two remotely-hosted photographs this application deliberately does
 * not load. What V2 adds is a tick on the chosen one: on a control whose whole
 * subject is colour, conveying the *selection* by colour is the worst possible
 * place to do it.
 *
 * The accessible name is the colour, and the button's text is the colour, so
 * this reads correctly to a screen reader and matches what an operator says out
 * loud.
 */

interface ColourSelectorProps {
  readonly value: FlyingFleaColour
  readonly onChange: (colour: FlyingFleaColour) => void
  readonly disabled?: boolean
}

export function ColourSelector({
  value,
  onChange,
  disabled = false,
}: ColourSelectorProps) {
  return (
    <div
      role="group"
      aria-label="Interested in colour?"
      className="flex flex-col gap-2"
    >
      {FLYING_FLEA_CAMPAIGN.colours.map((colour) => {
        const selected = value === colour

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
  )
}
