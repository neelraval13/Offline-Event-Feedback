import { useState, type FormEvent } from 'react'
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
 */

interface ReportingLoginProps {
  readonly eventId: string
  readonly onAuthenticated: (secret: string) => void
}

export function ReportingLogin({ eventId, onAuthenticated }: ReportingLoginProps) {
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
    <section aria-labelledby="reporting-login-heading">
      <h2 id="reporting-login-heading" className="pending__title">
        Central reporting
      </h2>

      {!configured && (
        <p className="notice notice--error" role="alert">
          This build has no central server configured, so there is nothing to
          report on. Reporting needs <code>VITE_SYNC_API_BASE_URL</code> set at
          build time.
        </p>
      )}

      <p className="screen__note">
        This screen shows every participant&rsquo;s name, phone number and email
        for {eventId}. It is for the organiser&rsquo;s machine, not for a
        station tablet. Nothing loaded here is stored on this device.
      </p>

      <form className="registration-form" onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label className="field__label" htmlFor="reporting-secret">
            Reporting secret
          </label>
          <input
            id="reporting-secret"
            className="field__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={secret}
            disabled={!configured || checking}
            onChange={(event) => setSecret(event.target.value)}
          />
        </div>

        {error !== null && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}

        <div className="button-row">
          <button
            type="submit"
            className="button button--primary"
            disabled={!configured || checking || secret.length === 0}
          >
            {checking ? 'Checking…' : 'Open reporting'}
          </button>
        </div>
      </form>
    </section>
  )
}
