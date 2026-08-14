import { useState } from 'react'
import {
  describeFailure,
  requestReconciliation,
} from '../../lib/reporting/reportingClient'
import type { OverviewResponse } from '../../lib/reporting/types'
import { useReportingSession } from './session'

/*
 * The event at a glance.
 *
 * Every figure here is read from a Phase 7 reconciliation run. This screen
 * classifies nothing itself: if a number looks wrong, the answer is to run
 * reconciliation again, not to recompute it in the browser.
 *
 * Two numbers that are easy to confuse are shown apart on purpose:
 *
 *   coverage:  participants who responded at all, ambiguity included
 *   analytics: responses unambiguous enough to average
 *
 * A participant with two conflicting responses raises the first and not the
 * second, and presenting one "response rate" would hide exactly that.
 *
 * The overview itself is fetched by the workspace, not here: the historical and
 * staleness warnings it carries have to be visible from every tab, so one request
 * feeds both the banner above the tabs and this panel.
 */

interface ReportingOverviewProps {
  readonly eventId: string
  readonly overview: OverviewResponse | null
  readonly error: string | null
  readonly loading: boolean
  readonly onReload: () => void
  readonly onReconciled: () => void
}

function percentage(value: number | null): string {
  return value === null ? 'No data' : `${value}%`
}

