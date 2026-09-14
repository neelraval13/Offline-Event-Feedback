import { EVENT_LOCATIONS, type EventLocation } from '../../config/eventLocations'

/*
 * All locations / Bengaluru / Hyderabad, as a filter.
 *
 * The same control on both browsers, because it answers the same question on
 * both and an organiser switching tabs should not have to relearn it. It is
 * built like the status filter beside it, buttons rather than a dropdown, so
 * the current selection is visible without opening anything.
 *
 * ## "All locations" is first, and is the default
 *
 * The September event is one event in two cities. The combined view is the
 * event, and the per-city views are ways of looking into it, so the combined
 * view is what a reader lands on. Defaulting to a city would quietly halve
 * every figure on screen.
 *
 * ## Filtering by a city never hides the unlocated
 *
 * It does, in fact, and that is why the caller states the count. Responses
 * captured before locations existed match no city, so they vanish from a
 * filtered view. That is correct behaviour for a filter and would be a
 * misleading total without a note, which is why the tables print how many rows
 * they are showing.
 */

export type LocationFilterValue = EventLocation | 'all'

interface LocationFilterProps {
  readonly value: LocationFilterValue
  readonly onChange: (next: LocationFilterValue) => void
  /** Distinguishes the two instances for assistive technology. */
  readonly label: string
}

export function LocationFilter({ value, onChange, label }: LocationFilterProps) {
  const options: LocationFilterValue[] = ['all', ...EVENT_LOCATIONS]

  return (
    <div className="button-row" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className="choice"
          aria-pressed={value === option}
          data-testid={`location-filter-${option}`}
          onClick={() => onChange(option)}
        >
          {option === 'all' ? 'All locations' : option}
        </button>
      ))}
    </div>
  )
}
