import { InfoIcon } from 'lucide-react'
import { EmptyState } from '../../../components/design-system'
import { Alert, AlertDescription } from '../../../components/ui/alert'
import { DUPLICATES, type ConceptDuplicate, type DataState } from './fixtures'

/*
 * Registrations that might be the same person.
 *
 * Candidates, matched on exact normalised phone or email and never on a name.
 * Two people at one event share a phone number often enough (a couple, a parent
 * and child, a company mobile) that treating a match as proof would corrupt the
 * participant list.
 *
 * So nothing here merges, deletes, or marks a pair confirmed. The two records
 * are shown side by side with the field that matched picked out, and a human
 * decides, off this screen.
 *
 * ## The comparison is the design
 *
 * A table row with two multi-line cells, which is what the production screen
 * renders, makes the reader do the comparison themselves. Here the two records
 * are laid out as parallel columns with aligned labels, so the eye can run down
 * one line and see which values differ. The matched field is marked on both
 * sides, because "same phone" is the reason the pair exists and it should not
 * have to be inferred.
 *
 * On a narrow viewport the two stack. That loses the side-by-side scan, which
 * is a real cost, but every alternative loses the values themselves.
 */

const BASIS_LABELS: Readonly<Record<ConceptDuplicate['matchBasis'], string>> = {
  phone_and_email: 'Same phone and email',
  phone_only: 'Same phone',
  email_only: 'Same email',
}

interface DuplicatesConceptProps {
  readonly data: DataState
}

export function DuplicatesConcept({ data }: DuplicatesConceptProps) {
  const pairs = data === 'empty' ? [] : DUPLICATES

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-measure font-body text-base text-muted">
        Pairs sharing a normalised phone number or email address. A shared number
        is common and legitimate at an event, so these are possibilities to
        check, not duplicates to remove. Names are never matched on.
      </p>

      <Alert tone="neutral">
        <InfoIcon aria-hidden="true" />
        <AlertDescription>
          Merging is not available. This product never rewrites a participant
          record: the registrations are the event&rsquo;s evidence, and deciding
          that two of them are one person is a judgement made by a human, off
          this screen.
        </AlertDescription>
      </Alert>

      {pairs.length === 0 ? (
        <EmptyState
          title="No pairs share a phone number or email"
          description="Nothing in this run looks like the same person registering twice."
        />
      ) : (
        <>
          <p aria-live="polite" className="font-body text-small text-muted">
            Showing {pairs.length} of 6 pairs this run found. Export the possible
            duplicates CSV for the complete list; it is never truncated.
          </p>

          <div className="flex flex-col gap-4">
            {pairs.map((pair) => (
              <Pair key={`${pair.left.recordId}:${pair.right.recordId}`} pair={pair} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Pair({ pair }: { readonly pair: ConceptDuplicate }) {
  const phoneMatched = pair.matchBasis !== 'email_only'
  const emailMatched = pair.matchBasis !== 'phone_only'

  return (
    <section className="flex flex-col rounded-card border border-line bg-surface">
      <h3 className="border-b border-line px-5 py-3 font-ui text-label font-semibold uppercase tracking-[0.14em] text-warn">
        Matched on: {BASIS_LABELS[pair.matchBasis]}
      </h3>

      <div className="grid md:grid-cols-2">
        {[pair.left, pair.right].map((side, index) => (
          <div
            key={side.recordId}
            className={
              index === 0
                ? 'flex flex-col border-b border-line px-5 py-4 md:border-b-0 md:border-r'
                : 'flex flex-col px-5 py-4'
            }
          >
            <span className="pb-2 font-ui text-caption uppercase tracking-[0.1em] text-faint">
              Registration {index === 0 ? 'A' : 'B'}
            </span>
            <Field label="Code" value={side.publicCode} mono />
            <Field label="Name" value={side.name} />
            <Field label="Phone" value={side.phone} matched={phoneMatched} />
            <Field label="Email" value={side.email} matched={emailMatched} />
          </div>
        ))}
      </div>
    </section>
  )
}

function Field({
  label,
  value,
  mono = false,
  matched = false,
}: {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
  readonly matched?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line py-2.5 first:border-t-0">
      <span className="font-ui text-caption uppercase tracking-[0.08em] text-faint">
        {label}
        {matched && (
          <span className="pl-1.5 text-warn">Matched</span>
        )}
      </span>
      <span
        className={
          mono
            ? 'break-all font-mono text-small text-ink'
            : matched
              ? 'break-words font-body text-base font-medium text-warn'
              : 'break-words font-body text-base text-ink'
        }
      >
        {value}
      </span>
    </div>
  )
}
