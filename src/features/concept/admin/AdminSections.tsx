import {
  ChevronDownIcon,
  DownloadIcon,
  OctagonAlertIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { AppButton, FormField, StatusPill } from '@/components/design-system'
import type { StatusKey } from '@/components/design-system/status'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/ui/cn'
import type { HealthState, StorageState, SyncState } from './ConceptStateBar'
import {
  CONCEPT_APP_VERSION,
  CONCEPT_DB_ERROR,
  CONCEPT_DEVICE,
  CONCEPT_LAST_BACKUP_VERIFIED,
  CONCEPT_LAST_SYNC_ATTEMPT,
  CONCEPT_LAST_SYNC_SUCCESS,
  CONCEPT_UNAUTHORIZED,
  CONCEPT_UNREACHABLE,
  errorTotal,
  pendingTotal,
  syncedTotal,
  type ConceptCounts,
} from './fixtures'

/*
 * Device Admin answers four questions, in this order:
 *
 *   1. Is this device ready to work offline?
 *   2. Is its data safe, and has it left this machine?
 *   3. Can we recover it if something happens?
 *   4. What does support need to know about the hardware?
 *
 * The first three are operational and belong to an event lead who has never
 * heard of IndexedDB. The fourth is for whoever they phone, and it goes last.
 *
 * V1 answered all four in the same voice: five `<dl class="station-badge">`
 * blocks of monospace label/value pairs, in which "Ready for offline use" and a
 * device UUID looked identical. The whole of this redesign is the claim that
 * those are not the same kind of fact.
 */

/** A label and a status, in a rule-separated row. The console's basic unit. */
export function FactRow({
  label,
  children,
  detail,
}: {
  readonly label: string
  readonly children: ReactNode
  readonly detail?: string
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-line py-3">
      <span className="font-ui text-small font-medium text-muted">{label}</span>
      <span className="flex items-center gap-3 font-ui text-base text-ink">
        {detail !== undefined && (
          <span className="font-ui text-small text-faint">{detail}</span>
        )}
        {children}
      </span>
    </div>
  )
}

/** A section heading. Open band, no card. */
export function SectionHead({
  title,
  note,
}: {
  readonly title: string
  readonly note?: string
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 pb-1">
      <h2 className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-ink">
        {title}
      </h2>
      {note !== undefined && (
        <span className="font-ui text-small text-faint">{note}</span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Operational overview
 * ------------------------------------------------------------------------- */

/**
 * The first viewport, and the whole point of the screen.
 *
 * Four states, on one line each, in the order an event lead worries about them.
 * No new "Event ready" boolean is invented: the application has no truthful
 * definition of one, and a green tick that averaged four different facts would
 * be the most dangerous thing on this page. These are the actual underlying
 * states, side by side, and the reader does the combining.
 *
 * Not four stat cards. A figure of `0` in a bordered tile reads as a metric
 * somebody is meant to grow; `Errors 0` on a rule reads as a fact that is
 * currently fine, which is what it is.
 */
export function OverviewBanner({
  health,
  storage,
  sync,
  counts,
}: {
  readonly health: HealthState
  readonly storage: StorageState
  readonly sync: SyncState
  readonly counts: ConceptCounts
}) {
  const pending = pendingTotal(counts)
  const errors = errorTotal(counts)
  /* The panel's alarm follows the store, not the shell: a device that cannot
   * write is the one that must stop, whatever its readiness says. */
  const blocked = storage === 'failed'

  return (
    <section aria-labelledby="overview-heading" className="flex flex-col gap-3">
      <SectionHead title="Operational overview" />

      <div
        className={cn(
          'grid gap-x-8 gap-y-0 rounded-card border px-5 py-1 sm:grid-cols-2 lg:grid-cols-4',
          blocked ? 'border-danger-line bg-danger-soft/40' : 'border-line bg-surface',
        )}
      >
        <h3 id="overview-heading" className="sr-only">
          Operational overview
        </h3>

        <OverviewCell label="Offline readiness">
          <StatusPill status={readinessStatus(health)} />
        </OverviewCell>

        <OverviewCell label="Central sync">
          <StatusPill
            status={syncStatus(sync)}
            {...labelOverride(syncLabel(sync))}
          />
        </OverviewCell>

        <OverviewCell label="Pending records">
          <Figure value={pending} tone={pending > 0 ? 'warn' : 'ok'} />
        </OverviewCell>

        <OverviewCell label="Errors">
          <Figure value={errors} tone={errors > 0 ? 'danger' : 'ok'} />
        </OverviewCell>

        {/*
          Local storage, on its own line, beside readiness rather than instead
          of it. When the store is healthy this is one more quiet green row;
          when it is not, it is the only red thing in the panel and readiness
          is still telling the truth next to it.
        */}
        <OverviewCell label="Local storage">
          <StatusPill
            status={storage === 'failed' ? 'sync-error' : 'synced'}
            label={storage === 'failed' ? 'Cannot write' : 'Healthy'}
          />
        </OverviewCell>
      </div>

      {/*
        Supporting facts, one line, quiet. Useful the moment somebody asks "when
        did this last work", and never the first thing read.
      */}
      <p className="flex flex-wrap gap-x-6 gap-y-1 font-ui text-small text-faint">
        <span>Last successful sync · {CONCEPT_LAST_SYNC_SUCCESS}</span>
        <span>Last verified backup · {CONCEPT_LAST_BACKUP_VERIFIED}</span>
        <span>Version · {CONCEPT_APP_VERSION}</span>
      </p>
    </section>
  )
}

function OverviewCell({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-line py-4 last:border-b-0 lg:border-b-0">
      <span className="font-ui text-label font-semibold uppercase tracking-[0.1em] text-muted">
        {label}
      </span>
      {children}
    </div>
  )
}

/** A count, at statistic weight. Zero is a good answer here, not an empty one. */
function Figure({
  value,
  tone,
}: {
  readonly value: number
  readonly tone: 'ok' | 'warn' | 'danger'
}) {
  return (
    <span
      className={cn(
        'font-ui text-stat font-semibold leading-none tabular-nums',
        tone === 'ok' && 'text-ink',
        tone === 'warn' && 'text-warn',
        tone === 'danger' && 'text-danger',
      )}
    >
      {value.toLocaleString()}
    </span>
  )
}

/**
 * What the offline shell says about itself, and nothing else.
 *
 * Takes a `HealthState` and only a `HealthState`. That signature is the whole
 * guarantee: this function cannot consult local-storage health because it is
 * not given it, so no future edit can quietly make a broken database report
 * "Offline readiness: Unknown". The two facts come from different systems, the
 * service worker's precache and IndexedDB, and either can be fine while the
 * other is not.
 *
 * `unknown` is reserved for the case where readiness is genuinely unknowable:
 * a browser without service workers, or a dev build with none registered.
 */
export function readinessStatus(health: HealthState): StatusKey {
  switch (health) {
    case 'preparing':
      return 'offline-preparing'
    case 'offline-failed':
      return 'offline-failed'
    case 'readiness-unknown':
      return 'unknown'
    default:
      return 'offline-ready'
  }
}

function syncStatus(sync: SyncState): StatusKey {
  switch (sync) {
    case 'not-enrolled':
      return 'not-enrolled'
    case 'syncing':
      return 'syncing'
    case 'unreachable':
      /* Amber, never red: the records are safe and simply undelivered. */
      return 'pending'
    case 'unauthorized':
      return 'sync-error'
    case 'record-errors':
      return 'sync-error'
    case 'not-configured':
      return 'offline-unsupported'
    default:
      return 'enrolled'
  }
}

/** Spreads a `label` prop only when there is one to give. */
function labelOverride(label: string | undefined) {
  return label === undefined ? {} : { label }
}

function syncLabel(sync: SyncState): string | undefined {
  switch (sync) {
    case 'unreachable':
      return 'Server unreachable'
    case 'unauthorized':
      return 'Re-enrolment needed'
    case 'record-errors':
      return 'Records refused'
    case 'not-configured':
      return 'Not configured'
    default:
      return undefined
  }
}

/* ------------------------------------------------------------------------- *
 * Local storage failure: the one blocking state
 * ------------------------------------------------------------------------- */

/**
 * The most serious state Device Admin has.
 *
 * No network is normal here and gets no banner at all. A device that cannot
 * read or write its own store cannot take a registration safely, which is a
 * different kind of fact entirely, and the only one on this screen that stops
 * the event.
 */
export function StorageFailureBanner() {
  return (
    <Alert tone="danger">
      <OctagonAlertIcon aria-hidden="true" />
      <AlertTitle className="font-display text-title tracking-wide">
        Local storage problem
      </AlertTitle>
      <AlertDescription>
        This device cannot write to its own database: {CONCEPT_DB_ERROR}. It
        must not take registrations or feedback, because writes cannot be
        persisted: everything captured at Point A or Point B would be lost the
        moment the page closes. Move the station to another tablet and tell
        whoever is running the event.
        <br />
        <br />
        This is separate from offline readiness above. The application shell may
        be perfectly prepared to run without a network; the problem is that
        there is nowhere to put what it collects.
      </AlertDescription>
    </Alert>
  )
}

/* ------------------------------------------------------------------------- *
 * Device readiness
 * ------------------------------------------------------------------------- */

export function ReadinessSection({
  health,
  storage,
}: {
  readonly health: HealthState
  readonly storage: StorageState
}) {
  return (
    <section aria-labelledby="readiness-heading" className="flex flex-col">
      <SectionHead title="Device readiness" />
      <h3 id="readiness-heading" className="sr-only">
        Device readiness
      </h3>

      <FactRow label="Offline readiness">
        <StatusPill status={readinessStatus(health)} />
      </FactRow>
      <FactRow label="Application version">
        <span className="font-mono text-small tabular-nums">
          {CONCEPT_APP_VERSION}
        </span>
      </FactRow>
      <FactRow label="Application update">
        <StatusPill
          status={health === 'update-available' ? 'pending' : 'synced'}
          label={health === 'update-available' ? 'Update available' : 'Up to date'}
        />
      </FactRow>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        {health === 'healthy' && storage === 'ok' && (
          <p className="max-w-measure font-body text-small text-muted">
            This device can keep collecting registrations and feedback with no
            network at all.
          </p>
        )}

        {/*
          Readiness is still reported truthfully above. What changes is the
          conclusion: a prepared shell with no writable store is prepared to do
          nothing useful, and saying only the first half would be a screen
          telling an operator to carry on.
        */}
        {health === 'healthy' && storage === 'failed' && (
          <p className="max-w-measure font-body text-small text-muted">
            The application shell is prepared and would run without a network.
            It still must not be used: see the local storage problem above.
          </p>
        )}

        {health === 'readiness-unknown' && (
          <p className="max-w-measure font-body text-small text-muted">
            This browser or build cannot report offline readiness, so it is not
            being claimed either way. Do not rely on this device losing its
            network until that is resolved.
          </p>
        )}

        {health === 'preparing' && (
          <Alert tone="busy">
            <RefreshCwIcon aria-hidden="true" />
            <AlertTitle>Preparing for offline use</AlertTitle>
            <AlertDescription>
              Setup is still running. Keep this device on the Internet until it
              finishes; it is not ready to take to a venue yet.
            </AlertDescription>
          </Alert>
        )}

        {health === 'offline-failed' && (
          <Alert tone="danger">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle className="font-display text-title tracking-wide">
              Not ready for offline use
            </AlertTitle>
            <AlertDescription>
              This device could not be prepared. Connect it to the Internet and
              reload before the event: taken to a venue as it is, it will stop
              working the moment it loses the network.
            </AlertDescription>
          </Alert>
        )}

        {health === 'update-available' && (
          <Alert tone="info">
            <DownloadIcon aria-hidden="true" />
            <AlertTitle>Application update available</AlertTitle>
            <AlertDescription>
              The running version keeps working until you apply it. Applying it
              reloads this terminal, so do it between participants or before a
              shift.
            </AlertDescription>
            <div className="col-start-2 pt-2">
              <AppButton onClick={() => undefined}>Apply update</AppButton>
            </div>
          </Alert>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------------- *
 * Central sync
 * ------------------------------------------------------------------------- */

export function SyncSection({
  sync,
  counts,
}: {
  readonly sync: SyncState
  readonly counts: ConceptCounts
}) {
  const pending = pendingTotal(counts)
  const errors = errorTotal(counts)

  if (sync === 'not-configured') {
    return (
      <section aria-labelledby="sync-heading" className="flex flex-col">
        <SectionHead title="Central sync" />
        <h3 id="sync-heading" className="sr-only">
          Central sync
        </h3>
        <FactRow label="Status">
          <StatusPill status="offline-unsupported" label="Not configured" />
        </FactRow>
        <p className="border-t border-line pt-4 font-body text-small text-muted">
          This build has no central server. Records stay on this device, which is
          safe, and an encrypted backup is the only copy. Take one before the end
          of the shift.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="sync-heading" className="flex flex-col">
      <SectionHead title="Central sync" />
      <h3 id="sync-heading" className="sr-only">
        Central sync
      </h3>

      <FactRow label="Status">
        <StatusPill
            status={syncStatus(sync)}
            {...labelOverride(syncLabel(sync))}
          />
      </FactRow>
      <FactRow label="Waiting to send">
        <span className="font-ui tabular-nums">
          {pending.toLocaleString()} record{pending === 1 ? '' : 's'}
        </span>
      </FactRow>
      <FactRow label="Last successful sync">
        <span className="font-ui text-small tabular-nums text-muted">
          {sync === 'not-enrolled' ? 'Never' : CONCEPT_LAST_SYNC_SUCCESS}
        </span>
      </FactRow>
      <FactRow label="Last attempt">
        <span className="font-ui text-small tabular-nums text-muted">
          {sync === 'not-enrolled' ? 'Never' : CONCEPT_LAST_SYNC_ATTEMPT}
        </span>
      </FactRow>
      <FactRow label="Refused by the server">
        <span
          className={cn(
            'font-ui tabular-nums',
            errors > 0 ? 'text-danger' : 'text-ink',
          )}
        >
          {errors.toLocaleString()}
        </span>
      </FactRow>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        {sync === 'insecure' && (
          <Alert tone="danger">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Sync address is not secure</AlertTitle>
            <AlertDescription>
              Registrations carry participant contact details and must only be
              sent over https. Nothing will be sent from this device until the
              build is corrected.
            </AlertDescription>
          </Alert>
        )}

        {sync === 'unreachable' && (
          /*
            Amber, and never the words "sync failed". Nothing failed: the server
            was not reachable, the records are exactly where they were, and the
            device carries on collecting. Red here would teach an operator to
            ignore red by the third time a venue's wifi dropped.
          */
          <Alert tone="warn">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Central server could not be reached</AlertTitle>
            <AlertDescription>{CONCEPT_UNREACHABLE}</AlertDescription>
          </Alert>
        )}

        {sync === 'unauthorized' && (
          <Alert tone="danger">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>This device needs enrolling again</AlertTitle>
            <AlertDescription>
              {CONCEPT_UNAUTHORIZED} Records stay safe on this device meanwhile.
            </AlertDescription>
          </Alert>
        )}

        {sync === 'record-errors' && (
          <Alert tone="danger">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>{errors} records were refused</AlertTitle>
            <AlertDescription>
              The server accepted the rest and refused these, which are now
              marked with an error on this device. They will not be retried
              automatically. Send the device ID below to support; nothing here
              identifies a participant.
            </AlertDescription>
          </Alert>
        )}

        {sync === 'not-enrolled' ? (
          <EnrolmentForm />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <AppButton
              busy={sync === 'syncing'}
              busyLabel="Syncing…"
              onClick={() => undefined}
            >
              <RefreshCwIcon />
              Sync now
            </AppButton>
            {sync === 'enrolled' && pending === 0 && errors === 0 && (
              <span className="font-body text-small text-muted">
                Everything on this device is already synced.
              </span>
            )}
            {sync === 'enrolled' && pending > 0 && (
              <span className="font-body text-small text-muted">
                Collecting continues either way. Pending records are safe here.
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * One-time enrolment.
 *
 * The code is a password field, it is never stored, and it is cleared the
 * moment an attempt finishes. The device token that comes back is never shown
 * anywhere in the product, and this screen does not hint at its existence: an
 * operator has no use for it and a screen on a desk should not display a
 * credential.
 */
function EnrolmentForm() {
  const [secret, setSecret] = useState('')

  return (
    <form
      /* A concept. Nothing is submitted, enrolled or stored. */
      onSubmit={(event) => {
        event.preventDefault()
        setSecret('')
      }}
      className="flex max-w-md flex-col gap-3"
    >
      <p className="font-body text-small text-muted">
        This device needs a one-time enrolment before it can send records to the
        central database. It keeps collecting normally until then.
      </p>

      <FormField label="Enrollment code" required>
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        )}
      </FormField>

      <div>
        <AppButton type="submit">Enroll device</AppButton>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------------- *
 * Local data
 * ------------------------------------------------------------------------- */

/**
 * How much is on this device, and how much of it exists nowhere else.
 *
 * The pending figures are the operationally important ones: a pending record
 * lives on exactly one machine, and that number is the size of the loss if the
 * machine is dropped. Totals are context, so they are quieter and first;
 * "waiting to sync" gets its own band and the largest type on the section.
 *
 * Counts only. No name, email, phone or comment reaches this screen.
 */
export function LocalDataSection({ counts }: { readonly counts: ConceptCounts }) {
  const pending = pendingTotal(counts)

  return (
    <section aria-labelledby="local-data-heading" className="flex flex-col">
      <SectionHead title="Local data" note="Counts only. No participant details." />
      <h3 id="local-data-heading" className="sr-only">
        Local data
      </h3>

      <div className="grid gap-x-10 md:grid-cols-2">
        <div className="flex flex-col">
          <FactRow label="Registrations">
            <span className="font-ui tabular-nums">
              {counts.registrations.total.toLocaleString()}
            </span>
          </FactRow>
          <FactRow label="Feedback">
            <span className="font-ui tabular-nums">
              {counts.feedback.total.toLocaleString()}
            </span>
          </FactRow>
          <FactRow label="Synced">
            <span className="font-ui tabular-nums text-muted">
              {syncedTotal(counts).toLocaleString()}
            </span>
          </FactRow>
        </div>

        <div
          className={cn(
            'mt-3 flex flex-col rounded-card border px-4 py-1 md:mt-0',
            pending > 0
              ? 'border-warn-line bg-warn-soft/40'
              : 'border-line bg-surface',
          )}
        >
          <p className="pt-3 font-ui text-label font-semibold uppercase tracking-[0.1em] text-muted">
            Waiting to sync
          </p>
          <FactRow label="Registrations">
            <span className="font-ui text-stat-small font-semibold tabular-nums">
              {counts.registrations.pending.toLocaleString()}
            </span>
          </FactRow>
          <FactRow label="Feedback">
            <span className="font-ui text-stat-small font-semibold tabular-nums">
              {counts.feedback.pending.toLocaleString()}
            </span>
          </FactRow>
          <p className="border-t border-line py-3 font-body text-small text-muted">
            {pending > 0
              ? 'These exist only on this device. Keep an encrypted backup.'
              : 'Everything captured here has reached the central database.'}
          </p>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------------- *
 * Device details
 * ------------------------------------------------------------------------- */

/**
 * The technical facts, last and collapsed.
 *
 * Valuable to whoever an event lead phones, and useless to the event lead. V1
 * put the device UUID above everything else on the screen, in the same
 * treatment as "Ready for offline use", which is how a support identifier came
 * to outrank the one line that decides whether the device can be used.
 *
 * Collapsed, not hidden: one tap, and the values are selectable so they can be
 * read out or pasted into a message.
 */
export function DeviceDetails() {
  const [open, setOpen] = useState(false)

  return (
    <section aria-labelledby="details-heading" className="flex flex-col">
      <h3 id="details-heading" className="sr-only">
        Device details
      </h3>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex min-h-touch w-full items-center gap-3 border-t border-line px-1 py-3 text-left',
          'font-ui text-label font-semibold uppercase tracking-[0.16em] text-muted',
          'transition-colors hover:text-ink',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive',
        )}
      >
        <span className="min-w-0 flex-1">Device details</span>
        <span className="font-ui text-small font-normal normal-case tracking-normal text-faint">
          For support
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="grid gap-x-10 pb-2 md:grid-cols-2">
          <div className="flex flex-col">
            <DetailRow label="Device ID" value={CONCEPT_DEVICE.deviceId} />
            <DetailRow label="Local database" value={CONCEPT_DEVICE.databaseName} />
            <DetailRow
              label="Database version"
              value={`v${CONCEPT_DEVICE.databaseVersion} · ${CONCEPT_DEVICE.databaseState}`}
            />
          </div>
          <div className="flex flex-col">
            <DetailRow label="Event ID" value={CONCEPT_DEVICE.eventId} />
            <DetailRow label="Event day" value={CONCEPT_DEVICE.eventDay} />
            <DetailRow label="Application" value={CONCEPT_APP_VERSION} />
          </div>
        </div>
      )}
    </section>
  )
}

function DetailRow({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-line py-3">
      <span className="font-ui text-small text-muted">{label}</span>
      {/*
        `select-all` so a tap selects the whole identifier: these get read down
        a phone or pasted into a message, and a half-selected UUID is worse than
        none. `break-all` because a UUID has nowhere to wrap politely.
      */}
      <span className="font-mono text-small break-all select-all text-ink">
        {value}
      </span>
    </div>
  )
}
