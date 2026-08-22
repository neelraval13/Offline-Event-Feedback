import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { AppButton, FormField, StatusPill } from '../../components/design-system'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Input } from '../../components/ui/input'
import { EVENT_CONFIG } from '../../config/event'
import { db, peekDeviceId, type LocalCounts } from '../../lib/storage'
import {
  enrollDevice,
  isSecureEndpoint,
  isSyncConfigured,
  runSync,
  storeSyncCredential,
  type SyncActivity,
  type SyncOutcome,
} from '../../lib/sync'
import { syncLabel, syncStatus, type SyncSummary } from './AdminOverview'
import { FactRow, formatMoment, SectionHead } from './console'

/*
 * Central synchronisation, from the operator's side.
 *
 * Everything here is diagnostic or deliberate. Point A and Point B show nothing
 * about sync at all: a failed upload is not a reason to interrupt somebody
 * registering a participant, and the records are safe locally either way.
 *
 * The device token is never displayed, and neither is the enrolment code; it is
 * cleared from component state the moment the attempt finishes.
 *
 * ## What the V2 migration changed, and what it did not
 *
 * Presentation, and where the reads come from. `runSync` is called exactly as
 * before, the opportunistic attempt still runs at most once per mount and again
 * when the browser says connectivity returned, both silently, and the per-kind
 * transport wording is unchanged. What moved is that the counts, the credential
 * and the activity are read once for the whole console and handed in, so the
 * overview at the top and this section cannot disagree about them.
 */

const FAILURE_MESSAGES: Record<string, string> = {
  unreachable:
    'Sync could not reach the central server. Your local records are safe and remain pending. Try again when connectivity is available.',
  timeout:
    'The central server did not respond in time. Your local records are safe and remain pending.',
  server_error:
    'The central server reported a problem. Your local records are safe and remain pending.',
  unauthorized:
    'This device is no longer authorised to sync. Enrol it again to continue.',
  rejected:
    'The central server refused the request. Your local records are safe and remain pending.',
  not_configured: 'This build has no central server configured.',
}

interface SyncPanelProps {
  readonly counts: LocalCounts | null
  /** True when the counts could not be read, rather than not read yet. */
  readonly countsUnavailable: boolean
  readonly credentialPresent: boolean | null
  /** True when the sync facts could not be read, rather than not read yet. */
  readonly credentialError: boolean
  readonly activity: SyncActivity | null
  /** Re-reads the console's shared facts after a sync or an enrolment. */
  readonly onRefresh: () => Promise<void>
  readonly onDataChanged?: () => void
  /** Lets the overview show what this panel is doing. */
  readonly onSummaryChange?: (summary: SyncSummary) => void
}

