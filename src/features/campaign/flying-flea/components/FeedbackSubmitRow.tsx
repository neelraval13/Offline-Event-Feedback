import { AppButton } from '../../../../components/design-system'

/*
 * The one action at the end of a Point B questionnaire.
 *
 * Shared by both identity paths so the rider meets the same button whichever
 * way they were identified, and so the two cannot drift into different labels
 * for the same act.
 *
 * `busy` disables, always: `AppButton` makes the two inseparable, so a double
 * tap while a save is in flight cannot produce two records. The terminal has
 * its own synchronous `submittingRef` guard as well; this is the visible half
 * of the same rule.
 *
 * The line beside it is the offline claim, stated once, quietly. It is the
 * whole of what this screen says about the network when everything is healthy:
 * no banner, no badge, no warning. The shell's "Offline ready" is the rest.
 */

interface FeedbackSubmitRowProps {
  readonly busy: boolean
}

export function FeedbackSubmitRow({ busy }: FeedbackSubmitRowProps) {
  return (
    <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-body text-small text-faint">
        Saved on this device. A network is not needed.
      </p>
      <AppButton
        type="submit"
        size="lg"
        busy={busy}
        busyLabel="Saving…"
        className="sm:min-w-56"
      >
        Submit Feedback
      </AppButton>
    </div>
  )
}