export function ReportingOverview({
  eventId,
  overview,
  error,
  loading,
  onReload,
  onReconciled,
}: ReportingOverviewProps) {
  const session = useReportingSession()
  const [reconciling, setReconciling] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function reconcile() {
    setReconciling(true)
    setActionError(null)
    const result = await session.call((secret) =>
      requestReconciliation(secret, eventId),
    )
    setReconciling(false)

    if (result.ok) {
      onReconciled()
    } else {
      setActionError(describeFailure(result.failure))
    }
  }

  const message = actionError ?? error

  return (
    <section aria-labelledby="reporting-overview-heading">
      <h2 id="reporting-overview-heading" className="pending__title">
        Event overview
      </h2>

      {message !== null && (
        <p className="notice notice--error" role="alert">
          {message}
        </p>
      )}

      <div className="button-row">
        <button
          type="button"
          className="button"
          onClick={() => void reconcile()}
          disabled={reconciling}
        >
          {reconciling ? 'Reconciling…' : 'Run reconciliation'}
        </button>
        <button
          type="button"
          className="button button--small"
          onClick={onReload}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      <p className="screen__note">
        Reconciliation reads the central records and writes a new run. It never
        edits, merges or deletes a registration or a response. Every figure and
        list on this screen describes exactly the records this run classified.
        Anything that arrived afterwards belongs to the next run, not this one.
      </p>

      {loading && overview === null && <p className="screen__note">Loading…</p>}

      {overview !== null && (
        <>
          <dl className="station-badge">
            <div>
              <dt>Run completed</dt>
              <dd>{new Date(overview.run.completedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Engine</dt>
              <dd>{overview.run.engineVersion}</dd>
            </div>
            <div>
              <dt>Registrations</dt>
              <dd>{overview.run.counts.registrationCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Responses</dt>
              <dd>{overview.run.counts.feedbackCount.toLocaleString()}</dd>
            </div>
          </dl>

          <h3 className="section-title">Response coverage</h3>
          <dl className="station-badge">
            <div>
              <dt>Participants who responded</dt>
              <dd>
                {overview.coverage.registrationsWithFeedback.toLocaleString()} of{' '}
                {overview.coverage.totalRegistrations.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>Coverage</dt>
              <dd>{percentage(overview.coverage.percentage)}</dd>
            </div>
            <div>
              <dt>No response</dt>
              <dd>{overview.run.counts.registrationsWithoutFeedback.toLocaleString()}</dd>
            </div>
          </dl>

          {/*
            Which questionnaires this run actually holds. An event that ran both
            gets both sets of figures, side by side and never averaged together:
            a 1-5 rating and a 1-7 rating have no common mean.
          */}
          <h3 className="section-title">Responses by questionnaire</h3>
          <ul className="recent__list">
            {Object.entries(overview.responsesByFormVersion).map(
              ([formVersion, count]) => (
                <li className="recent__item" key={formVersion}>
                  <span className="recent__code">{formVersion}</span>
                  <span>{count.toLocaleString()} matched response(s)</span>
                </li>
              ),
            )}
            {Object.keys(overview.responsesByFormVersion).length === 0 && (
              <li className="recent__item">
                <span>No matched responses in this run.</span>
              </li>
            )}
          </ul>
          {overview.unreadableResponses > 0 && (
            <p className="notice" role="status">
              {overview.unreadableResponses.toLocaleString()} matched response(s)
              use a questionnaire this build has no figures for. They are
              exported and readable individually, and are excluded from every
              average below rather than being folded into one.
            </p>
          )}

          {overview.campaignAnalytics.analysedResponses > 0 && (
            <>
              <h3 className="section-title">
                Flying Flea test ride ({overview.campaignAnalytics.analysedResponses.toLocaleString()}{' '}
                response(s))
              </h3>
              <p className="screen__note">
                Computed from responses this run matched to exactly one rider.
                Each question is averaged on its own 1–7 scale.
              </p>

              {overview.campaignAnalytics.ratings.map((rating) => (
                <div key={rating.key}>
                  <h4 className="section-title">{rating.prompt}</h4>
                  <dl className="station-badge">
                    <div>
                      <dt>Average</dt>
                      <dd>
                        {rating.average === null
                          ? 'No data'
                          : `${rating.average} / 7`}
                      </dd>
                    </div>
                    <div>
                      <dt>Answered</dt>
                      <dd>{rating.responses.toLocaleString()}</dd>
                    </div>
                  </dl>
                  <ul className="recent__list">
                    {([7, 6, 5, 4, 3, 2, 1] as const).map((value) => (
                      <li className="recent__item" key={value}>
                        <span className="recent__code">{value}</span>
                        <span>
                          {rating.distribution[value].toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <dl className="station-badge">
                <div>
                  <dt>Wrote about top features</dt>
                  <dd>
                    {overview.campaignAnalytics.textAnswers.topThreeFeatures.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt>Wrote about overall experience</dt>
                  <dd>
                    {overview.campaignAnalytics.textAnswers.overallExperienceComments.toLocaleString()}
                  </dd>
                </div>
              </dl>
            </>
          )}

          {overview.analytics.analysedResponses > 0 && (
            <>
          <h3 className="section-title">Answers (feedback-v1)</h3>
          <p className="screen__note">
            Computed from the {overview.analytics.analysedResponses.toLocaleString()}{' '}
            response(s) this run matched to exactly one participant. Responses in
            a multiple-response group, identity conflicts and responses with no
            registration are excluded, because none of them can be attributed to one
            person with confidence.
            {overview.analytics.unreadableFormVersions > 0 && (
              <>
                {' '}
                {overview.analytics.unreadableFormVersions.toLocaleString()}{' '}
                response(s) use a questionnaire version this build cannot read
                and were skipped rather than guessed at.
              </>
            )}
          </p>

          <dl className="station-badge">
            <div>
              <dt>Average rating</dt>
              <dd>{overview.analytics.averageOverallRating ?? 'No data'}</dd>
            </div>
            <div>
              <dt>Would recommend</dt>
              <dd>
                {percentage(overview.analytics.recommendPercentage)} (
                {overview.analytics.recommendYes.toLocaleString()} yes /{' '}
                {overview.analytics.recommendNo.toLocaleString()} no)
              </dd>
            </div>
          </dl>

          <h4 className="section-title">Rating distribution</h4>
          <ul className="recent__list">
            {(['5', '4', '3', '2', '1'] as const).map((rating) => (
              <li className="recent__item" key={rating}>
                <span className="recent__code">{rating}</span>
                <span>{overview.analytics.ratingCounts[rating].toLocaleString()}</span>
              </li>
            ))}
          </ul>

          <h4 className="section-title">Experience</h4>
          <ul className="recent__list">
            {(
              ['excellent', 'good', 'okay', 'poor', 'very_poor'] as const
            ).map((experience) => (
              <li className="recent__item" key={experience}>
                <span className="recent__code">{experience.replace('_', ' ')}</span>
                <span>
                  {overview.analytics.experienceCounts[experience].toLocaleString()}
                </span>
              </li>
            ))}
          </ul>

            </>
          )}

          <h3 className="section-title">Needs review</h3>
          <dl className="station-badge">
            <div>
              <dt>Responses with no registration</dt>
              <dd>{overview.run.counts.feedbackWithoutRegistration.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Identity conflicts</dt>
              <dd>{overview.run.counts.feedbackIdentityConflicts.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Participants with several responses</dt>
              <dd>{overview.run.counts.registrationsWithMultipleFeedback.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Possible duplicate registrations</dt>
              <dd>
                {overview.run.counts.duplicateRegistrationCandidateCount.toLocaleString()}
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  )
}
