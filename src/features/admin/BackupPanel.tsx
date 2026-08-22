import {
  CheckCircle2Icon,
  DownloadIcon,
  FileCheck2Icon,
  TriangleAlertIcon,
  UploadIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AppButton, FormField } from '../../components/design-system'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Input } from '../../components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet'
import {
  createEncryptedBackup,
  downloadTextFile,
  MAX_BACKUP_FILE_BYTES,
  restoreBackup,
  verifyBackupFile,
  type BackupPayloadV1,
  type BackupSummary,
  type RestoreCounts,
} from '../../lib/backup'
import {
  LAST_BACKUP_GENERATED_KEY,
  LAST_BACKUP_VERIFIED_KEY,
  LAST_RESTORE_KEY,
  readBackupMetadata,
  recordBackupEvent,
  type BackupMetadata,
} from '../../lib/backup/backupMetadata'
import { db, peekDeviceId } from '../../lib/storage'
import { cn } from '../../lib/ui/cn'
import { FactRow, formatMoment, SectionHead } from './console'

/** Short enough to type at a desk, long enough to be worth encrypting behind. */
const MIN_PASSPHRASE_LENGTH = 12

type Panel = 'none' | 'create' | 'verify' | 'restore'

interface BackupPanelProps {
  /** Called after a restore, so the counts above refresh. */
  readonly onDataChanged?: () => void
  /** Reported upward for the overview's "last verified backup" line. */
  readonly onMetadataChange?: (metadata: BackupMetadata | null) => void
}

/**
 * Backup and recovery.
 *
 * Three operator actions, each explicit. Nothing here happens automatically: an
 * automatic backup after every registration would produce a download prompt per
 * participant and a great deal of false confidence.
 *
 * The passphrase never leaves this component's state, and is cleared as soon as
 * each operation finishes.
 *
 * ## Why the workflows moved into sheets
 *
 * V1 expanded each one inline, sharing one set of state variables, so opening
 * "verify" cleared whatever "create" was showing and the console's own length
 * changed by several hundred pixels depending on which was open. On a support
 * screen somebody reads under pressure, the page moving is the problem.
 *
 * While an operation is actually running the sheet cannot be dismissed. Radix
 * closes on Escape, on a click outside and on the close control; for a sheet
 * that is only collecting input that is right, and for one that is midway
 * through encrypting or merging it is a lie, because the work carries on and a
 * sheet that vanished would have said it stopped. Nothing about the backup
 * functions changed to achieve that: it is the sheet that refuses to close.
 *
 * ## Restore is not destructive
 *
 * It merges. Nothing is deleted, so it is not painted red: red would say "this
 * removes data", which is false, and an operator who believes that will not
 * restore a backup when they should.
 */
