import { LockIcon, OctagonAlertIcon } from 'lucide-react'
import { AppButton, AppSurface, FormField } from '../../../components/design-system'
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert'
import { Input } from '../../../components/ui/input'
import { EVENT } from './fixtures'

/*
 * The credential gate.
 *
 * Not a consumer sign-in. There is no account, no email, no password reset and
 * no "remember me": the reporting secret is one shared operational credential
 * for one event, held in memory for one tab. Every affordance a login screen
 * usually has would be a promise this system deliberately does not make.
 *
 * The absence of persistence is stated rather than implied. An organiser who
 * closes the tab and finds themselves signed out should have been told that was
 * going to happen, and an organiser who was hoping for "keep me signed in"
 * should be able to read why there is not one.
 *
 * Narrow measure, not the 88rem workspace: a single field and a paragraph do
 * not need a laptop's width, and centring it signals that nothing has loaded
 * yet.
 */

interface LoginConceptProps {
  /** True after a 401 ended a session that was already open. */
  readonly rejected: boolean
  readonly onSubmit: () => void
}

export function LoginConcept({ rejected, onSubmit }: LoginConceptProps) {
  return (
    <AppSurface width="measure" className="flex flex-col gap-page">
      <header className="flex flex-col gap-1 border-b border-line pb-4">
        <span className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-accent">
          Central Reporting
        </span>
        <h1 className="font-display text-page leading-none tracking-wide text-ink">
          Secure access
        </h1>
      </header>

      {/*
        The rejected state is the one that matters most, because it is the one
        an operator meets mid-task. It says what happened to the data, not just
        that a credential failed: a session that ended silently would leave
        somebody wondering whether the screen they were reading is still there.
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

      <p className="font-body text-base text-muted">
        This workspace contains participant contact details and event-wide
        responses for {EVENT.name}. The reporting secret is kept only for this
        tab and is not stored by the app: closing the tab ends the session.
      </p>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <FormField
          label="Reporting secret"
          required
          hint="Held in memory only. Never written to this device."
        >
          {(field) => (
            <Input
              {...field}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Enter the reporting secret"
            />
          )}
        </FormField>

        <div>
          <AppButton type="submit">
            <LockIcon />
            Open reporting
          </AppButton>
        </div>
      </form>

      <p className="border-t border-line pt-4 font-body text-small text-faint">
        For the organiser&rsquo;s machine, not a station tablet. Reporting is not
        listed in the station navigation, and nothing it loads is written to this
        device.
      </p>
    </AppSurface>
  )
}
