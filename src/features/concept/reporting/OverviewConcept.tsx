import { InfoIcon, TriangleAlertIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { EmptyState, ErrorState, LoadingState, Section } from '../../../components/design-system'
import { Alert, AlertDescription } from '../../../components/ui/alert'
import { cn } from '@/lib/ui/cn'
import { RatingRow } from './RatingRow'
import {
  ANALYSIS_BASE,
  COVERAGE,
  HISTORICAL_COUNTS,
  HISTORICAL_COVERAGE,
  LEGACY_ANALYTICS,
  QUESTIONNAIRES,
  RATINGS,
  REVIEW_CATEGORIES,
  TEXT_ANSWERS,
  UNREADABLE_RESPONSES,
  type ConceptCounts,
  type DataState,
  type RunState,
  type Section as SectionKey,
} from './fixtures'

/*
 * The event, in the order somebody actually asks about it.
 *
 *   1. how many riders and responses do we have
 *   2. how complete is feedback coverage
 *   3. what can safely be analysed
 *   4. what did riders rate
 *   5. what needs a human
 *   6. which questionnaires are in here
 *
 * The production Overview has all of this and gives nearly every number the
 * same weight: eighteen `<dt>/<dd>` pairs in identical treatment, so the
 * coverage percentage and the engine version are the same size. The hierarchy
 * below is the whole point of the redesign.
 *
 * ## Coverage and analysis base are two questions, not one
 *
 * This is the distinction the screen exists to protect, and the one a "response
 * rate" would destroy.
 *
 *   coverage       how much of the registration list responded at all,
 *                  ambiguity included. A rider with two conflicting responses
 *                  did respond.
 *   analysis base  responses attributable to exactly one person, which is what
 *                  an average may be computed from. That same rider contributes
 *                  to none of it.
 *
 * They are rendered as two panels side by side, each stating its own rule, so
 * neither can be mistaken for the other or read as the same figure twice.
 */

interface OverviewConceptProps {
  readonly runState: RunState
  readonly data: DataState
  readonly counts: ConceptCounts
  readonly onOpenSection: (section: SectionKey) => void
}

export function OverviewConcept({
  runState,
  data,
  counts,
  onOpenSection,
}: OverviewConceptProps) {
  if (data === 'loading') {
    return <LoadingState label="Reading the reconciliation run…" />
  }

  if (data === 'error') {
    return (
      <ErrorState title="The central server failed to answer">
        Nothing on this screen is out of date, because nothing loaded at all.
        Try again shortly.
      </ErrorState>
    )
  }

  if (data === 'empty') {
    return (
      <EmptyState
        title="This event has never been reconciled"
        description="Reconciliation reads the central records and writes a run. Every figure in Reporting is a conclusion from one, so there is nothing to report until the first has completed."
      />
    )
  }

  const historical = runState === 'historical'
  const coverage = historical ? HISTORICAL_COVERAGE : COVERAGE
  const showLegacy = data === 'mixed'

  return (
    <div className="flex flex-col gap-page">
      {/* ---------------------------------------------------------------- *
        1. The event, in four figures.
      * ----------------------------------------------------------------- */}
      <section aria-labelledby="event-snapshot-heading" className="flex flex-col gap-3">
        <h2
          id="event-snapshot-heading"
          className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-muted"
        >
          Event snapshot
        </h2>

        <div className="grid gap-x-8 rounded-card border border-line bg-surface px-5 py-1 grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
          <Figure label="Registrations" value={counts.registrationCount} />
          <Figure label="Responses" value={counts.feedbackCount} />
          <Figure
            label="Registration coverage"
            value={coverage.percentage}
            suffix="%"
            caption={`${coverage.withFeedback.toLocaleString()} of ${coverage.totalRegistrations.toLocaleString()} registered riders`}
          />
          {/*
            Beside the other three, never folded into the coverage fraction.
            A rider who answered without registering is on neither side of it.
          */}
          <Figure
            label="Direct feedback"
            value={coverage.directResponses}
            caption="Outside registration coverage"
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- *
        2 and 3. Coverage and analysis base, deliberately apart.
      * ----------------------------------------------------------------- */}
      <div className="grid gap-page lg:grid-cols-2">
        <Section
          title="Registration coverage"
          description="How much of the registration list responded at all. Ambiguity included: a rider with two conflicting responses did respond."
        >
          <div className="flex flex-col">
            <p className="flex items-baseline gap-3 pb-4">
              <span className="font-ui text-stat font-semibold tabular-nums text-ink">
                {coverage.percentage}%
              </span>
              <span className="font-body text-small text-muted">
                {coverage.withFeedback.toLocaleString()} of{' '}
                {coverage.totalRegistrations.toLocaleString()} registered riders
                responded
              </span>
            </p>

            <CoverageBar percentage={coverage.percentage} />

            <Fact
              label="No response"
              value={coverage.noResponse}
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
                {ANALYSIS_BASE.total.toLocaleString()}
              </span>
              <span className="font-body text-small text-muted">
                of {counts.feedbackCount.toLocaleString()} responses are usable
                for the questionnaire figures
              </span>
            </p>

            <Fact label="Matched to one registration" value={ANALYSIS_BASE.matched} />
            <Fact
              label="Direct feedback"
              value={ANALYSIS_BASE.direct}
              note="Unambiguous: the rider gave their details and matched no registration."
            />

            <p className="border-t border-line pt-3 pb-1 font-ui text-label font-semibold uppercase tracking-[0.1em] text-muted">
              Excluded, cannot be attributed
            </p>
            {ANALYSIS_BASE.excluded.map((entry) => (
              <Fact key={entry.label} label={entry.label} value={entry.count} muted />
            ))}
          </div>
        </Section>
      </div>

      {/* ---------------------------------------------------------------- *
        4. Questionnaires, then what riders rated.
      * ----------------------------------------------------------------- */}
      <Section
        title="Questionnaires"
        description="Counted over the analysis base. Two questionnaires are never averaged together: a 1 to 5 rating and a 1 to 7 rating have no common mean."
      >
        <div className="flex flex-col">
          {QUESTIONNAIRES.filter(
            (questionnaire) =>
              showLegacy || questionnaire.formVersion !== 'feedback-v1',
          ).map((questionnaire) => (
            <div
              key={questionnaire.formVersion}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-3 last:border-b-0"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-body text-base text-ink">
                  {questionnaire.label}
                </span>
                <span className="font-mono text-small text-faint">
                  {questionnaire.formVersion} · {questionnaire.scale}
                </span>
              </span>
              <span className="font-ui text-base font-semibold tabular-nums text-ink">
                {questionnaire.responses.toLocaleString()} responses
              </span>
            </div>
          ))}
        </div>

        {UNREADABLE_RESPONSES > 0 && (
          <Alert tone="neutral" className="mt-4">
            <InfoIcon aria-hidden="true" />
            <AlertDescription>
              {UNREADABLE_RESPONSES} responses use a questionnaire this build
              cannot interpret. They remain available individually and in
              exports, and are excluded from the averages below rather than
              folded into them.
            </AlertDescription>
          </Alert>
        )}
      </Section>

      <Section
        title="Flying Flea test ride"
        description={`Four questions on a 1 to 7 scale, averaged over the ${RATINGS[0]?.answered.toLocaleString()} responses in the analysis base that used this questionnaire.`}
      >
        <div className="flex flex-col">
          {RATINGS.map((rating) => (
            <RatingRow key={rating.key} rating={rating} />
          ))}
        </div>

        {/*
          Counts, not sentiment. How many riders wrote something is a fact this
          system holds; what they meant is not, and a word cloud would be an
          invention with a chart around it.
        */}
        <div className="mt-5 grid gap-x-10 border-t border-line pt-4 sm:grid-cols-2">
          <Fact label="Wrote about top features" value={TEXT_ANSWERS.topThreeFeatures} />
          <Fact
            label="Wrote about overall experience"
            value={TEXT_ANSWERS.overallExperienceComments}
          />
        </div>
        <p className="pt-2 font-body text-small text-faint">
          Counts of who wrote something. The text itself is in the responses and
          the exports; this build does not summarise it.
        </p>
      </Section>

      {showLegacy && (
        <Section
          title="Legacy feedback"
          description="A different questionnaire with a different scale. Its figures are computed and presented entirely separately, and are never combined with the 1 to 7 figures above."
        >
          <div className="grid gap-x-10 sm:grid-cols-2">
            <div className="flex flex-col">
              <p className="flex items-baseline gap-2 pb-3">
                <span className="font-ui text-stat font-semibold tabular-nums text-ink">
                  {LEGACY_ANALYTICS.averageOverallRating}
                </span>
                <span className="font-ui text-base text-muted">/ 5</span>
                <span className="font-ui text-small tabular-nums text-faint">
                  {LEGACY_ANALYTICS.analysed} responses
                </span>
              </p>
              {LEGACY_ANALYTICS.ratingCounts.map((count, index) => (
                <Fact key={index} label={`Rated ${index + 1}`} value={count} muted />
              ))}
            </div>
            <div className="flex flex-col">
              <Fact
                label="Would recommend"
                value={LEGACY_ANALYTICS.recommendPercentage}
                suffix="%"
                note={`${LEGACY_ANALYTICS.recommendYes} yes, ${LEGACY_ANALYTICS.recommendNo} no`}
              />
              {LEGACY_ANALYTICS.experienceCounts.map((entry) => (
                <Fact key={entry.label} label={entry.label} value={entry.count} muted />
              ))}
            </div>
          </div>
        </Section>
      )}

      {/* ---------------------------------------------------------------- *
        5. What needs a human.
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
          {REVIEW_CATEGORIES.map((category) => (
            <Fact
              key={category.key}
              label={category.label}
              value={category.count}
              tone={
                category.key === 'without_feedback'
                  ? 'plain'
                  : category.count > 0
                    ? 'danger'
                    : 'plain'
              }
              onOpen={() => onOpenSection('review')}
            />
          ))}
          <Fact
            label="Possible duplicate registrations"
            value={counts.duplicateRegistrationCandidateCount}
            note="Pairs sharing a phone number or an email. Candidates to check, never confirmed duplicates."
            onOpen={() => onOpenSection('duplicates')}
          />
        </div>

        {historical && (
          <Alert tone="warn" className="mt-4">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertDescription>
              These are the {HISTORICAL_COUNTS.registrationCount.toLocaleString()}{' '}
              registrations and {HISTORICAL_COUNTS.feedbackCount.toLocaleString()}{' '}
              responses the historical run classified. A later run reached
              different conclusions about a larger set of records.
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
  readonly value: number
  readonly suffix?: string
  readonly caption?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-b border-line py-4 last:border-b-0 sm:border-b-0">
      <span className="font-ui text-label font-semibold uppercase tracking-[0.1em] text-muted">
        {label}
      </span>
      <span className="font-ui text-stat font-semibold leading-none tabular-nums text-ink">
        {value.toLocaleString()}
        {suffix !== undefined && (
          <span className="font-ui text-title text-muted">{suffix}</span>
        )}
      </span>
      {caption !== undefined && (
        <span className="font-body text-small text-faint">{caption}</span>
      )}
    </div>
  )
}

function CoverageBar({ percentage }: { readonly percentage: number }) {
  return (
    <div className="pb-4">
      <span
        aria-hidden="true"
        className="flex h-2 w-full overflow-hidden rounded-full bg-canvas"
      >
        <span className="h-full rounded-full bg-ok" style={{ width: `${percentage}%` }} />
      </span>
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
