import type { ReconciliationCounts } from './types'

/*
 * Counts only.
 *
 * Reconciliation reads names, phone numbers and email addresses in order to
 * group duplicate candidates, so it is precisely the component most able to
 * leak them. Nothing but identifiers and totals is ever printed — a terminal
 * scrollback and a CI log are not places for participant data.
 */

interface SummaryLine {
  readonly label: string
  readonly value: string
}

function lines(
  runId: string,
  eventId: string,
  counts: ReconciliationCounts,
): SummaryLine[] {
  const format = (value: number) => value.toLocaleString('en-US')

  return [
    { label: 'Run', value: runId },
    { label: 'Event', value: eventId },
    { label: 'Registrations', value: format(counts.registrationCount) },
    { label: 'Feedback', value: format(counts.feedbackCount) },
    { label: 'Matched registrations', value: format(counts.matchedRegistrations) },
    {
      label: 'Registrations without feedback',
      value: format(counts.registrationsWithoutFeedback),
    },
    {
      label: 'Registrations with multiple feedback',
      value: format(counts.registrationsWithMultipleFeedback),
    },
    { label: 'Matched feedback', value: format(counts.matchedFeedback) },
    {
      label: 'Feedback without registration',
      value: format(counts.feedbackWithoutRegistration),
    },
    {
      label: 'Feedback identity conflicts',
      value: format(counts.feedbackIdentityConflicts),
    },
    {
      label: 'Feedback in multiple-feedback groups',
      value: format(counts.feedbackInMultipleGroups),
    },
    {
      label: 'Duplicate registration candidates',
      value: format(counts.duplicateRegistrationCandidateCount),
    },
  ]
}

/** Renders a completed run for a terminal. */
export function formatSummary(
  runId: string,
  eventId: string,
  counts: ReconciliationCounts,
): string {
  const rendered = lines(runId, eventId, counts)
    .map(({ label, value }) => `${label}\n${value}`)
    .join('\n\n')

  return `Reconciliation complete\n\n${rendered}\n`
}
