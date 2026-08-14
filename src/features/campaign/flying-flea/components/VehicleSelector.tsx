import { FLYING_FLEA_CAMPAIGN } from '../config'

/*
 * Which bike the rider took out.
 *
 * The number-plate treatment is the supplied design's, and it earns its place
 * operationally: four identical bikes stand in a row at the venue and staff read
 * the plate off the one that just came back. A dropdown of the same four strings
 * would be quicker to build and slower to use.
 *
 * They are real buttons with `aria-pressed`, so selection is not carried by
 * colour alone and the control works from a keyboard.
 */

interface VehicleSelectorProps {
  readonly value: string | null
  readonly onChange: (vehicle: string) => void
  readonly error?: string | undefined
  readonly disabled?: boolean
}

export function VehicleSelector({
  value,
  onChange,
  error,
  disabled = false,
}: VehicleSelectorProps) {
  return (
    <>
      <div className="ff-plates" role="group" aria-label="Select vehicle number">
        {FLYING_FLEA_CAMPAIGN.vehicles.map((vehicle) => (
          <button
            key={vehicle}
            type="button"
            className="ff-plate"
            aria-pressed={value === vehicle}
            disabled={disabled}
            onClick={() => onChange(vehicle)}
          >
            {vehicle}
          </button>
        ))}
      </div>
      {error !== undefined && (
        <p className="ff-field__error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