export function BackupPanel({
  onDataChanged,
  onMetadataChange,
}: BackupPanelProps) {
  const [panel, setPanel] = useState<Panel>('none')
  const [metadata, setMetadata] = useState<BackupMetadata | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [issues, setIssues] = useState<readonly string[]>([])
  const [summary, setSummary] = useState<BackupSummary | null>(null)
  const [pending, setPending] = useState<BackupPayloadV1 | null>(null)
  const [restoreCounts, setRestoreCounts] = useState<RestoreCounts | null>(null)
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null)

  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const refreshMetadata = async () => {
    const next = await readBackupMetadata(db)
    setMetadata(next)
    onMetadataChange?.(next)
  }

  useEffect(() => {
    void (async () => {
      await refreshMetadata()
      setThisDeviceId((await peekDeviceId(db)) ?? null)
    })()
    // Reads once on open, exactly as before.
  }, [])

  /** Clears every trace of the passphrase from component state. */
  function clearSecrets() {
    setPassphrase('')
    setConfirmation('')
    if (fileRef.current !== null) {
      fileRef.current.value = ''
    }
  }

  function reset(next: Panel) {
    setPanel(next)
    setMessage(null)
    setIssues([])
    setSummary(null)
    setPending(null)
    setRestoreCounts(null)
    clearSecrets()
  }

  async function readSelectedFile(): Promise<string | null> {
    const file = fileRef.current?.files?.[0]

    if (file === undefined) {
      setMessage('Choose a backup file first.')
      return null
    }
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setMessage('That file is too large to be a backup from this application.')
      return null
    }

    return file.text()
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (busy) {
      return
    }

    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setMessage(`Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`)
      return
    }
    if (passphrase !== confirmation) {
      setMessage('The two passphrases do not match.')
      return
    }

    setBusy(true)
    setMessage(null)
    setIssues([])

    const result = await createEncryptedBackup(db, passphrase)

    if (!result.ok) {
      setMessage(result.message)
      setIssues(result.issues ?? [])
      clearSecrets()
      setBusy(false)
      return
    }

    downloadTextFile(result.fileName, result.contents)
    await recordBackupEvent(db, LAST_BACKUP_GENERATED_KEY)
    await refreshMetadata()

    setSummary(result.summary)
    // "Generated", never "stored": the browser cannot tell us whether the
    // operator kept the file or where it went.
    setMessage(`Backup file generated: ${result.fileName}`)
    clearSecrets()
    setBusy(false)
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault()
    if (busy) {
      return
    }

    setBusy(true)
    setMessage(null)
    setIssues([])
    setSummary(null)

    const contents = await readSelectedFile()
    if (contents === null) {
      setBusy(false)
      return
    }

    const result = await verifyBackupFile(contents, passphrase)

    if (!result.ok) {
      setMessage(result.message)
      setIssues(result.issues ?? [])
      clearSecrets()
      setBusy(false)
      return
    }

    // Recorded only after a file was actually selected and opened, real
    // evidence that a recoverable backup exists.
    await recordBackupEvent(db, LAST_BACKUP_VERIFIED_KEY)
    await refreshMetadata()

    setSummary(result.summary)
    setMessage('Backup verified. Nothing was imported.')
    clearSecrets()
    setBusy(false)
  }

  async function handlePrepareRestore(event: FormEvent) {
    event.preventDefault()
    if (busy) {
      return
    }

    setBusy(true)
    setMessage(null)
    setIssues([])

    const contents = await readSelectedFile()
    if (contents === null) {
      setBusy(false)
      return
    }

    const result = await verifyBackupFile(contents, passphrase)

    if (!result.ok) {
      setMessage(result.message)
      setIssues(result.issues ?? [])
      clearSecrets()
      setBusy(false)
      return
    }

    // Decrypted once. The operator confirms before anything is written.
    setSummary(result.summary)
    setPending(result.payload)
    clearSecrets()
    setBusy(false)
  }

  async function handleConfirmRestore() {
    if (busy || pending === null) {
      return
    }

    setBusy(true)
    const result = await restoreBackup(db, pending)

    if (!result.ok) {
      setMessage(
        'The restore was stopped and nothing was imported. The existing records on this device are unchanged.',
      )
      setIssues(result.conflicts)
      setPending(null)
      setBusy(false)
      return
    }

    await recordBackupEvent(db, LAST_RESTORE_KEY)
    await refreshMetadata()

    setRestoreCounts(result.counts)
    setMessage('Restore complete.')
    setPending(null)
    setBusy(false)
    onDataChanged?.()
  }

  const sheetOpen = panel !== 'none'

  return (
    <section aria-labelledby="backup-heading" className="flex flex-col">
      <SectionHead
        title="Backup & recovery"
        note="Encrypted. The passphrase is never stored."
      />
      <h2 id="backup-heading" className="sr-only">
        Backup and recovery
      </h2>

      <div className="grid gap-x-10 md:grid-cols-2">
        <FactRow label="Last backup generated">
          <span
            data-testid="last-backup-generated"
            className="font-ui text-small tabular-nums text-muted"
          >
            {formatMoment(metadata?.lastBackupGeneratedAt ?? null)}
          </span>
        </FactRow>
        <FactRow label="Last backup verified">
          <span
            data-testid="last-backup-verified"
            className="font-ui text-small tabular-nums text-muted"
          >
            {formatMoment(metadata?.lastBackupVerifiedAt ?? null)}
          </span>
        </FactRow>
      </div>

      {/*
        Three actions, three weights. Creating one is what an operator should do
        at the end of every shift; verifying is how they find out a backup is
        real; restoring is rare and needs thinking about.
      */}
      <div className="flex flex-col gap-2.5 border-t border-line pt-4 sm:flex-row sm:flex-wrap">
        <AppButton onClick={() => reset('create')}>
          <DownloadIcon />
          Create encrypted backup
        </AppButton>
        <AppButton variant="secondary" onClick={() => reset('verify')}>
          <FileCheck2Icon />
          Verify backup file
        </AppButton>
        <AppButton variant="secondary" onClick={() => reset('restore')}>
          <UploadIcon />
          Restore backup
        </AppButton>
      </div>

      <p className="pt-3 font-body text-small text-faint">
        Restoring merges records into this device. Nothing is deleted.
      </p>

      <Sheet
        open={sheetOpen}
        onOpenChange={(next) => {
          // Dismissal is already blocked while busy; this is the guard for the
          // controlled path, so nothing can close the sheet mid-operation.
          if (!next && !busy) {
            reset('none')
          }
        }}
      >
        <SheetContent side="right" className="sm:max-w-xl" dismissible={!busy}>
          {panel === 'create' && (
            <CreateSheet
              busy={busy}
              passphrase={passphrase}
              confirmation={confirmation}
              onPassphrase={setPassphrase}
              onConfirmation={setConfirmation}
              onSubmit={(event) => void handleCreate(event)}
              onClose={() => reset('none')}
              summary={summary}
            />
          )}

          {panel === 'verify' && (
            <VerifySheet
              busy={busy}
              fileRef={fileRef}
              passphrase={passphrase}
              onPassphrase={setPassphrase}
              onSubmit={(event) => void handleVerify(event)}
              onClose={() => reset('none')}
              summary={summary}
            />
          )}

          {panel === 'restore' && (
            <RestoreSheet
              busy={busy}
              fileRef={fileRef}
              passphrase={passphrase}
              onPassphrase={setPassphrase}
              onPrepare={(event) => void handlePrepareRestore(event)}
              onConfirm={() => void handleConfirmRestore()}
              onClose={() => reset('none')}
              summary={summary}
              pending={pending}
              restoreCounts={restoreCounts}
              thisDeviceId={thisDeviceId}
            />
          )}

          <Outcome message={message} issues={issues} succeeded={summary !== null || restoreCounts !== null} />
        </SheetContent>
      </Sheet>
    </section>
  )
}

