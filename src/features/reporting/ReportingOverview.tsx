import { InfoIcon, TriangleAlertIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Section,
} from '../../components/design-system'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { cn } from '@/lib/ui/cn'
import type { OverviewResponse } from '../../lib/reporting/types'
import { RatingRow } from './RatingRow'

/*
 * The event at a glance.
 *
 * Every figure here is read from a reconciliation run. This screen classifies
 * nothing itself and computes no new totals: if a number looks wrong, the
 * answer is to run reconciliation again, not to recompute it in the browser.
 *
 * ## Coverage and the analysis base are two questions, not one
 *
 * The distinction this panel exists to protect, and the one a single "response
 * rate" would destroy.
 *
 *   coverage       how much of the registration list responded at all,
 *                  ambiguity included. A rider with two conflicting responses
 *                  did respond.
 *   analysis base  responses attributable to exactly one person, which is what
 *                  an average may be computed from. That same rider contributes
 *                  to none of it.
 *
 * They are rendered as two panels side by side, each stating its own rule.
 *
 * The analysis base is not derived here. The server selects `matched` and
 * `standalone` and reports the result as `responsesByFormVersion`, whose values
 * sum to exactly that set; summing them is reading the server's answer, not
 * inventing a second one.
 *
 * ## What V2 changed
 *
 * The hierarchy. V1 had all of this and gave nearly every number the same
 * weight: eighteen definition pairs in identical treatment, so the coverage
 * percentage and the engine version were the same size.
 */

interface ReportingOverviewProps {
  readonly overview: OverviewResponse | null
  readonly error: string | null
  readonly loading: boolean
  readonly onOpenSection: (section: string) => void
}

