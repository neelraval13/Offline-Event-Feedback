import { FlaskConicalIcon } from 'lucide-react'
import { cn } from '@/lib/ui/cn'

/*
 * The design-review tool. NOT part of the proposed interface.
 *
 * Point B is the most stateful surface in the product: ten states in the real
 * machine, and seventeen distinct things to look at once failures and partial
 * answers are counted. Reviewing them by inducing them for real would mean
 * refusing a camera permission, scanning a wrong sticker, filling a database and
 * breaking a write, so they are selectable here instead.
 *
 * Deliberately foreign-looking: a dashed amber rail, outside the terminal,
 * labelled as scaffolding. Nothing about it should be mistakable for a proposal,
 * and nothing below it borrows anything from it. When the concept is approved
 * this file is deleted and no other file changes.
 */

export type ConceptState =
  | 'start'
  | 'starting'
  | 'scanning'
  | 'bad-qr'
  | 'camera-error'
  | 'manual'
  | 'manual-error'
  | 'feedback'
  | 'feedback-partial'
  | 'feedback-failed'
  | 'saving'
  | 'already-recorded'
  | 'contact'
  | 'contact-error'
  | 'contact-partial'
  | 'contact-failed'
  | 'success'

/** Grouped the way the real machine groups them, so the list reads as a map. */
const GROUPS: readonly {
  readonly label: string
  readonly states: readonly { readonly key: ConceptState; readonly label: string }[]
}[] = [
  {
    label: 'Identify',
    states: [
      { key: 'start', label: 'Start' },
      { key: 'starting', label: 'Starting' },
      { key: 'scanning', label: 'Scanning' },
      { key: 'bad-qr', label: 'Bad QR' },
      { key: 'camera-error', label: 'Camera error' },
      { key: 'manual', label: 'Manual' },
      { key: 'manual-error', label: 'Manual error' },
    ],
  },
  {
    label: 'Sticker path',
    states: [
      { key: 'feedback', label: 'Feedback' },
      { key: 'feedback-partial', label: 'Part answered' },
      { key: 'saving', label: 'Saving' },
      { key: 'feedback-failed', label: 'Save failed' },
      { key: 'already-recorded', label: 'Already recorded' },
    ],
  },
  {
    label: 'Contact path',
    states: [
      { key: 'contact', label: 'Contact' },
      { key: 'contact-partial', label: 'Part answered' },
      { key: 'contact-error', label: 'Validation errors' },
      { key: 'contact-failed', label: 'Save failed' },
    ],
  },
  {
    label: 'Done',
    states: [{ key: 'success', label: 'Success' }],
  },
]

interface ConceptStateBarProps {
  readonly value: ConceptState
  readonly onChange: (state: ConceptState) => void
}

export function ConceptStateBar({ value, onChange }: ConceptStateBarProps) {
  return (
    <div className="rounded-card border border-dashed border-busy-line bg-busy-soft/40 p-3">
      <p className="flex items-center gap-2 pb-2 font-ui text-caption font-semibold uppercase tracking-[0.16em] text-busy">
        <FlaskConicalIcon aria-hidden="true" className="size-3.5" />
        Design review tool, not part of the interface
      </p>

      <div className="flex flex-col gap-2">
        {GROUPS.map((group) => (
          <div key={group.label} className="flex flex-wrap items-center gap-1.5">
            <span className="w-24 shrink-0 font-ui text-caption uppercase tracking-[0.1em] text-faint">
              {group.label}
            </span>
            <div
              role="group"
              aria-label={`${group.label} states`}
              className="flex flex-wrap gap-1.5"
            >
              {group.states.map((state) => (
                <button
                  key={state.key}
                  type="button"
                  aria-pressed={state.key === value}
                  onClick={() => onChange(state.key)}
                  className={cn(
                    'min-h-8 rounded-chip border px-2.5 font-ui text-small transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive',
                    state.key === value
                      ? 'border-busy bg-busy/20 font-medium text-ink'
                      : 'border-line bg-canvas/40 text-muted hover:text-ink',
                  )}
                >
                  {state.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