/* ------------------------------------------------------------------------- *
 * Create
 * ------------------------------------------------------------------------- */

function CreateSheet({
  busy,
  passphrase,
  confirmation,
  onPassphrase,
  onConfirmation,
  onSubmit,
  onClose,
  summary,
}: {
  readonly busy: boolean
  readonly passphrase: string
  readonly confirmation: string
  readonly onPassphrase: (value: string) => void
  readonly onConfirmation: (value: string) => void
  readonly onSubmit: (event: FormEvent) => void
  readonly onClose: () => void
  readonly summary: BackupSummary | null
}) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>Create encrypted backup</SheetTitle>
        <SheetDescription>
          Everything on this device, encrypted into one file you download and
          keep.
        </SheetDescription>
      </SheetHeader>

      {summary === null ? (
        <>
          {/*
            The warning that matters, before the fields rather than under them.
            There is no recovery path for a lost passphrase.
          */}
          <Alert tone="warn">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>The application does not store this passphrase</AlertTitle>
            <AlertDescription>
              If it is lost, the encrypted backup cannot be recovered. Store it
              securely before you continue.
            </AlertDescription>
          </Alert>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <PassphraseField
              label="Backup passphrase"
              value={passphrase}
              onChange={onPassphrase}
              disabled={busy}
              hint={`At least ${MIN_PASSPHRASE_LENGTH} characters.`}
            />
            <PassphraseField
              label="Confirm passphrase"
              value={confirmation}
              onChange={onConfirmation}
              disabled={busy}
            />

            <SheetActions>
              <AppButton type="submit" busy={busy} busyLabel="Creating…">
                Create encrypted backup
              </AppButton>
              <AppButton
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </AppButton>
            </SheetActions>
          </form>
        </>
      ) : (
        <>
          <Alert tone="ok">
            <CheckCircle2Icon aria-hidden="true" />
            <AlertTitle>Backup file generated</AlertTitle>
            <AlertDescription>
              The file has been handed to your browser. Check it reached the
              place you expect before relying on it.
            </AlertDescription>
          </Alert>

          <SummaryList summary={summary} />

          <SheetActions>
            <AppButton onClick={onClose}>Done</AppButton>
          </SheetActions>
        </>
      )}
    </>
  )
}

