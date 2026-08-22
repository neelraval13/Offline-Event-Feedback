import { CheckIcon } from 'lucide-react'
import { cn } from '@/lib/ui/cn'

/*
 * Which bike the rider is taking out.
 *
 * The plate treatment survives from V1 and should: four identical motorcycles
 * stand in a row at the venue and the operator reads the number off the one
 * that just came back. A dropdown of the same four strings would be quicker to
 * build and slower to use, and §9 is right to protect it.
 *
 * What changes is everything about how a plate reads:
 *
 *   - The number is the size of the number on the bike. V1 set the whole label
 *     at body size, so "Vehicle 3" was a sentence to read rather than a numeral
 *     to recognise, and recognition is what happens at arm's length.
 *   - Selection carries a tick as well as a colour and a border. V1's selected
 *     plate was distinguished by fill alone, which is the one thing §24 rules
 *     out, and these screens are read outdoors where two dark fills converge.
 *   - The whole plate is the target, 72px tall, not a text-sized button.
 *
 * Real `<button aria-pressed>` in a labelled group, so this is operable from a
 * keyboard and announced correctly, exactly as V1 already had it.
 */

interface VehiclePlatesProps {
  readonly vehicles: readonly string[]
  readonly value: string | null
  readonly onChange: (vehicle: string) => void
  readonly error?: string | undefined
  readonly disabled?: boolean
}

/**
 * Splits "Vehicle 3" into its word and its numeral.
 *
 * Campaign labels are configuration, so this must not assume a shape. Anything
 * without a trailing token is rendered whole rather than mangled into a plate
 * it does not fit.
 */
function plateParts(label: string): { prefix: string | null; figure: string } {
  const match = /^(.*\S)\s+(\S+)$/.exec(label)

  return match === null
    ? { prefix: null, figure: label }
    : { prefix: match[1] as string, figure: match[2] as string }
}

export function VehiclePlates({
  vehicles,
  value,
  onChange,
  error,
  disabled = false,
}: VehiclePlatesProps) {
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="Select vehicle number"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3"
      >
        {vehicles.map((vehicle) => {
          const selected = value === vehicle
          const { prefix, figure } = plateParts(vehicle)

          return (
            <button
              key={vehicle}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(vehicle)}
              className={cn(
                'relative flex min-h-[5rem] flex-col items-center justify-center gap-1',
                'rounded-control border px-2 py-3 transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
                'disabled:cursor-not-allowed disabled:opacity-45',
                selected
                  ? 'border-interactive bg-interactive-soft'
                  : 'border-line bg-surface hover:border-line-strong hover:bg-raised',
              )}
            >
              {prefix !== null && (
                <span
                  className={cn(
                    /*
                     * Quiet, and narrow. The word is the same on all four
                     * plates, so it carries no information; letting it set the
                     * width made every plate read as the word rather than as
                     * the number, which is the one thing that differs.
                     */
                    'font-ui text-caption font-semibold uppercase tracking-[0.1em]',
                    selected ? 'text-interactive' : 'text-faint',
                  )}
                >
                  {prefix}
                </span>
              )}
              <span
                className={cn(
                  'font-display text-display leading-none tracking-wide tabular-nums',
                  selected ? 'text-ink' : 'text-muted',
                )}
              >
                {figure}
              </span>

              {/* The second signal. Selection never rests on the fill alone. */}
              {selected && (
                <CheckIcon
                  aria-hidden="true"
                  className="absolute top-2 right-2 size-4 text-interactive"
                />
              )}
            </button>
          )
        })}
      </div>

      {error !== undefined && (
        <p role="alert" className="font-ui text-small font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
