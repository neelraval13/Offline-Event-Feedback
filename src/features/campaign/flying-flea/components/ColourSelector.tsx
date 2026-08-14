import type { FlyingFleaColour } from '../../../../types'
import { COLOUR_SWATCHES, FLYING_FLEA_CAMPAIGN } from '../config'

/*
 * Which colour the rider is interested in.
 *
 * Single-select, because the supplied control is a two-position toggle that
 * always holds exactly one colour — it cannot express "both" or "neither", and
 * turning it into a multi-select here would produce answers the campaign's own
 * form could never produce.
 *
 * The toggle motif is not reproduced literally. A switch whose meaning is
 * carried by which bike photograph is showing depends on two remotely-hosted
 * images that this application deliberately does not load, and a switch with no
 * image is a control with no visible options. Two labelled swatches say the same
 * thing, stay operable from a keyboard, and read correctly to a screen reader.
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
    <div className="ff-colours" role="group" aria-label="Interested in colour?">
      {FLYING_FLEA_CAMPAIGN.colours.map((colour) => (
        <button
          key={colour}
          type="button"
          className="ff-colour"
          aria-pressed={value === colour}
          disabled={disabled}
          onClick={() => onChange(colour)}
        >
          <span
            className="ff-colour__swatch"
            style={{ background: COLOUR_SWATCHES[colour] }}
            aria-hidden="true"
          />
          {colour}
        </button>
      ))}
    </div>
  )
}