/* ------------------------------------------------------------------------- *
 * Verify
 * ------------------------------------------------------------------------- */

function VerifySheet({
  busy,
  fileRef,
  passphrase,
  onPassphrase,
  onSubmit,
  onClose,
  summary,
}: {
  readonly busy: boolean
  readonly fileRef: React.RefObject<HTMLInputElement | null>
  readonly passphrase: string
  readonly onPassphrase: (value: string) => void
  readonly onSubmit: (event: FormEvent) => void
  readonly onClose: () => void
  readonly summary: BackupSummary | null
}) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>Verify backup file</SheetTitle>
        <SheetDescription>
          Opens the file and reports what is inside it. Nothing is imported and
          nothing on this device changes.
        </SheetDescription>
      </SheetHeader>

      {summary === null ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <BackupFileField inputRef={fileRef} disabled={busy} />
          <PassphraseField
            label="Backup passphrase"
            value={passphrase}
            onChange={onPassphrase}
            disabled={busy}
          />

          <SheetActions>
            <AppButton type="submit" busy={busy} busyLabel="Verifying…">
              Verify backup file
            </AppButton>
            <AppButton
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </AppButton>
          </SheetActions>
        </form>
      ) : (
        <div data-testid="backup-summary" className="flex flex-col gap-5">
          <Alert tone="ok">
            <CheckCircle2Icon aria-hidden="true" />
            <AlertTitle>Backup verified</AlertTitle>
            <AlertDescription>
              This file opens, and this is what is in it. A file nobody has ever
              opened is a file nobody knows is recoverable.
            </AlertDescription>
          </Alert>

          <SummaryList summary={summary} />

          <SheetActions>
            <AppButton onClick={onClose}>Done</AppButton>
          </SheetActions>
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------------- *
 * Restore
 * ------------------------------------------------------------------------- */

function RestoreSheet({
  busy,
  fileRef,
  passphrase,
  onPassphrase,
  onPrepare,
  onConfirm,
  onClose,
  summary,
  pending,
  restoreCounts,
  thisDeviceId,
}: {
  readonly busy: boolean
  readonly fileRef: React.RefObject<HTMLInputElement | null>
  readonly passphrase: string
  readonly onPassphrase: (value: string) => void
  readonly onPrepare: (event: FormEvent) => void
  readonly onConfirm: () => void
  readonly onClose: () => void
  readonly summary: BackupSummary | null
  readonly pending: BackupPayloadV1 | null
  readonly restoreCounts: RestoreCounts | null
  readonly thisDeviceId: string | null
}) {
  if (restoreCounts !== null) {
    return <RestoreResult counts={restoreCounts} onClose={onClose} />
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>Restore backup</SheetTitle>
        <SheetDescription>
          {pending === null
            ? 'Reads the file first. Nothing is written until you confirm.'
            : 'This file opened. Nothing has been written yet.'}
        </SheetDescription>
      </SheetHeader>

      {pending === null ? (
        <form onSubmit={onPrepare} className="flex flex-col gap-4">
          <BackupFileField inputRef={fileRef} disabled={busy} />
          <PassphraseField
            label="Backup passphrase"
            value={passphrase}
            onChange={onPassphrase}
            disabled={busy}
          />

          <SheetActions>
            <AppButton type="submit" busy={busy} busyLabel="Reading…">
              Continue
            </AppButton>
            <AppButton
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </AppButton>
          </SheetActions>
        </form>
      ) : (
        <div data-testid="backup-summary" className="flex flex-col gap-5">
          {summary !== null && <SummaryList summary={summary} />}

          <Alert tone="info">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>This merges records</AlertTitle>
            <AlertDescription>
              This operation will <strong>merge</strong> records. Existing
              records will not be deleted or replaced by older copies. Anything
              the backup has and this device does not is added.
            </AlertDescription>
          </Alert>

          {summary !== null &&
            thisDeviceId !== null &&
            thisDeviceId !== summary.sourceDeviceId && (
              <Alert tone="neutral">
                <TriangleAlertIcon aria-hidden="true" />
                <AlertDescription data-testid="different-device-notice">
                  This backup came from another device. This device will keep
                  its current device identity.
                </AlertDescription>
              </Alert>
            )}

          <SheetActions>
            <AppButton busy={busy} busyLabel="Restoring…" onClick={onConfirm}>
              <UploadIcon />
              Restore backup
            </AppButton>
            <AppButton variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </AppButton>
          </SheetActions>
        </div>
      )}
    </>
  )
}

function RestoreResult({
  counts,
  onClose,
}: {
  readonly counts: RestoreCounts
  readonly onClose: () => void
}) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>Restore complete</SheetTitle>
        <SheetDescription>
          The counts on the console behind this have been refreshed.
        </SheetDescription>
      </SheetHeader>

      {/*
        Seven figures, as a list rather than seven stat cards. "Already here" is
        usually the largest and the least interesting: what an operator wants to
        know is how much arrived.
      */}
      <div data-testid="restore-result" className="flex flex-col">
        <ResultGroup
          title="Registrations"
          added={counts.registrationsAdded}
          updated={counts.registrationsUpdated}
          unchanged={counts.registrationsUnchanged}
          addedTestId="restored-registrations-added"
          unchangedTestId="restored-registrations-unchanged"
        />
        <ResultGroup
          title="Feedback"
          added={counts.feedbackAdded}
          updated={counts.feedbackUpdated}
          unchanged={counts.feedbackUnchanged}
          addedTestId="restored-feedback-added"
        />
        <FactRow label="Sequences merged">
          <span className="font-ui tabular-nums">
            {counts.sequencesMerged.toLocaleString()}
          </span>
        </FactRow>
      </div>

      <SheetActions>
        <AppButton onClick={onClose}>Done</AppButton>
      </SheetActions>
    </>
  )
}

