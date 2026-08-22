import {
  CheckCircle2Icon,
  DownloadIcon,
  FileSpreadsheetIcon,
  ShieldAlertIcon,
} from 'lucide-react'
import { useState } from 'react'
import { AppButton, ErrorState, Section } from '../../components/design-system'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import {
  describeFailure,
  downloadExport,
  saveExport,
} from '../../lib/reporting/reportingClient'
import type { ExportKind } from '../../lib/reporting/types'
import { useReportingSession } from './session'

/*
 * Exports.
 *
 * Each file is fetched with the reporting credential in an Authorization
 * header, turned into a blob and handed to the browser. Deliberately not a
 * plain link: a link cannot carry a header, and the usual workaround (a token
 * in the query string) would write the credential into browser history, the
 * server's access log and any proxy in between.
 *
 * Filenames come from the server and carry an event, a kind and a date. Never a
 * participant: a filename is visible in a downloads folder and an email client
 * long before anyone opens the file.
 *
 * ## What V2 changed
 *
 * Emphasis and honesty, not mechanics. `downloadExport` and `saveExport` are
 * called exactly as before.
 *
 * Four exports of equal weight is an accurate list and unhelpful guidance. The
 * workbook is the complete report and the thing a client is handed; the three
 * CSVs are extracts for somebody doing further work. So the workbook is primary
 * and its sheets are named.
 *
 * Those sheet names were checked against `server/reporting/exportXlsx.ts`
 * rather than carried over from the previous copy, which listed five and
 * omitted `Participant Feedback`, the sheet `participantFeedback.ts` calls the
 * one most readers actually want.
 */

/** Read from the workbook builder, in the order it adds them. */
const WORKBOOK_SHEETS: readonly { readonly name: string; readonly purpose: string }[] = [
  {
    name: 'Summary',
    purpose:
      'Run identity, every count, and the coverage figures with the rule that produced each one spelled out.',
  },
  {
    name: 'Participant Feedback',
    purpose:
      'One readable row per rider and what they said, including riders with no registration. A view over the audit sheets, never a source of truth.',
  },
  {
    name: 'Registrations',
    purpose: 'One row per registration exactly as the run classified it.',
  },
  {
    name: 'Feedback',
    purpose:
      'One row per response, including responses that matched no registration and both halves of an ambiguous pair.',
  },
  {
    name: 'Duplicate Candidates',
    purpose: 'Registration pairs sharing a normalised phone number or email.',
  },
  {
    name: 'Metadata',
    purpose:
      'Which run produced the file, and the membership, analytics, coverage and matching rules behind its figures.',
  },
]

const CSV_EXPORTS: readonly {
  readonly kind: ExportKind
  readonly label: string
  readonly description: string
}[] = [
  {
    kind: 'registrations.csv',
    label: 'Participants (CSV)',
    description:
      'One row per registration with its reconciliation status. Answer columns are filled only where exactly one response was matched; a participant with several responses has them blank.',
  },
  {
    kind: 'feedback.csv',
    label: 'Responses (CSV)',
    description:
      'One row per response, including responses that matched no registration. Every individual response appears here, including both halves of an ambiguous pair.',
  },
  {
    kind: 'duplicate-candidates.csv',
    label: 'Possible duplicates (CSV)',
    description:
      'Registration pairs sharing a normalised phone number or email. Never truncated, unlike the on-screen preview.',
  },
]

interface ExportPanelProps {
  readonly eventId: string
  readonly runId: string | undefined
}

export function ExportPanel({ eventId, runId }: ExportPanelProps) {
  const session = useReportingSession()
  /** Only one export prepares at a time; the rest are disabled while it does. */
  const [busy, setBusy] = useState<ExportKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function run(kind: ExportKind) {
    setBusy(kind)
    setError(null)
    setSaved(null)

    const result = await session.call((secret) =>
      downloadExport(secret, eventId, kind, runId),
    )
    setBusy(null)

    if (!result.ok) {
      setError(describeFailure(result.failure))
      return
    }

    saveExport(result.value)
    setSaved(result.value.fileName)
  }

  return (
    <div className="flex flex-col gap-page">
      <Alert tone="warn">
        <ShieldAlertIcon aria-hidden="true" />
        <AlertTitle>These files contain participant contact details</AlertTitle>
        <AlertDescription>
          Every export carries participants&rsquo; names, phone numbers, email
          addresses and their responses, and the workbook and participants CSV
          also carry driving licence numbers where riders gave them. Files leave
          this protected workspace and are handed to your browser, after which
          nothing in this application can reach them again.
        </AlertDescription>
      </Alert>

      {error !== null && (
        <ErrorState title="That export could not be prepared">{error}</ErrorState>
      )}

      {saved !== null && (
        <Alert tone="ok" role="status">
          <CheckCircle2Icon aria-hidden="true" />
          <AlertDescription>Downloaded {saved}.</AlertDescription>
        </Alert>
      )}

      <Section
        title="Full report"
        description="The complete event report, and the file to hand over. Six sheets in one workbook."
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-10">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p className="flex items-center gap-2.5">
              <FileSpreadsheetIcon aria-hidden="true" className="size-5 text-accent" />
              <span className="font-display text-title tracking-wide text-ink">
                Full workbook (XLSX)
              </span>
            </p>

            <dl className="flex flex-col">
              {WORKBOOK_SHEETS.map((sheet) => (
                <div
                  key={sheet.name}
                  className="flex flex-col gap-0.5 border-t border-line py-2.5 sm:flex-row sm:gap-6"
                >
                  <dt className="font-ui text-small font-semibold text-ink sm:w-[12rem] sm:shrink-0">
                    {sheet.name}
                  </dt>
                  <dd className="font-body text-small text-muted">{sheet.purpose}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="shrink-0">
            <AppButton
              busy={busy === 'report.xlsx'}
              busyLabel="Preparing…"
              disabled={busy !== null && busy !== 'report.xlsx'}
              onClick={() => void run('report.xlsx')}
            >
              <DownloadIcon />
              Download workbook
            </AppButton>
          </div>
        </div>
      </Section>

      <Section
        title="Data extracts"
        description="Single-table CSVs for further analysis. Everything in them is also in the workbook."
      >
        <div className="flex flex-col">
          {CSV_EXPORTS.map((entry) => (
            <div
              key={entry.kind}
              className="flex flex-col gap-3 border-t border-line py-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:gap-8"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-ui text-base font-semibold text-ink">
                  {entry.label}
                </span>
                <span className="max-w-measure font-body text-small text-muted">
                  {entry.description}
                </span>
              </div>
              <div className="shrink-0">
                <AppButton
                  variant="secondary"
                  busy={busy === entry.kind}
                  busyLabel="Preparing…"
                  disabled={busy !== null && busy !== entry.kind}
                  onClick={() => void run(entry.kind)}
                >
                  Download
                </AppButton>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <p className="max-w-measure font-body text-small text-faint">
        Text captured from participants is written so that a spreadsheet treats
        it as text. A comment beginning <code>=</code> and a phone number
        beginning <code>+</code> are otherwise interpreted as formulas. Filenames
        carry the event, the kind and the date, never a participant.
      </p>
    </div>
  )
}