export function SyncPanel({
  counts,
  countsUnavailable,
  credentialPresent,
  credentialError,
  activity,
  onRefresh,
  onDataChanged,
  onSummaryChange,
}: SyncPanelProps) {
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null)
  /* Guards the opportunistic attempt so it runs at most once per mount. */
  const openedRef = useRef(false)

  const sync = useCallback(
    async (announce: boolean) => {
      setBusy(true)
      if (announce) {
        setMessage(null)
        setOutcome(null)
      }

      const result = await runSync({ database: db })
      setOutcome(result)

      if (result.transportFailure !== undefined) {
        // Never "sync failed": the records are safe, they simply have not
        // been delivered yet.
        setMessage(
          FAILURE_MESSAGES[result.transportFailure] ??
            FAILURE_MESSAGES['unreachable'] ??
            null,
        )
      } else if (announce) {
        setMessage(
          result.attempted === 0
            ? 'Everything on this device is already synced.'
            : `Synced ${result.synced} of ${result.attempted} record(s).`,
        )
      }

      await onRefresh()
      setBusy(false)
      onDataChanged?.()
    },
    [onDataChanged, onRefresh],
  )

  /*
   * Opportunistic attempts: once after the screen opens, and when the browser
   * says connectivity returned. `navigator.onLine` is only a hint: it reports
   * a link, not a reachable server, so a failure here is silent.
   */
  useEffect(() => {
    if (credentialPresent !== true || openedRef.current) {
      return
    }
    openedRef.current = true
    void sync(false)
  }, [credentialPresent, sync])

  useEffect(() => {
    if (credentialPresent !== true) {
      return
    }

    const onOnline = () => void sync(false)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [credentialPresent, sync])

  async function handleEnroll(event: FormEvent) {
    event.preventDefault()
    if (busy) {
      return
    }

    setBusy(true)
    setMessage(null)

    const deviceId = await peekDeviceId(db)
    if (deviceId === undefined) {
      setMessage('This device has no identity yet. Reload and try again.')
      setBusy(false)
      return
    }

    const response = await enrollDevice({
      eventId: EVENT_CONFIG.eventId,
      deviceId,
      enrollmentSecret: secret,
    })

    // Cleared regardless of outcome: the code is never persisted anywhere.
    setSecret('')

    if (!response.ok) {
      setMessage(
        response.failure === 'unauthorized'
          ? 'Device could not be enrolled. Check the enrollment code and try again.'
          : (FAILURE_MESSAGES[response.failure] ??
            'Device could not be enrolled.'),
      )
      setBusy(false)
      return
    }

    await storeSyncCredential({
      eventId: response.value.eventId,
      token: response.value.deviceToken,
    })

    setMessage('This device is enrolled for central sync.')
    await onRefresh()
    setBusy(false)
  }

  const errors =
    counts === null ? 0 : counts.registrations.error + counts.feedback.error
  const pending =
    counts === null ? 0 : counts.registrations.pending + counts.feedback.pending

  const summary = summarise({
    configured: isSyncConfigured(),
    credentialPresent,
    credentialError,
    busy,
    outcome,
    errors,
  })

  /* Reported upward so the overview can show the same state, never recomputed. */
  useEffect(() => {
    onSummaryChange?.(summary)
  }, [onSummaryChange, summary])

  if (!isSyncConfigured()) {
    return (
      <section aria-labelledby="sync-heading" className="flex flex-col">
        <SectionHead title="Central sync" />
        <h2 id="sync-heading" className="sr-only">
          Central sync
        </h2>
        <FactRow label="Status">
          <StatusPill status="offline-unsupported" label="Not configured" />
          <span data-testid="sync-status" className="sr-only">
            Not configured
          </span>
        </FactRow>
        <p className="border-t border-line pt-4 font-body text-small text-muted">
          Not configured in this build. Records stay on this device, which is
          safe, and an encrypted backup is the only copy.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="sync-heading" className="flex flex-col">
      <SectionHead title="Central sync" />
      <h2 id="sync-heading" className="sr-only">
        Central sync
      </h2>

      <FactRow label="Status">
        <StatusPill status={syncStatus(summary)} {...labelFor(syncLabel(summary))} />
        <span data-testid="sync-status" className="sr-only">
          {credentialError
            ? 'Unavailable'
            : credentialPresent === null
              ? 'Checking…'
              : credentialPresent
                ? 'Enrolled'
                : 'Not enrolled'}
        </span>
      </FactRow>

      <FactRow label="Waiting to send">
        <span className="font-ui tabular-nums">
          {counts !== null
            ? `${pending.toLocaleString()} record${pending === 1 ? '' : 's'}`
            : countsUnavailable
              ? 'Unavailable'
              : 'Counting…'}
        </span>
      </FactRow>

      <FactRow label="Last successful sync">
        <span
          data-testid="sync-last-success"
          className="font-ui text-small tabular-nums text-muted"
        >
          {formatMoment(activity?.lastSuccessAt ?? null)}
        </span>
      </FactRow>

      <FactRow label="Last attempt">
        <span
          data-testid="sync-last-attempt"
          className="font-ui text-small tabular-nums text-muted"
        >
          {formatMoment(activity?.lastAttemptAt ?? null)}
        </span>
      </FactRow>

      <FactRow label="Refused by the server">
        <span
          data-testid="sync-errors"
          className={errors > 0 ? 'font-ui tabular-nums text-danger' : 'font-ui tabular-nums'}
        >
          {counts !== null
            ? errors.toLocaleString()
            : countsUnavailable
              ? 'Unavailable'
              : 'Counting…'}
        </span>
      </FactRow>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        {!isSecureEndpoint() && (
          <Alert tone="danger">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Sync address is not secure</AlertTitle>
            <AlertDescription>
              The configured sync address is not secure. Registrations carry
              participant contact details and must only be sent over https.
            </AlertDescription>
          </Alert>
        )}

        {outcome !== null && outcome.failed > 0 && (
          <Alert tone="danger">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>
              {outcome.failed === 1
                ? '1 record was refused'
                : `${outcome.failed} records were refused`}
            </AlertTitle>
            <AlertDescription data-testid="sync-failed-count">
              {outcome.failed} record(s) could not be accepted by the central
              server and are marked with an error. Reconciliation is not
              available yet.
            </AlertDescription>
          </Alert>
        )}

        {message !== null && (
          <Alert tone={toneFor(message)}>
            <TriangleAlertIcon aria-hidden="true" />
            {/*
              Never "sync failed" for a server that could not be answered: the
              records are exactly where they were. Red is reserved for a device
              that has actually lost its authorisation.
            */}
            <AlertTitle>{titleFor(message)}</AlertTitle>
            <AlertDescription data-testid="sync-message">{message}</AlertDescription>
          </Alert>
        )}

        {credentialPresent === false ? (
          <form
            onSubmit={(event) => void handleEnroll(event)}
            className="flex max-w-md flex-col gap-3"
          >
            <p className="font-body text-small text-muted">
              This device needs a one-time enrolment before it can send records
              to the central database. It keeps collecting normally until then.
            </p>

            <FormField label="Enrollment code" required>
              {(field) => (
                <Input
                  {...field}
                  type="password"
                  autoComplete="off"
                  value={secret}
                  disabled={busy}
                  onChange={(event) => setSecret(event.target.value)}
                />
              )}
            </FormField>

            <div>
              <AppButton type="submit" busy={busy} busyLabel="Enrolling…">
                Enroll device
              </AppButton>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <AppButton
              busy={busy}
              busyLabel="Syncing…"
              onClick={() => void sync(true)}
            >
              <RefreshCwIcon />
              Sync now
            </AppButton>
            {credentialPresent === true && !busy && pending > 0 && (
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

/** Which sync state the console is in. Presentation only. */
function summarise({
  configured,
  credentialPresent,
  credentialError,
  busy,
  outcome,
  errors,
}: {
  readonly configured: boolean
  readonly credentialPresent: boolean | null
  /** True when the sync facts could not be read, rather than not read yet. */
  readonly credentialError: boolean
  readonly busy: boolean
  readonly outcome: SyncOutcome | null
  readonly errors: number
}): SyncSummary {
  if (!configured) {
    return 'not-configured'
  }
  if (busy) {
    return 'syncing'
  }
  /*
   * Before "checking": the enrolment credential lives in the local store, so a
   * store that will not open leaves this permanently unknowable rather than
   * pending. The storage banner says why; this says it stopped looking.
   */
  if (credentialError) {
    return 'unavailable'
  }
  if (credentialPresent === null) {
    return 'checking'
  }
  if (credentialPresent === false) {
    return 'not-enrolled'
  }
  if (outcome?.transportFailure === 'unauthorized') {
    return 'unauthorized'
  }
  if (outcome?.transportFailure !== undefined) {
    return 'unreachable'
  }
  if (errors > 0) {
    return 'record-errors'
  }
  return 'enrolled'
}

/** Only a lost authorisation is red. Unreachable is amber; success is neutral. */
function toneFor(message: string): 'danger' | 'warn' | 'neutral' {
  if (message.startsWith('This device is no longer')) {
    return 'danger'
  }
  if (message.startsWith('Device could not')) {
    return 'danger'
  }
  if (message.startsWith('Sync could not') || message.startsWith('The central')) {
    return 'warn'
  }
  return 'neutral'
}

function titleFor(message: string): string {
  if (message.startsWith('Sync could not') || message.startsWith('The central')) {
    return 'Central server could not be reached'
  }
  if (message.startsWith('This device is no longer')) {
    return 'This device needs enrolling again'
  }
  if (message.startsWith('Device could not')) {
    return 'Device could not be enrolled'
  }
  return 'Sync'
}

function labelFor(label: string | undefined) {
  return label === undefined ? {} : { label }
}
