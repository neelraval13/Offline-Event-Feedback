import { cn } from '@/lib/ui/cn'
import type { ParticipantStatus, ResponseStatus } from './fixtures'

/*
 * Reconciliation statuses, as they read on screen.
 *
 * Reporting's statuses are not the operational vocabulary in
 * `design-system/status.ts`, which describes devices and delivery. These
 * describe what a run concluded about a record, so they get their own small
 * table here rather than being forced into `synced` / `pending` / `error`,
 * which would be a lie about three of them.
 *
 * ## Direct feedback is not amber
 *
 * The one decision this table exists to hold. `standalone` is the contact path
 * working exactly as designed, and every visual treatment that says "attention"
 * would be telling an organiser to go and fix a rider who did nothing wrong. It
 * is neutral, like `matched`, and its label says what happened rather than what
 * is missing: "Direct feedback", never "No registration".
 *
 * `without_registration` is a different finding entirely, a sticker code that
 * resolved to nobody, and it is the one that gets the warning treatment.
 */

type Tone = 'ok' | 'neutral' | 'warn' | 'danger'

const TONES: Readonly<Record<Tone, string>> = {
  ok: 'border-ok-line bg-ok-soft text-ok',
  neutral: 'border-line-strong bg-surface text-muted',
  warn: 'border-warn-line bg-warn-soft text-warn',
  danger: 'border-danger-line bg-danger-soft text-danger',
}

const RESPONSE_STATUS: Readonly<
  Record<ResponseStatus, { readonly label: string; readonly tone: Tone }>
> = {
  matched: { label: 'Matched', tone: 'ok' },
  /* The contact path working. Neutral, and named for what it is. */
  standalone: { label: 'Direct feedback', tone: 'neutral' },
  /* A code that led nowhere. Usually a typo at Point B. */
  without_registration: { label: 'No registration', tone: 'warn' },
  identity_conflict: { label: 'Identity conflict', tone: 'danger' },
  multiple_feedback: { label: 'In a multiple-response group', tone: 'warn' },
}

const PARTICIPANT_STATUS: Readonly<
  Record<ParticipantStatus, { readonly label: string; readonly tone: Tone }>
> = {
  matched: { label: 'Matched', tone: 'ok' },
  without_feedback: { label: 'No response', tone: 'neutral' },
  multiple_feedback: { label: 'Several responses', tone: 'warn' },
}

export const RESPONSE_STATUS_LABELS: Readonly<Record<ResponseStatus, string>> = {
  matched: RESPONSE_STATUS.matched.label,
  standalone: RESPONSE_STATUS.standalone.label,
  without_registration: RESPONSE_STATUS.without_registration.label,
  identity_conflict: RESPONSE_STATUS.identity_conflict.label,
  multiple_feedback: RESPONSE_STATUS.multiple_feedback.label,
}

export const PARTICIPANT_STATUS_LABELS: Readonly<Record<ParticipantStatus, string>> = {
  matched: PARTICIPANT_STATUS.matched.label,
  without_feedback: PARTICIPANT_STATUS.without_feedback.label,
  multiple_feedback: PARTICIPANT_STATUS.multiple_feedback.label,
}

function Pill({ label, tone }: { readonly label: string; readonly tone: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center whitespace-nowrap rounded-chip border px-2 py-0.5',
        'font-ui text-caption font-medium uppercase tracking-[0.08em]',
        TONES[tone],
      )}
    >
      {label}
    </span>
  )
}

export function ResponseStatusPill({ status }: { readonly status: ResponseStatus }) {
  const descriptor = RESPONSE_STATUS[status]
  return <Pill label={descriptor.label} tone={descriptor.tone} />
}

export function ParticipantStatusPill({
  status,
}: {
  readonly status: ParticipantStatus
}) {
  const descriptor = PARTICIPANT_STATUS[status]
  return <Pill label={descriptor.label} tone={descriptor.tone} />
}

/** The capture method, in words rather than machine tokens. */
export const CAPTURE_LABELS: Readonly<Record<string, string>> = {
  qr: 'Scanned',
  manual: 'Typed',
  contact: 'Contact details',
}
