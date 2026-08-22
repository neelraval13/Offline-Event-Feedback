import { useState } from 'react'
import { Alert, AlertDescription } from '../../../components/ui/alert'
import { InfoIcon } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { ParticipantsConcept } from './ParticipantsConcept'
import { ResponsesConcept } from './ResponsesConcept'
import {
  REVIEW_CATEGORIES,
  type ConceptParticipant,
  type ConceptResponse,
  type DataState,
  type ReviewCategory,
} from './fixtures'

/*
 * Evidence review, not issue tracking.
 *
 * There is no Resolve, no Ignore, no Link participant, no Merge, no Mark
 * handled and no Dismiss anywhere on this screen, and that is a deliberate
 * product position rather than an unbuilt feature. An anomaly is a fact about
 * what happened at the desks. The run is the record of it, and hiding one
 * behind a resolved flag would make the next run's counts disagree with this
 * screen for no traceable reason.
 *
 * What an organiser does about one is human work: find the person, ask at the
 * desk, or accept the loss.
 *
 * ## The counts are on the controls
 *
 * A category picker whose options are all the same size makes somebody open
 * four sections to find out there was nothing in three of them. The counts sit
 * on the buttons so the section is useful before anything is opened, and so
 * that "1 identity conflict" and "227 no response" are visibly different sizes
 * of problem.
 *
 * ## Direct feedback is not here
 *
 * Not a category, not in a total, not in a filter. A rider who identified
 * themselves by contact details and matched no registration did exactly what
 * the contact path is for.
 */

interface NeedsReviewConceptProps {
  readonly data: DataState
  readonly onOpenParticipant: (participant: ConceptParticipant) => void
  readonly onOpenResponse: (response: ConceptResponse) => void
}

export function NeedsReviewConcept({
  data,
  onOpenParticipant,
  onOpenResponse,
}: NeedsReviewConceptProps) {
  const [category, setCategory] = useState<ReviewCategory>('without_registration')
  const active = REVIEW_CATEGORIES.find((entry) => entry.key === category)

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-measure font-body text-base text-muted">
        Read-only. Nothing here can be merged, linked, deleted or marked
        resolved. The reconciliation run is the record of what the evidence says,
        and this screen does not overrule it.
      </p>

      <div role="group" aria-label="Review category" className="flex flex-wrap gap-2.5">
        {REVIEW_CATEGORIES.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-pressed={category === entry.key}
            onClick={() => setCategory(entry.key)}
            className={cn(
              'flex min-h-touch items-center gap-3 rounded-card border px-4 py-2.5 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive',
              category === entry.key
                ? 'border-interactive bg-interactive-soft'
                : 'border-line bg-surface hover:border-line-strong',
            )}
          >
            <span
              className={cn(
                'font-ui text-small',
                category === entry.key ? 'font-medium text-ink' : 'text-muted',
              )}
            >
              {entry.label}
            </span>
            <span
              className={cn(
                'font-ui text-base font-semibold tabular-nums',
                entry.count === 0
                  ? 'text-faint'
                  : entry.key === 'without_feedback'
                    ? 'text-ink'
                    : 'text-danger',
              )}
            >
              {entry.count.toLocaleString()}
            </span>
          </button>
        ))}
      </div>

      {active !== undefined && (
        <Alert tone="neutral">
          <InfoIcon aria-hidden="true" />
          <AlertDescription>{active.explanation}</AlertDescription>
        </Alert>
      )}

      {active?.browses === 'participants' ? (
        <ParticipantsConcept
          key={category}
          data={data}
          initialStatus={
            category === 'without_feedback' ? 'without_feedback' : 'multiple_feedback'
          }
          filtersHidden
          onOpen={onOpenParticipant}
        />
      ) : (
        <ResponsesConcept
          key={category}
          data={data}
          initialStatus={
            category === 'identity_conflict' ? 'identity_conflict' : 'without_registration'
          }
          filtersHidden
          onOpen={onOpenResponse}
        />
      )}
    </div>
  )
}