function ResultGroup({
  title,
  added,
  updated,
  unchanged,
  addedTestId,
  unchangedTestId,
}: {
  readonly title: string
  readonly added: number
  readonly updated: number
  readonly unchanged: number
  readonly addedTestId: string
  readonly unchangedTestId?: string
}): ReactNode {
  return (
    <div className="flex flex-col">
      <p className="border-t border-line pt-4 pb-1 font-ui text-label font-semibold uppercase tracking-[0.16em] text-muted">
        {title}
      </p>
      <FactRow label="Added">
        <span
          data-testid={addedTestId}
          className="font-ui text-stat-small font-semibold tabular-nums text-ok"
        >
          {added.toLocaleString()}
        </span>
      </FactRow>
      <FactRow label="Updated">
        <span className="font-ui tabular-nums">{updated.toLocaleString()}</span>
      </FactRow>
      <FactRow label="Already here">
        <span
          {...(unchangedTestId === undefined ? {} : { 'data-testid': unchangedTestId })}
          className="font-ui tabular-nums text-muted"
        >
          {unchanged.toLocaleString()}
        </span>
      </FactRow>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Shared
 * ------------------------------------------------------------------------- */

/**
 * The message and any issues, at the bottom of whichever sheet is open.
 *
 * `succeeded` decides the tone rather than the wording: a message alongside a
 * summary is an outcome, and one alone is a refusal.
 */
function Outcome({
  message,
  issues,
  succeeded,
}: {
  readonly message: string | null
  readonly issues: readonly string[]
  readonly succeeded: boolean
}) {
  if (message === null && issues.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-3">
      {message !== null && (
        <Alert tone={succeeded ? 'ok' : 'danger'}>
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription data-testid="backup-message">
            {message}
          </AlertDescription>
        </Alert>
      )}

      {issues.length > 0 && (
        <ul data-testid="backup-issues" className="flex flex-col">
          {issues.slice(0, 10).map((issue) => (
            <li
              key={issue}
              className="border-t border-line py-2 font-body text-small text-muted"
            >
              {issue}
            </li>
          ))}
          {issues.length > 10 && (
            <li className="border-t border-line py-2 font-body text-small text-faint">
              …and {issues.length - 10} more
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function SheetActions({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2.5 border-t border-line pt-4">
      {children}
    </div>
  )
}

function SummaryList({ summary }: { readonly summary: BackupSummary }) {
  return (
    <div className="flex flex-col">
      <FactRow label="Created">
        <span className="font-mono text-small tabular-nums">
          {new Date(summary.createdAt).toLocaleString()}
        </span>
      </FactRow>
      <FactRow label="Event">
        <span className="font-mono text-small break-all select-all">
          {summary.eventId}
        </span>
      </FactRow>
      <FactRow label="Source device">
        <span
          data-testid="summary-source-device"
          className="font-mono text-small break-all select-all"
        >
          {summary.sourceDeviceId}
        </span>
      </FactRow>
      <FactRow label="Registrations">
        <span data-testid="summary-registrations" className="font-ui tabular-nums">
          {summary.registrations.toLocaleString()}
        </span>
      </FactRow>
      <FactRow label="Feedback">
        <span data-testid="summary-feedback" className="font-ui tabular-nums">
          {summary.feedback.toLocaleString()}
        </span>
      </FactRow>
      <FactRow label="Schema">
        <span className="font-mono text-small">v{summary.schemaVersion}</span>
      </FactRow>
    </div>
  )
}

function BackupFileField({
  inputRef,
  disabled,
}: {
  readonly inputRef: React.RefObject<HTMLInputElement | null>
  readonly disabled: boolean
}) {
  return (
    <FormField label="Backup file" required hint="A .oefbackup file.">
      {(field) => (
        <input
          {...field}
          /*
            Marked required for the reader, but without the native constraint:
            this panel checks the file itself and says "Choose a backup file
            first" alongside everything else it reports, rather than handing
            the operator a browser bubble that vanishes on the next click.
          */
          required={false}
          aria-required={true}
          ref={inputRef}
          type="file"
          accept=".oefbackup,application/octet-stream"
          disabled={disabled}
          className={cn(
            'flex min-h-touch w-full items-center rounded-control border border-line bg-field px-3.5 py-2',
            'font-ui text-base text-ink',
            'file:mr-3 file:rounded-chip file:border file:border-line file:bg-surface',
            'file:px-3 file:py-1.5 file:font-ui file:text-small file:text-ink',
            'hover:border-line-strong',
            'focus-visible:border-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive/40',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
      )}
    </FormField>
  )
}

function PassphraseField({
  label,
  value,
  onChange,
  disabled,
  hint,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled: boolean
  readonly hint?: string
}) {
  return (
    <FormField label={label} required {...(hint === undefined ? {} : { hint })}>
      {(field) => (
        <Input
          {...field}
          type="password"
          autoComplete="off"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FormField>
  )
}
