import { cn } from '@/lib/ui/cn'
import type {
  FeedbackReconciliationStatus,
  RegistrationReconciliationStatus,
} from '../../lib/reporting/types'

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
 * working exactly as designed, and any treatment that says "attention" would be
 * telling an organiser to go and fix a rider who did nothing wrong. It is
 * neutral, like `matched`, and its label says what happened rather than what is
 * missing: "Direct feedback", never "No registration".
 *
 * `without_registration` is a different finding entirely, a sticker code that
 * resolved to nobody, and it is the one that gets the warning treatment. The
 * two are one letter apart in the data and opposite in meaning.
 */

type Tone = 'ok' | 'neutral' | 'warn' | 'danger'

const TONES: Readonly<Record<Tone, string>> = {
  ok: 'border-ok-line bg-ok-soft text-ok',
  neutral: 'border-line-strong bg-surface text-muted',
  warn: 'border-warn-line bg-warn-soft text-warn',
  danger: 'border-danger-line bg-danger-soft text-danger',
}

interface Descriptor {
  readonly label: string
  readonly tone: Tone
}

const FEEDBACK: Readonly<Record<FeedbackReconciliationStatus, Descriptor>> = {
  matched: { label: 'Matched', tone: 'ok' },
  /* The contact path working. Neutral, and named for what it is. */
  standalone: { label: 'Direct feedback', tone: 'neutral' },
  /* A code that led nowhere. Usually a typo at Point B. */
  without_registration: { label: 'No registration', tone: 'warn' },
  identity_conflict: { label: 'Identity conflict', tone: 'danger' },
  multiple_feedback: { label: 'In a multiple-response group', tone: 'warn' },
}

const REGISTRATION: Readonly<Record<RegistrationReconciliationStatus, Descriptor>> = {
  matched: { label: 'Matched', tone: 'ok' },
  without_feedback: { label: 'No response', tone: 'neutral' },
  multiple_feedback: { label: 'Several responses', tone: 'warn' },
}

/** The filter labels, which must read identically to the pills. */
export const FEEDBACK_STATUS_LABELS: Readonly<
  Record<FeedbackReconciliationStatus, string>
> = {
  matched: FEEDBACK.matched.label,
  standalone: FEEDBACK.standalone.label,
  without_registration: FEEDBACK.without_registration.label,
  identity_conflict: FEEDBACK.identity_conflict.label,
  multiple_feedback: FEEDBACK.multiple_feedback.label,
}

export const REGISTRATION_STATUS_LABELS: Readonly<
  Record<RegistrationReconciliationStatus, string>
> = {
  matched: REGISTRATION.matched.label,
  without_feedback: REGISTRATION.without_feedback.label,
  multiple_feedback: REGISTRATION.multiple_feedback.label,
}

function Pill({ label, tone }: Descriptor) {
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

export function FeedbackStatusPill({
  status,
}: {
  readonly status: FeedbackReconciliationStatus
}) {
  return <Pill {...FEEDBACK[status]} />
}

export function RegistrationStatusPill({
  status,
}: {
  readonly status: RegistrationReconciliationStatus
}) {
  return <Pill {...REGISTRATION[status]} />
}

/**
 * A row of filter chips.
 *
 * Buttons with `aria-pressed`, exactly as V1 had them: the suite clicks these
 * by label, and a screen reader needs to hear which one is on.
 */
export function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string
  readonly options: readonly { readonly key: T; readonly label: string }[]
  readonly value: T
  readonly onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className={cn(
            'min-h-touch rounded-chip border px-3.5 font-ui text-small transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive',
            value === option.key
              ? 'border-interactive bg-interactive-soft font-medium text-ink'
              : 'border-line bg-surface text-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The search form every browser shares.
 *
 * The term is submitted in a POST body and never placed in the address bar,
 * because it is very often a phone number or an email address and a URL is the
 * one place guaranteed to reach an access log, a browser history and the next
 * request's `Referer`. The note says so where somebody typing one can read it.
 */
export function SearchForm({
  id,
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  onClear,
  hasSearch,
}: {
  readonly id: string
  readonly label: string
  readonly placeholder: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onSubmit: () => void
  readonly onClear: () => void
  readonly hasSearch: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <form
        role="search"
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label
            htmlFor={id}
            className="font-ui text-label font-semibold uppercase tracking-[0.1em] text-muted"
          >
            {label}
          </label>
          <input
            id={id}
            type="search"
            autoComplete="off"
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            className={cn(
              'flex min-h-touch w-full rounded-control border border-line bg-field px-3.5 py-2',
              'font-ui text-base text-ink placeholder:text-faint',
              'hover:border-line-strong',
              'focus-visible:border-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive/40',
            )}
          />
        </div>
        <div className="flex gap-2.5">
          <button
            type="submit"
            className="inline-flex min-h-touch items-center rounded-control border border-line bg-surface px-4 font-ui text-small text-ink transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive"
          >
            Search
          </button>
          {hasSearch && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex min-h-touch items-center px-2 font-ui text-small text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive"
            >
              Clear
            </button>
          )}
        </div>
      </form>
      <p className="font-body text-small text-faint">
        Search terms are sent in the request body and never placed in the address
        bar, because they are usually contact details.
      </p>
    </div>
  )
}
