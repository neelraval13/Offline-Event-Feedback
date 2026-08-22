import { FlaskConicalIcon } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import type { DataState, RunState, Section, SessionState } from './fixtures'

/*
 * The design-review tool. NOT part of the proposed interface.
 *
 * Reporting has four axes that genuinely compose: where the operator is in the
 * credential flow, which reconciliation run the screen is reading, which
 * section is open, and what the data looks like. A flat list of states would be
 * a list of every combination, and the interesting states are combinations:
 * Export on a stale run, Responses with mixed questionnaires.
 *
 * Deliberately foreign-looking, and outside the workspace: a dashed amber rail
 * labelled as scaffolding. When the concept is approved this file is deleted
 * and no other file changes.
 */

interface Axis<T extends string> {
  readonly label: string
  readonly value: T
  readonly onChange: (value: T) => void
  readonly options: readonly { readonly key: T; readonly label: string }[]
}

const SESSION: Axis<SessionState>['options'] = [
  { key: 'logged-out', label: 'Logged out' },
  { key: 'rejected', label: 'Rejected secret' },
  { key: 'signed-in', label: 'Signed in' },
]

const RUN: Axis<RunState>['options'] = [
  { key: 'latest', label: 'Latest current' },
  { key: 'latest-stale', label: 'Latest stale' },
  { key: 'historical', label: 'Historical' },
]

const SECTION: Axis<Section>['options'] = [
  { key: 'overview', label: 'Overview' },
  { key: 'participants', label: 'Participants' },
  { key: 'responses', label: 'Responses' },
  { key: 'review', label: 'Needs review' },
  { key: 'duplicates', label: 'Duplicates' },
  { key: 'export', label: 'Export' },
]

const DATA: Axis<DataState>['options'] = [
  { key: 'healthy', label: 'Healthy' },
  { key: 'empty', label: 'Empty' },
  { key: 'loading', label: 'Loading' },
  { key: 'error', label: 'Error' },
  { key: 'mixed', label: 'Mixed questionnaires' },
]

interface ConceptStateBarProps {
  readonly session: SessionState
  readonly onSession: (state: SessionState) => void
  readonly run: RunState
  readonly onRun: (state: RunState) => void
  readonly section: Section
  readonly onSection: (state: Section) => void
  readonly data: DataState
  readonly onData: (state: DataState) => void
}

export function ConceptStateBar({
  session,
  onSession,
  run,
  onRun,
  section,
  onSection,
  data,
  onData,
}: ConceptStateBarProps) {
  return (
    <div className="rounded-card border border-dashed border-busy-line bg-busy-soft/40 p-3">
      <p className="flex items-center gap-2 pb-2 font-ui text-caption font-semibold uppercase tracking-[0.16em] text-busy">
        <FlaskConicalIcon aria-hidden="true" className="size-3.5" />
        Design review tool, not part of the interface
      </p>

      <div className="flex flex-col gap-2">
        <Row label="Session" value={session} onChange={onSession} options={SESSION} />
        <Row label="Run" value={run} onChange={onRun} options={RUN} />
        <Row label="Section" value={section} onChange={onSection} options={SECTION} />
        <Row label="Data" value={data} onChange={onData} options={DATA} />
      </div>
    </div>
  )
}

function Row<T extends string>({ label, value, onChange, options }: Axis<T>) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-16 shrink-0 font-ui text-caption uppercase tracking-[0.1em] text-faint">
        {label}
      </span>
      <div role="group" aria-label={`${label} states`} className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={option.key === value}
            onClick={() => onChange(option.key)}
            className={cn(
              'min-h-8 rounded-chip border px-2.5 font-ui text-small transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive',
              option.key === value
                ? 'border-busy bg-busy/20 font-medium text-ink'
                : 'border-line bg-canvas/40 text-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
