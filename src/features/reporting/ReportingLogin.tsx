import { LockIcon, OctagonAlertIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { AppButton, FormField } from '../../components/design-system'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Input } from '../../components/ui/input'
import {
  describeFailure,
  fetchRuns,
  isReportingConfigured,
} from '../../lib/reporting/reportingClient'

/*
 * The reporting sign-in.
 *
 * The secret is submitted upward and held in React state for the life of the
 * tab. It is never written to IndexedDB, localStorage, sessionStorage or a
 * cookie, and there is no "keep me signed in": a closed tab must end the
 * session, because this credential reads every participant's contact details.
 *
 * The form deliberately checks the secret against the server before letting the
 * screen open, so a typo produces one clear message here instead of five failed
 * panels.
 *
 * ## Not a consumer login
 *
 * There is no account, no email, no password reset and no remembered device.
 * Every affordance a login screen usually carries would be a promise this
 * system deliberately does not make, so V2 states the absence rather than
 * leaving somebody to discover it: an organiser who closes the tab and finds
 * themselves signed out should have been told that was going to happen.
 */

interface ReportingLoginProps {
  readonly eventId: string
  readonly eventName: string
  /** True after a 401 ended a session that was already open. */
  readonly rejected: boolean
  readonly onAuthenticated: (secret: string) => void
}

export function ReportingLogin({
  eventId,
  eventName,
  rejected,
  onAuthenticated,
}: ReportingLoginProps) {
  const [secret, setSecret] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const configured = isReportingConfigured()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (secret.length === 0 || checking) {
      return
    }

    setChecking(true)
    setError(null)

    // `/runs` is the cheapest authenticated call: it returns run identifiers
    // and counts, and no participant data at all.
    const result = await fetchRuns(secret, eventId)
    setChecking(false)

    if (result.ok) {
      onAuthenticated(secret)
      setSecret('')
      return
    }

    setError(describeFailure(result.failure))
  }

  return (
    <section aria-labelledby="reporting-login-heading" className="flex flex-col gap-page">
      <header className="flex flex-col gap-1 border-b border-line pb-4">
        <span className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-accent">
          Central Reporting
        </span>
        <h1
          id="reporting-login-heading"
          className="font-display text-page leading-none tracking-wide text-ink"
        >
          Secure access
        </h1>
      </header>

      {/*
        The rejected state is the one an operator meets mid-task. It says what
        happened to the data, not just that a credential failed: a session that
        ended silently would leave somebody wondering whether the screen they
        were reading is still open somewhere.
      */}
      {rejected && (
        <Alert tone="danger">
          <OctagonAlertIcon aria-hidden="true" />
          <AlertTitle>The reporting secret was rejected</AlertTitle>
          <AlertDescription>
            The session ended and participant data was cleared from this screen.
            If the secret was rotated on the server, enter the current one to
            continue.
          </AlertDescription>
        </Alert>
      )}

      {!configured && (
        <Alert tone="danger">
          <OctagonAlertIcon aria-hidden="true" />
          <AlertTitle>No central server is configured</AlertTitle>
          <AlertDescription>
            This build has no central server configured, so there is nothing to
            report on. Reporting needs <code>VITE_SYNC_API_BASE_URL</code> set at
            build time.
          </AlertDescription>
        </Alert>
      )}

      <p className="max-w-measure font-body text-base text-muted">
        This workspace contains participant contact details and event-wide
        responses for {eventName}. The reporting secret is kept only for this tab
        and is not stored by the app: closing the tab ends the session.
      </p>

      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <FormField
          label="Reporting secret"
          required
          hint="Held in memory only. Never written to this device."
          {...(error === null ? {} : { error })}
        >
          {(field) => (
            <Input
              {...field}
              /*
                The id is fixed rather than generated: it is the handle the
                privacy suite uses to prove the field exists before sign-in and
                is gone afterwards.
              */
              id="reporting-secret"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={secret}
              disabled={!configured || checking}
              onChange={(event) => setSecret(event.target.value)}
            />
          )}
        </FormField>

        <div>
          <AppButton
            type="submit"
            busy={checking}
            busyLabel="Checking…"
            disabled={!configured || secret.length === 0}
          >
            <LockIcon />
            Open reporting
          </AppButton>
        </div>
      </form>

      <p className="max-w-measure border-t border-line pt-4 font-body text-small text-faint">
        For the organiser&rsquo;s machine, not a station tablet. Reporting is not
        listed in the station navigation, and nothing it loads is written to this
        device.
      </p>
    </section>
  )
}
