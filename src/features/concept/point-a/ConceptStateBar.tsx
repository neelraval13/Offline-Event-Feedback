import { FlaskConicalIcon } from 'lucide-react'
import { cn } from '@/lib/ui/cn'

/*
 * The design-review tool. NOT part of the proposed interface.
 *
 * Point A is a stateful operational surface, and eight of its states are the
 * ones worth arguing about: a blank desk is the easy screen. Reviewing the
 * other seven by inducing them for real would mean filling a database, breaking
 * a QR renderer and unplugging a tablet, so they are selectable here instead.
 *
 * It is deliberately ugly in the specific sense of being visually foreign: a
 * dashed amber rail, outside the terminal, labelled as scaffolding. Nothing
 * about it should be mistakable for a proposal, and nothing below it borrows
 * anything from it. When the concept is approved this file is deleted and no
 * other file changes.
 */

export type ConceptState =
  | 'new'
  | 'saving'
  | 'saved'
  | 'sticker-failed'
  | 'save-failed'
  | 'correction'
  | 'recovery'
  | 'storage-blocked'

const STATES: readonly { readonly key: ConceptState; readonly label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'saving', label: 'Saving' },
  { key: 'saved', label: 'Saved' },
  { key: 'sticker-failed', label: 'Sticker failed' },
  { key: 'save-failed', label: 'Save failed' },
  { key: 'correction', label: 'Correction' },
  { key: 'recovery', label: 'Recovery' },
  { key: 'storage-blocked', label: 'Storage blocked' },
]

interface ConceptStateBarProps {
  readonly value: ConceptState
  readonly onChange: (state: ConceptState) => void
  /** Whether a print has been attempted, for the saved-state hierarchy. */
  readonly printed: boolean
  readonly onPrintedChange: (printed: boolean) => void
}

export function ConceptStateBar({
  value,
  onChange,
  printed,
  onPrintedChange,
}: ConceptStateBarProps) {
  const showsPrinted = value === 'saved'

  return (
    <div className="rounded-card border border-dashed border-busy-line bg-busy-soft/40 p-3">
      <p className="flex items-center gap-2 pb-2 font-ui text-caption font-semibold uppercase tracking-[0.16em] text-busy">
        <FlaskConicalIcon aria-hidden="true" className="size-3.5" />
        Design review tool, not part of the interface
      </p>

      <div role="group" aria-label="Concept state" className="flex flex-wrap gap-1.5">
        {STATES.map((state) => (
          <button
            key={state.key}
            type="button"
            aria-pressed={state.key === value}
            onClick={() => onChange(state.key)}
            className={cn(
              'min-h-9 rounded-chip border px-3 font-ui text-small font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive',
              state.key === value
                ? 'border-busy bg-busy/20 text-ink'
                : 'border-line bg-canvas/40 text-muted hover:text-ink',
            )}
          >
            {state.label}
          </button>
        ))}
      </div>

      {showsPrinted && (
        <label className="mt-2.5 flex min-h-9 items-center gap-2 font-ui text-small text-muted">
          <input
            type="checkbox"
            checked={printed}
            onChange={(event) => onPrintedChange(event.target.checked)}
            className="size-4 accent-[var(--color-interactive)]"
          />
          A print has been attempted
          <span className="text-faint">
            (the terminal does not track this today, see the report)
          </span>
        </label>
      )}
    </div>
  )
}
