import { CheckCircle2Icon, DownloadIcon, FileSpreadsheetIcon, ShieldAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { AppButton, Section } from '../../../components/design-system'
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert'
import { CSV_EXPORTS, WORKBOOK_SHEETS, type RunState } from './fixtures'

/*
 * Exports.
 *
 * The one place in the product where participant data leaves the protected
 * workspace and becomes a file on somebody's laptop, in a downloads folder, in
 * a chat attachment, on a USB stick. So the screen leads with that rather than
 * mentioning it at the bottom.
 *
 * ## The workbook is the deliverable
 *
 * Four exports of equal weight is an accurate list and unhelpful guidance. The
 * full workbook is the complete report and the thing a client is actually
 * given; the three CSVs are data extracts for somebody who is going to do
 * further work. So the workbook is primary and named for what it is, and the
 * CSVs are secondary without being hidden or removed.
 *
 * Its six sheets are named from `server/reporting/exportXlsx.ts` rather than
 * from the production panel's description, which lists five and omits
 * `Participant Feedback`, the sheet most readers actually want.
 *
 * ## The credential never reaches a URL
 *
 * Each file is fetched with the secret in an Authorization header and handed to
 * the browser as a blob. A plain link cannot carry a header, and the usual
 * workaround puts the credential in the query string, which writes it into
 * browser history, the server's access log and every proxy in between. The
 * concept keeps the same shape so nothing here proposes a download link.
 */

interface ExportConceptProps {
  readonly runState: RunState
}

export function ExportConcept({ runState }: ExportConceptProps) {
  /* Only one export prepares at a time, matching the real panel. */
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const historical = runState === 'historical'

  function prepare(kind: string, fileName: string) {
    setSaved(null)
    setBusy(kind)
    /* Concept only: no request is made and no file is produced. */
    window.setTimeout(() => {
      setBusy(null)
      setSaved(fileName)
    }, 1200)
  }

  return (
    <div className="flex flex-col gap-page">
      <Alert tone="warn">
        <ShieldAlertIcon aria-hidden="true" />
        <AlertTitle>These files contain participant contact details</AlertTitle>
        <AlertDescription>
          Every export carries names, phone numbers and email addresses, and the
          workbook and participants CSV also carry driving licence numbers where
          riders gave them. Files leave this protected workspace and are saved to
          the organiser&rsquo;s device, where nothing in this application can
          reach them again.
        </AlertDescription>
      </Alert>

      {historical && (
        <Alert tone="warn">
          <DownloadIcon aria-hidden="true" />
          <AlertTitle>Exporting a historical snapshot</AlertTitle>
          <AlertDescription>
            This file will describe the reconciliation snapshot selected above,
            not the latest one. That is legitimate: a historical run is what the
            event looked like when a figure was quoted, and exporting it is how
            that figure is evidenced. Switch to the current snapshot if this is
            a final report.
          </AlertDescription>
        </Alert>
      )}

      {saved !== null && (
        <Alert tone="ok">
          <CheckCircle2Icon aria-hidden="true" />
          <AlertDescription>
            Downloaded {saved}. Check it reached the place you expect.
          </AlertDescription>
        </Alert>
      )}

      {/* -------------------------------------------------------------- *
        The complete report.
      * --------------------------------------------------------------- */}
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
              onClick={() =>
                prepare('report.xlsx', 'ff-rc-2026-08-23-report-2026-08-23.xlsx')
              }
            >
              <DownloadIcon />
              Download workbook
            </AppButton>
          </div>
        </div>
      </Section>

      {/* -------------------------------------------------------------- *
        Data extracts.
      * --------------------------------------------------------------- */}
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
                  onClick={() =>
                    prepare(entry.kind, `ff-rc-2026-08-23-${entry.kind}`)
                  }
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