export function ReportingOverview({
  overview,
  error,
  loading,
  onOpenSection,
}: ReportingOverviewProps) {
  if (error !== null) {
    return <ErrorState title="Reporting could not be read">{error}</ErrorState>
  }

  if (overview === null) {
    return loading ? (
      <LoadingState label="Reading the reconciliation run…" />
    ) : (
      <EmptyState
        title="No reconciliation run for this event"
        description="Every figure in Reporting is a conclusion from a run, so there is nothing to report until the first has completed. Run reconciliation above."
      />
    )
  }

  const { run, coverage, campaignAnalytics, analytics } = overview
  const counts = run.counts

  /*
   * The responses the run could attribute to exactly one person: the server's
   * `matched` plus `standalone` selection, which is what `responsesByFormVersion`
   * is tallied over. Read, never recomputed from the raw counts.
   */
  const analysisBase = Object.values(overview.responsesByFormVersion).reduce(
    (total, count) => total + count,
    0,
  )

  const excluded = [
    { label: 'In a multiple-response group', count: counts.feedbackInMultipleGroups },
    { label: 'Code matched no registration', count: counts.feedbackWithoutRegistration },
    { label: 'Identity conflict', count: counts.feedbackIdentityConflicts },
  ]

  return (
    <div className="flex flex-col gap-page">
      {/* ---------------------------------------------------------------- *
        The event, in four figures.
      * ----------------------------------------------------------------- */}
      <section aria-labelledby="event-snapshot-heading" className="flex flex-col gap-3">
        <h3
          id="event-snapshot-heading"
          className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-muted"
        >
          Event snapshot
        </h3>

        <div className="grid gap-x-8 rounded-card border border-line bg-surface px-5 py-1 grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
          <Figure label="Registrations" value={counts.registrationCount} />
          <Figure label="Responses" value={counts.feedbackCount} />
          <Figure
            label="Registration coverage"
            value={coverage.percentage}
            suffix="%"
            caption={`${coverage.registrationsWithFeedback.toLocaleString()} of ${coverage.totalRegistrations.toLocaleString()} registered riders`}
          />
          {/*
            Beside the other three, never folded into the coverage fraction. A
            rider who answered without registering is on neither side of it.
          */}
          <Figure
            label="Direct feedback"
            value={coverage.directResponses}
            caption="Outside registration coverage"
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- *
        Coverage and the analysis base, deliberately apart.
      * ----------------------------------------------------------------- */}
      <div className="grid gap-page lg:grid-cols-2">
        <Section
          title="Registration coverage"
          description="How much of the registration list responded at all. Ambiguity included: a rider with two conflicting responses did respond."
        >
          <div className="flex flex-col">
            <p className="flex items-baseline gap-3 pb-4">
              <span className="font-ui text-stat font-semibold tabular-nums text-ink">
                {coverage.percentage === null ? 'No data' : `${coverage.percentage}%`}
              </span>
              <span className="font-body text-small text-muted">
                {coverage.registrationsWithFeedback.toLocaleString()} of{' '}
                {coverage.totalRegistrations.toLocaleString()} registered riders
                responded
              </span>
            </p>

            {coverage.percentage !== null && (
              <div className="pb-4">
                <span
                  aria-hidden="true"
                  className="flex h-2 w-full overflow-hidden rounded-full bg-canvas"
                >
                  <span
                    className="h-full rounded-full bg-ok"
                    style={{ width: `${coverage.percentage}%` }}
                  />
                </span>
              </div>
            )}

            <Fact
              label="No response"
              value={counts.registrationsWithoutFeedback}
              note="Registered, nothing matched. Coverage that is incomplete, not data that is wrong."
              onOpen={() => onOpenSection('review')}
            />
            <Fact
              label="Direct feedback"
              value={coverage.directResponses}
              note="Answered at Point B without a Point A registration. Valid, and on neither side of the fraction above."
              onOpen={() => onOpenSection('responses')}
            />
          </div>
        </Section>

        <Section
          title="Analysis base"
          description="Responses this run could attribute to exactly one person. Everything below is computed from these and nothing else."
        >
          <div className="flex flex-col">
            <p className="flex items-baseline gap-3 pb-4">
              <span className="font-ui text-stat font-semibold tabular-nums text-ink">
                {analysisBase.toLocaleString()}
              </span>
              <span className="font-body text-small text-muted">
                of {counts.feedbackCount.toLocaleString()} responses are usable for
                the questionnaire figures
              </span>
            </p>

            <Fact label="Matched to one registration" value={counts.matchedFeedback} />
            <Fact
              label="Direct feedback"
              value={counts.standaloneFeedback}
              note="Unambiguous: the rider gave their details and matched no registration."
            />

            <p className="border-t border-line pt-3 pb-1 font-ui text-label font-semibold uppercase tracking-[0.1em] text-muted">
              Excluded, cannot be attributed
            </p>
            {excluded.map((entry) => (
              <Fact key={entry.label} label={entry.label} value={entry.count} muted />
            ))}
          </div>
        </Section>
      </div>

      {/* ---------------------------------------------------------------- *
        Which questionnaires this run holds.
      * ----------------------------------------------------------------- */}
      <Section
        title="Questionnaires"
        description="Counted over the analysis base. Two questionnaires are never averaged together: a 1 to 5 rating and a 1 to 7 rating have no common mean."
      >
        <div className="flex flex-col">
          {Object.entries(overview.responsesByFormVersion).map(
            ([formVersion, count]) => (
              <div
                key={formVersion}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-3 last:border-b-0"
              >
                <span className="font-mono text-small break-all text-ink">
                  {formVersion}
                </span>
                <span className="font-ui text-base font-semibold tabular-nums text-ink">
                  {count.toLocaleString()} responses
                </span>
              </div>
            ),
          )}
          {Object.keys(overview.responsesByFormVersion).length === 0 && (
            <p className="py-3 font-body text-small text-muted">
              No attributable responses in this run.
            </p>
          )}
        </div>

        {overview.unreadableResponses > 0 && (
          <Alert tone="neutral" className="mt-4">
            <InfoIcon aria-hidden="true" />
            <AlertDescription>
              {overview.unreadableResponses.toLocaleString()} response(s) use a
              questionnaire this build cannot interpret. They remain available
              individually and in exports, and are excluded from the averages
              below rather than folded into them.
            </AlertDescription>
          </Alert>
        )}
      </Section>

      {/* ---------------------------------------------------------------- *
        What riders rated. One section per questionnaire, never combined.
      * ----------------------------------------------------------------- */}
      {campaignAnalytics.analysedResponses > 0 && (
        <Section
          title="Flying Flea test ride"
          description={`Four questions on a 1 to 7 scale, averaged over the ${campaignAnalytics.analysedResponses.toLocaleString()} response(s) in the analysis base that used this questionnaire. Each question is averaged on its own scale.`}
        >
          <div className="flex flex-col">
            {campaignAnalytics.ratings.map((rating) => (
              <RatingRow key={rating.key} rating={rating} />
            ))}
          </div>

          {/*
            Counts, not sentiment. How many riders wrote something is a fact
            this system holds; what they meant is not, and a word cloud would be
            an invention with a chart around it.
          */}
          <div className="mt-5 grid gap-x-10 border-t border-line pt-4 sm:grid-cols-2">
            <Fact
              label="Wrote about top features"
              value={campaignAnalytics.textAnswers.topThreeFeatures}
            />
            <Fact
              label="Wrote about overall experience"
              value={campaignAnalytics.textAnswers.overallExperienceComments}
            />
          </div>
          <p className="pt-2 font-body text-small text-faint">
            Counts of who wrote something. The text itself is in the responses and
            the exports; this build does not summarise it.
          </p>
        </Section>
      )}

      {analytics.analysedResponses > 0 && (
        <Section
          title="Legacy feedback"
          description={`A different questionnaire with a different scale, computed over ${analytics.analysedResponses.toLocaleString()} response(s). Its figures are presented entirely separately and are never combined with the 1 to 7 figures above.`}
        >
          <div className="grid gap-x-10 sm:grid-cols-2">
            <div className="flex flex-col">
              <p className="flex items-baseline gap-2 pb-3">
                <span className="font-ui text-stat font-semibold tabular-nums text-ink">
                  {analytics.averageOverallRating ?? 'No data'}
                </span>
                {analytics.averageOverallRating !== null && (
                  <span className="font-ui text-base text-muted">/ 5</span>
                )}
              </p>
              {(['1', '2', '3', '4', '5'] as const).map((value) => (
                <Fact
                  key={value}
                  label={`Rated ${value}`}
                  value={analytics.ratingCounts[value]}
                  muted
                />
              ))}
            </div>
            <div className="flex flex-col">
              <Fact
                label="Would recommend"
                value={analytics.recommendPercentage ?? 0}
                suffix={analytics.recommendPercentage === null ? '' : '%'}
                note={`${analytics.recommendYes.toLocaleString()} yes, ${analytics.recommendNo.toLocaleString()} no`}
              />
              {(['excellent', 'good', 'okay', 'poor', 'very_poor'] as const).map(
                (experience) => (
                  <Fact
                    key={experience}
                    label={experience.replace('_', ' ')}
                    value={analytics.experienceCounts[experience]}
                    muted
                  />
                ),
              )}
            </div>
          </div>

          {analytics.unreadableFormVersions > 0 && (
            <p className="pt-3 font-body text-small text-faint">
              {analytics.unreadableFormVersions.toLocaleString()} response(s) use a
              questionnaire version this build cannot read and were skipped rather
              than guessed at.
            </p>
          )}
        </Section>
      )}

      {/* ---------------------------------------------------------------- *
        What needs a human.
      * ----------------------------------------------------------------- */}
      <Section
        title="Needs attention"
        description="What this run could not resolve cleanly, and the riders it heard nothing from. Direct feedback is not here: nothing went wrong for those riders."
        action={
          <button
            type="button"
            onClick={() => onOpenSection('review')}
            className="min-h-touch font-ui text-small text-interactive underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive"
          >
            Open Needs review
          </button>
        }
      >
        <div className="flex flex-col">
          <Fact
            label="Responses with a code that matched no registration"
            value={counts.feedbackWithoutRegistration}
            tone="danger"
            onOpen={() => onOpenSection('review')}
          />
          <Fact
            label="Identity conflicts"
            value={counts.feedbackIdentityConflicts}
            tone="danger"
            onOpen={() => onOpenSection('review')}
          />
          <Fact
            label="Participants with several responses"
            value={counts.registrationsWithMultipleFeedback}
            tone="danger"
            onOpen={() => onOpenSection('review')}
          />
          {/*
            Not a fault, and not coloured like one. These riders registered and
            did not stop at Point B, which is incomplete coverage rather than
            corrupted evidence.
          */}
          <Fact
            label="Registered participants with no response"
            value={counts.registrationsWithoutFeedback}
            note="Coverage that is incomplete, not data that is wrong."
            onOpen={() => onOpenSection('review')}
          />
          <Fact
            label="Possible duplicate registrations"
            value={counts.duplicateRegistrationCandidateCount}
            note="Pairs sharing a phone number or an email. Candidates to check, never confirmed duplicates."
            onOpen={() => onOpenSection('duplicates')}
          />
        </div>

        {overview.isHistoricalRun && (
          <Alert tone="warn" className="mt-4">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertDescription>
              These are the conclusions of a historical run, over the{' '}
              {counts.registrationCount.toLocaleString()} registrations and{' '}
              {counts.feedbackCount.toLocaleString()} responses it classified. A
              later run may have reached different conclusions about a larger set
              of records.
            </AlertDescription>
          </Alert>
        )}
      </Section>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

function Figure({
  label,
  value,
  suffix,
  caption,
}: {
  readonly label: string
  readonly value: number | null
  readonly suffix?: string
  readonly caption?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-b border-line py-4 last:border-b-0 sm:border-b-0">
      <span className="font-ui text-label font-semibold uppercase tracking-[0.1em] text-muted">
        {label}
      </span>
      <span className="font-ui text-stat font-semibold leading-none tabular-nums text-ink">
        {value === null ? 'No data' : value.toLocaleString()}
        {value !== null && suffix !== undefined && (
          <span className="font-ui text-title text-muted">{suffix}</span>
        )}
      </span>
      {caption !== undefined && (
        <span className="font-body text-small text-faint">{caption}</span>
      )}
    </div>
  )
}

function Fact({
  label,
  value,
  suffix,
  note,
  muted = false,
  tone = 'plain',
  onOpen,
}: {
  readonly label: string
  readonly value: number
  readonly suffix?: string
  readonly note?: ReactNode
  readonly muted?: boolean
  readonly tone?: 'plain' | 'danger'
  readonly onOpen?: () => void
}) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span
          className={cn(
            'min-w-0 font-body text-small',
            muted ? 'text-faint' : 'text-muted',
          )}
        >
          {onOpen === undefined ? (
            label
          ) : (
            <button
              type="button"
              onClick={onOpen}
              className="min-h-touch text-left underline-offset-4 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive"
            >
              {label}
            </button>
          )}
        </span>
        <span
          className={cn(
            'font-ui font-semibold tabular-nums',
            muted ? 'text-small text-muted' : 'text-base text-ink',
            tone === 'danger' && value > 0 && 'text-danger',
          )}
        >
          {value.toLocaleString()}
          {suffix}
        </span>
      </div>
      {note !== undefined && (
        <p className="max-w-measure font-body text-small text-faint">{note}</p>
      )}
    </div>
  )
}
