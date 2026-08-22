import type { ReactNode } from 'react'
import { cn } from '../../../../lib/ui/cn'

/*
 * One question, as a band.
 *
 * The shared shape behind both a rating question and a free-text one: a lime
 * numeral, the prompt, the control, and a rule above. Numbering is presentation
 * and comes from the question's position in the campaign's own arrays, so
 * adding a question renumbers the list rather than stranding it.
 *
 * The prompt is rendered exactly as the campaign asks it. This component never
 * abbreviates one to fit a layout, and it wraps rather than truncating.
 *
 * `tone` is how required and optional are told apart without adding a word to
 * either: a rating prompt is the reading weight of the page, and a free-text
 * prompt is a step quieter, sitting under the "In your own words" divider that
 * already says the rest is optional. Nothing is marked "required", because
 * three quarters of the questions are and a badge on each would be noise.
 *
 * `promptId` exists so a rating scale can point at the prompt with
 * `aria-labelledby`; a text question labels its own control instead and passes
 * `htmlFor`.
 */

interface QuestionBandProps {
  readonly number: number
  readonly prompt: string
  readonly promptId?: string
  /** Renders the prompt as a `<label>` for the control with this id. */
  readonly htmlFor?: string
  readonly tone: 'required' | 'optional'
  readonly children: ReactNode
}

export function QuestionBand({
  number,
  prompt,
  promptId,
  htmlFor,
  tone,
  children,
}: QuestionBandProps) {
  const promptClass = cn(
    'min-w-0 font-body text-lead',
    tone === 'required' ? 'text-ink' : 'text-muted',
  )

  return (
    <div className="flex flex-col gap-3 border-t border-line py-5">
      <div className="flex items-baseline gap-3">
        <span
          aria-hidden="true"
          className="font-display text-lead leading-none tracking-wide text-accent tabular-nums"
        >
          {String(number).padStart(2, '0')}
        </span>

        {htmlFor === undefined ? (
          <p {...(promptId === undefined ? {} : { id: promptId })} className={promptClass}>
            {prompt}
          </p>
        ) : (
          <label htmlFor={htmlFor} className={promptClass}>
            {prompt}
          </label>
        )}
      </div>

      {/* Indented under the numeral above `sm`, full width on a phone. */}
      <div className="sm:pl-9">{children}</div>
    </div>
  )
}
