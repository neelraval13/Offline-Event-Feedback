import { FlaskConicalIcon } from 'lucide-react'
import { cn } from '@/lib/ui/cn'

/*
 * The design-review tool. NOT part of the proposed interface.
 *
 * Device Admin has three largely independent axes: how prepared the device is,
 * what sync is doing, and where a backup workflow has got to. They compose, so
 * a single flat list of states would be a list of every combination. Three
 * selectors instead, one per axis, which is also how an operator thinks about
 * the screen.
 *
 * Deliberately foreign-looking: a dashed amber rail, outside the console,
 * labelled as scaffolding. When the concept is approved this file is deleted
 * and no other file changes.
 */

/**
 * How prepared the application shell is. Nothing to do with local storage.
 *
 * These are the service worker's four readiness values plus the update flag.
 * Whether IndexedDB opens is a separate fact on a separate axis, because it
 * genuinely is one: a device can hold a perfectly precached shell and still be
 * unable to write a record, and it can be mid-precache with a healthy store.
 */
export type HealthState =
  | 'healthy'
  | 'preparing'
  | 'offline-failed'
  /** The shell itself cannot say: an unsupported browser, or a dev build. */
  | 'readiness-unknown'
  | 'update-available'

/**
 * Whether this device can read and write its own store.
 *
 * Its own axis, deliberately. Coupling it to readiness was a modelling mistake
 * in the first draft of this concept: it made a broken database report
 * "Offline readiness: Unknown", which is both untrue and the wrong alarm. The
 * shell was ready; the store was not.
 */
export type StorageState = 'ok' | 'failed'

export type SyncState =
  | 'enrolled'
  | 'not-enrolled'
  | 'syncing'
  | 'unreachable'
  | 'unauthorized'
  | 'record-errors'
  | 'not-configured'
  | 'insecure'

export type BackupState =
  | 'idle'
  | 'create'
  | 'create-success'
  | 'verify'
  | 'verify-success'
  | 'restore-review'
  | 'restore-complete'
  | 'backup-error'
  | 'restore-error'

interface Axis<T extends string> {
  readonly label: string
  readonly value: T
  readonly onChange: (value: T) => void
  readonly options: readonly { readonly key: T; readonly label: string }[]
}

const HEALTH: Axis<HealthState>['options'] = [
  { key: 'healthy', label: 'Healthy' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'offline-failed', label: 'Offline failed' },
  { key: 'readiness-unknown', label: 'Readiness unknown' },
  { key: 'update-available', label: 'Update available' },
]

const STORAGE: Axis<StorageState>['options'] = [
  { key: 'ok', label: 'Store healthy' },
  { key: 'failed', label: 'Local DB failed' },
]

const SYNC: Axis<SyncState>['options'] = [
  { key: 'enrolled', label: 'Enrolled' },
  { key: 'not-enrolled', label: 'Not enrolled' },
  { key: 'syncing', label: 'Syncing' },
  { key: 'unreachable', label: 'Server unreachable' },
  { key: 'unauthorized', label: 'Unauthorized' },
  { key: 'record-errors', label: 'Record errors' },
  { key: 'not-configured', label: 'Not configured' },
  { key: 'insecure', label: 'Insecure endpoint' },
]

const BACKUP: Axis<BackupState>['options'] = [
  { key: 'idle', label: 'Idle' },
  { key: 'create', label: 'Create' },
  { key: 'create-success', label: 'Create success' },
  { key: 'verify', label: 'Verify' },
  { key: 'verify-success', label: 'Verify success' },
  { key: 'restore-review', label: 'Restore review' },
  { key: 'restore-complete', label: 'Restore complete' },
  { key: 'backup-error', label: 'Backup error' },
  { key: 'restore-error', label: 'Restore error' },
]

interface ConceptStateBarProps {
  readonly health: HealthState
  readonly onHealth: (state: HealthState) => void
  readonly storage: StorageState
  readonly onStorage: (state: StorageState) => void
  readonly sync: SyncState
  readonly onSync: (state: SyncState) => void
  readonly backup: BackupState
  readonly onBackup: (state: BackupState) => void
}

export function ConceptStateBar({
  health,
  onHealth,
  storage,
  onStorage,
  sync,
  onSync,
  backup,
  onBackup,
}: ConceptStateBarProps) {
  return (
    <div className="rounded-card border border-dashed border-busy-line bg-busy-soft/40 p-3">
      <p className="flex items-center gap-2 pb-2 font-ui text-caption font-semibold uppercase tracking-[0.16em] text-busy">
        <FlaskConicalIcon aria-hidden="true" className="size-3.5" />
        Design review tool, not part of the interface
      </p>

      <div className="flex flex-col gap-2">
        <Row label="Health" value={health} onChange={onHealth} options={HEALTH} />
        <Row label="Storage" value={storage} onChange={onStorage} options={STORAGE} />
        <Row label="Sync" value={sync} onChange={onSync} options={SYNC} />
        <Row label="Backup" value={backup} onChange={onBackup} options={BACKUP} />
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
