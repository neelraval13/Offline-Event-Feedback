import type { FlyingFleaColour } from '../../../../types'
import { ColourSelector } from './ColourSelector'
import { MotorcyclePreview } from './MotorcyclePreview'

/*
 * "Interested in Color?": the picture and the choice, as one thing.
 *
 * The reference presents these as a single card: the bike fills it, and the
 * control changes which bike you are looking at. Composing them here rather than
 * placing two components side by side in the form is what keeps that
 * relationship explicit, and stops the next change from wiring the image to
 * some other piece of state.
 *
 * There is exactly one source of truth: the `colour` prop, which is the value
 * the registration will persist. The preview is a function of it. Nothing here
 * holds state, and no other registration field is touched by changing it.
 *
 * V2 puts the two beside each other above 640px instead of stacking them. The
 * relationship is the same and reads better for it: the control is next to the
 * thing it changes rather than below the fold from it, and the whole of step 02
 * becomes one band instead of most of a tablet screen.
 */

interface MotorcycleColourExperienceProps {
  readonly value: FlyingFleaColour
  readonly onChange: (colour: FlyingFleaColour) => void
  readonly disabled?: boolean
}

export function MotorcycleColourExperience({
  value,
  onChange,
  disabled = false,
}: MotorcycleColourExperienceProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-center sm:gap-6">
      <MotorcyclePreview colour={value} />
      <ColourSelector value={value} onChange={onChange} disabled={disabled} />
    </div>
  )
}
