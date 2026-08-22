import { CheckIcon, InfoIcon, ScanLineIcon } from 'lucide-react'
import { AppButton } from '../../components/design-system'
import { FLYING_FLEA_CAMPAIGN } from '../campaign/flying-flea/config'
import type { PublicParticipantCode } from '../../types'

/*
 * The two ways a rider leaves Point B without an error.
 *
 * ## Success is read from several feet away
 *
 * An operator standing beside a tablet a rider is holding needs to know the
 * response landed without walking over and reading a sentence. So the tick is
 * large, the word is set in the display face, and the completed questionnaire
 * is gone rather than greyed out behind it: a screen still full of answers
 * reads as "not finished yet" from that distance whatever it says at the top.
 *
 * It is not a celebration. No confetti, no illustration, no second call to
 * action, because the next thing that happens is another rider and the screen's
 * job is to get out of the way quickly.
 *
 * "Saved on this device" is deliberate. The tablet is routinely offline and a
 * message implying the response had reached a server would be false for hours.
 * The thank-you is the campaign's own wording.
 *
 * ## Already recorded is not a failure
 *
 * It means the duplicate guard did its job. Nothing was lost, nothing was
 * overwritten, and the rider does not need to do anything. Red would tell an
 * operator something went wrong several times a day until they stopped reading
 * status colours, so this is `info`.
 *
 * The guard is a question about a public code, so it exists on the sticker
 * paths only. A contact capture has no code to ask about, and no equivalent is
 * invented for it.
 */

interface SuccessOutcomeProps {
  readonly savedCount: number
  readonly onNext: () => void
}

export function SuccessOutcome({ savedCount, onNext }: SuccessOutcomeProps) {
  return (
    <section
      role="status"
      aria-labelledby="success-heading"
      className="flex flex-col items-center gap-6 py-8 text-center sm:py-14"
    >
      <span
        aria-hidden="true"
        className="flex size-20 items-center justify-center rounded-full border-2 border-ok-line bg-ok-soft"
      >
        <CheckIcon className="size-10 text-ok" />
      </span>

      <div className="flex flex-col gap-2">
        <h2
          id="success-heading"
          className="font-display text-page tracking-wide text-ok sm:text-display"
        >
          Feedback saved
        </h2>
        <p className="font-body text-lead text-ink">
          {FLYING_FLEA_CAMPAIGN.thanks}
        </p>
        <p className="max-w-measure font-body text-base text-muted">
          Saved on this device. Nothing further is needed from the rider.
        </p>
      </div>

      <AppButton size="lg" onClick={onNext} className="min-w-56">
        <ScanLineIcon />
        Next rider
      </AppButton>

      {/*
        Quiet operational metadata, and the one place it belongs on this state:
        an operator glancing at the count between riders, not a dashboard tile.
      */}
      <p className="font-ui text-small tabular-nums text-faint">
        Responses saved on this device · {savedCount}
      </p>
    </section>
  )
}

interface AlreadyRecordedOutcomeProps {
  readonly publicCode: PublicParticipantCode
  readonly onNext: () => void
}

export function AlreadyRecordedOutcome({
  publicCode,
  onNext,
}: AlreadyRecordedOutcomeProps) {
  return (
    <section
      role="status"
      aria-labelledby="already-heading"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col items-start gap-4 rounded-card border border-info-line bg-info-soft px-5 py-5">
        <span
          aria-hidden="true"
          className="flex size-11 items-center justify-center rounded-full border border-info-line bg-canvas/40"
        >
          <InfoIcon className="size-5 text-info" />
        </span>

        <div className="flex flex-col gap-2">
          <h2
            id="already-heading"
            className="font-display text-title tracking-wide text-ink"
          >
            Feedback already recorded
          </h2>
          <p className="max-w-measure font-body text-base text-muted">
            This rider's feedback is already saved on this device and has not
            been changed. There is nothing to do, and no second response should
            be submitted for them here.
          </p>
        </div>
      </div>

      <ParticipantCode publicCode={publicCode} />

      <div>
        <AppButton size="lg" onClick={onNext}>
          <ScanLineIcon />
          Scan next rider
        </AppButton>
      </div>
    </section>
  )
}

/**
 * Which rider this is: a public code, and nothing else.
 *
 * No name, phone or email. On the sticker paths this device does not know them,
 * and looking them up would make the flow depend on a connection a venue tablet
 * does not have. The code is the whole identity here, and it is enough.
 */
export function ParticipantCode({
  publicCode,
}: {
  readonly publicCode: PublicParticipantCode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-muted">
        Participant
      </span>
      <p
        data-testid="participant-code"
        className="font-mono text-page leading-none tracking-tight text-ink tabular-nums [font-feature-settings:'zero'_1]"
      >
        {publicCode}
      </p>
    </div>
  )
}
