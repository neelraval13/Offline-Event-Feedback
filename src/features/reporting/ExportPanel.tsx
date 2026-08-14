import { useState } from 'react'
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
 * plain link: a link cannot carry a header, and the usual workaround — a token
 * in the query string — would write the credential into browser history, the
 * server's access log and any proxy in between.
 *
 * Filenames come from the server and carry an event, a kind and a date. Never a
 * participant: a filename is visible in a downloads folder and an email client
 * long before anyone opens the file.
 */

const EXPORTS: readonly {
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
    description: 'Registration pairs sharing a normalised phone number or email.',
  },
  {
    kind: 'report.xlsx',
    label: 'Full workbook (XLSX)',
    description:
      'Summary, participants, responses, duplicate candidates and a metadata sheet recording exactly which rule produced each figure.',
  },
]

interface ExportPanelProps {
  readonly eventId: string
  readonly runId: string | undefined
}

export function ExportPanel({ eventId, runId }: ExportPanelProps) {
  const session = useReportingSession()
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
    <section aria-labelledby="export-heading">
      <h2 id="export-heading" className="pending__title">
        Export
      </h2>

      <p className="screen__note">
        Exports contain participants&rsquo; names, phone numbers and email
        addresses. They are generated from the selected reconciliation run and
        leave this screen as files on the organiser&rsquo;s machine — handle
        them accordingly.
      </p>

      {error !== null && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}

      {saved !== null && (
        <p className="notice notice--success" role="status">
          Downloaded {saved}.
        </p>
      )}

      <ul className="surface-list">
        {EXPORTS.map((entry) => (
          <li key={entry.kind}>
            <button
              type="button"
              className="button"
              disabled={busy !== null}
              onClick={() => void run(entry.kind)}
            >
              {busy === entry.kind ? 'Preparing…' : entry.label}
            </button>
            <p className="surface-list__description">{entry.description}</p>
          </li>
        ))}
      </ul>

      <p className="screen__note">
        Text captured from participants is written so that a spreadsheet treats
        it as text. A comment beginning <code>=</code> and a phone number
        beginning <code>+</code> are otherwise interpreted as formulas.
      </p>
    </section>
  )
}
