import { useEffect, useRef, useState, type FormEvent } from 'react'
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

/** Short enough to type at a desk, long enough to be worth encrypting behind. */
const MIN_PASSPHRASE_LENGTH = 12

type Panel = 'none' | 'create' | 'verify' | 'restore'

interface BackupPanelProps {
  /** Called after a restore, so the counts above refresh. */
  readonly onDataChanged?: () => void
}

/**
 * Backup and recovery.
 *
 * Three operator actions, each explicit. Nothing here happens automatically:
 * an automatic backup after every registration would produce a download prompt
 * per participant and a great deal of false confidence.
 *
 * The passphrase never leaves this component's state, and is cleared as soon
 * as each operation finishes.
 */
export function BackupPanel({ onDataChanged }: BackupPanelProps) {
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
    setMetadata(await readBackupMetadata(db))
  }

  useEffect(() => {
    void (async () => {
      await refreshMetadata()
      setThisDeviceId((await peekDeviceId(db)) ?? null)
    })()
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

    // Recorded only after a file was actually selected and opened — real
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

  const formatDate = (value: string | null) =>
    value === null ? 'Never' : new Date(value).toLocaleString()

  return (
    <section aria-labelledby="backup-heading">
      <h2 id="backup-heading" className="pending__title">
        Backup &amp; recovery
      </h2>

      <dl className="station-badge">
        <div>
          <dt>Last backup generated</dt>
          <dd data-testid="last-backup-generated">
            {formatDate(metadata?.lastBackupGeneratedAt ?? null)}
          </dd>
        </div>
        <div>
          <dt>Last backup verified</dt>
          <dd data-testid="last-backup-verified">
            {formatDate(metadata?.lastBackupVerifiedAt ?? null)}
          </dd>
        </div>
      </dl>

      <div className="button-row">
        <button
          type="button"
          className="button button--primary"
          onClick={() => reset(panel === 'create' ? 'none' : 'create')}
        >
          Create encrypted backup
        </button>
        <button
          type="button"
          className="button"
          onClick={() => reset(panel === 'verify' ? 'none' : 'verify')}
        >
          Verify backup file
        </button>
        <button
          type="button"
          className="button"
          onClick={() => reset(panel === 'restore' ? 'none' : 'restore')}
        >
          Restore backup
        </button>
      </div>

      {panel === 'create' && (
        <form className="registration-form" onSubmit={(e) => void handleCreate(e)}>
          <PassphraseFields
            passphrase={passphrase}
            confirmation={confirmation}
            onPassphrase={setPassphrase}
            onConfirmation={setConfirmation}
            withConfirmation
          />
          <p className="notice notice--error">
            This passphrase is not stored by the application. If it is lost, the
            encrypted backup cannot be recovered.
          </p>
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create encrypted backup'}
          </button>
        </form>
      )}

      {panel === 'verify' && (
        <form className="registration-form" onSubmit={(e) => void handleVerify(e)}>
          <BackupFileField inputRef={fileRef} />
          <PassphraseFields
            passphrase={passphrase}
            onPassphrase={setPassphrase}
            confirmation=""
            onConfirmation={() => {}}
          />
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify backup file'}
          </button>
        </form>
      )}

      {panel === 'restore' && pending === null && (
        <form
          className="registration-form"
          onSubmit={(e) => void handlePrepareRestore(e)}
        >
          <BackupFileField inputRef={fileRef} />
          <PassphraseFields
            passphrase={passphrase}
            onPassphrase={setPassphrase}
            confirmation=""
            onConfirmation={() => {}}
          />
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? 'Reading…' : 'Continue'}
          </button>
        </form>
      )}

      {summary !== null && (
        <div className="notice" data-testid="backup-summary">
          <h3 className="pending__title">
            {pending === null ? 'Backup details' : 'Restore backup'}
          </h3>
          <dl className="station-badge">
            <div>
              <dt>Created</dt>
              <dd>{new Date(summary.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Event</dt>
              <dd>{summary.eventId}</dd>
            </div>
            <div>
              <dt>Source device</dt>
              <dd data-testid="summary-source-device">{summary.sourceDeviceId}</dd>
            </div>
            <div>
              <dt>Registrations</dt>
              <dd data-testid="summary-registrations">
                {summary.registrations.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>Feedback</dt>
              <dd data-testid="summary-feedback">
                {summary.feedback.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>Schema</dt>
              <dd>v{summary.schemaVersion}</dd>
            </div>
          </dl>

          {pending !== null && (
            <>
              <p>
                This operation will <strong>merge</strong> records. Existing
                records will not be deleted.
              </p>
              {thisDeviceId !== null &&
                thisDeviceId !== summary.sourceDeviceId && (
                  <p data-testid="different-device-notice">
                    This backup came from another device. This device will keep
                    its current device identity.
                  </p>
                )}
              <div className="button-row">
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void handleConfirmRestore()}
                  disabled={busy}
                >
                  {busy ? 'Restoring…' : 'Restore backup'}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => reset('none')}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {restoreCounts !== null && (
        <div className="notice notice--success" data-testid="restore-result">
          <h3 className="pending__title">Restore complete</h3>
          <dl className="station-badge">
            <div>
              <dt>Registrations added</dt>
              <dd data-testid="restored-registrations-added">
                {restoreCounts.registrationsAdded.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>Registrations updated</dt>
              <dd>{restoreCounts.registrationsUpdated.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Registrations unchanged</dt>
              <dd data-testid="restored-registrations-unchanged">
                {restoreCounts.registrationsUnchanged.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>Feedback added</dt>
              <dd data-testid="restored-feedback-added">
                {restoreCounts.feedbackAdded.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>Feedback updated</dt>
              <dd>{restoreCounts.feedbackUpdated.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Feedback unchanged</dt>
              <dd>{restoreCounts.feedbackUnchanged.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Sequences merged</dt>
              <dd>{restoreCounts.sequencesMerged.toLocaleString()}</dd>
            </div>
          </dl>
        </div>
      )}

      {message !== null && (
        <p
          className={
            summary === null && restoreCounts === null
              ? 'notice notice--error'
              : 'notice'
          }
          role="alert"
          data-testid="backup-message"
        >
          {message}
        </p>
      )}

      {issues.length > 0 && (
        <ul className="pending__list" data-testid="backup-issues">
          {issues.slice(0, 10).map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
          {issues.length > 10 && <li>…and {issues.length - 10} more</li>}
        </ul>
      )}
    </section>
  )
}

function BackupFileField({
  inputRef,
}: {
  readonly inputRef: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor="backup-file">
        Backup file
      </label>
      <input
        id="backup-file"
        ref={inputRef}
        className="field__input"
        type="file"
        accept=".oefbackup,application/octet-stream"
      />
    </div>
  )
}

interface PassphraseFieldsProps {
  readonly passphrase: string
  readonly confirmation: string
  readonly onPassphrase: (value: string) => void
  readonly onConfirmation: (value: string) => void
  readonly withConfirmation?: boolean
}

function PassphraseFields({
  passphrase,
  confirmation,
  onPassphrase,
  onConfirmation,
  withConfirmation = false,
}: PassphraseFieldsProps) {
  return (
    <>
      <div className="field">
        <label className="field__label" htmlFor="backup-passphrase">
          Backup passphrase
        </label>
        <input
          id="backup-passphrase"
          className="field__input"
          type="password"
          value={passphrase}
          autoComplete="off"
          onChange={(event) => onPassphrase(event.target.value)}
        />
      </div>

      {withConfirmation && (
        <div className="field">
          <label className="field__label" htmlFor="backup-passphrase-confirm">
            Confirm passphrase
          </label>
          <input
            id="backup-passphrase-confirm"
            className="field__input"
            type="password"
            value={confirmation}
            autoComplete="off"
            onChange={(event) => onConfirmation(event.target.value)}
          />
        </div>
      )}
    </>
  )
}
