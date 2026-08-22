import {
  CheckCircle2Icon,
  DownloadIcon,
  FileCheck2Icon,
  TriangleAlertIcon,
  UploadIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { AppButton, FormField } from '@/components/design-system'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/ui/cn'
import { FactRow, SectionHead } from './AdminSections'
import type { BackupState } from './ConceptStateBar'
import {
  CONCEPT_BACKUP_FILENAME,
  CONCEPT_BACKUP_SUMMARY,
  CONCEPT_BACKUP_WRONG_PASSPHRASE,
  CONCEPT_DEVICE,
  CONCEPT_LAST_BACKUP_GENERATED,
  CONCEPT_LAST_BACKUP_VERIFIED,
  CONCEPT_MIN_PASSPHRASE,
  CONCEPT_RESTORE_COUNTS,
  CONCEPT_RESTORE_STOPPED,
} from './fixtures'

/*
 * Backup and recovery: three deliberate actions, each in its own sheet.
 *
 * ## Why sheets, and not V1's inline panels
 *
 * V1 expands each workflow inline, underneath the metadata and above the sync
 * section. Three of them share one set of state variables, so opening "verify"
 * clears whatever "create" was showing, and the console's own length changes by
 * several hundred pixels depending on which one is open. On a support screen
 * somebody is reading under pressure, the page moving is the problem.
 *
 * A sheet is the right shape here for the same reason it was at Point A: these
 * are deliberate, occasional, multi-field operations with a confirmation step,
 * and while one is open there should be exactly one form on the screen. The
 * console behind it stays still, and Escape backs out of a half-typed
 * passphrase without touching anything.
 *
 * ## Restore is not destructive
 *
 * It merges. Nothing is deleted, so it is not painted red: red would say
 * "this removes data", which is false, and an operator who believes that will
 * not restore a backup when they should. It is a secondary action with a
 * confirmation step, which is what "deliberate" actually looks like.
 */

interface BackupSectionProps {
  readonly state: BackupState
  readonly onState: (state: BackupState) => void
}

export function BackupSection({ state, onState }: BackupSectionProps) {
  const open = state !== 'idle'

  return (
    <section aria-labelledby="backup-heading" className="flex flex-col">
      <SectionHead
        title="Backup &amp; recovery"
        note="Encrypted. The passphrase is never stored."
      />
      <h3 id="backup-heading" className="sr-only">
        Backup and recovery
      </h3>

      <div className="grid gap-x-10 md:grid-cols-2">
        <FactRow label="Last backup generated">
          <span className="font-ui text-small tabular-nums text-muted">
            {CONCEPT_LAST_BACKUP_GENERATED}
          </span>
        </FactRow>
        <FactRow label="Last backup verified">
          <span className="font-ui text-small tabular-nums text-muted">
            {CONCEPT_LAST_BACKUP_VERIFIED}
          </span>
        </FactRow>
      </div>

      {/*
        Three actions, three weights. Creating one is the thing an operator
        should do at the end of every shift; verifying is how they find out a
        backup is real; restoring is rare and needs thinking about.
      */}
      <div className="flex flex-col gap-2.5 border-t border-line pt-4 sm:flex-row sm:flex-wrap">
        <AppButton onClick={() => onState('create')}>
          <DownloadIcon />
          Create encrypted backup
        </AppButton>
        <AppButton variant="secondary" onClick={() => onState('verify')}>
          <FileCheck2Icon />
          Verify backup file
        </AppButton>
        <AppButton variant="secondary" onClick={() => onState('restore-review')}>
          <UploadIcon />
          Restore backup
        </AppButton>
      </div>

      <p className="pt-3 font-body text-small text-faint">
        Restoring merges records into this device. Nothing is deleted.
      </p>

      <Sheet open={open} onOpenChange={(next) => !next && onState('idle')}>
        <SheetContent side="right" className="sm:max-w-xl">
          <BackupWorkflow state={state} onState={onState} />
        </SheetContent>
      </Sheet>
    </section>
  )
}

function BackupWorkflow({ state, onState }: BackupSectionProps) {
  switch (state) {
    case 'create':
      return <CreateWorkflow onState={onState} />
    case 'backup-error':
      return <VerifyWorkflow failed onState={onState} />
    case 'create-success':
      return <CreateSuccess onState={onState} />
    case 'verify':
      return <VerifyWorkflow onState={onState} />
    case 'verify-success':
      return <VerifySuccess onState={onState} />
    case 'restore-review':
      return <RestoreReview onState={onState} />
    case 'restore-complete':
      return <RestoreComplete onState={onState} />
    case 'restore-error':
      return <RestoreError onState={onState} />
    default:
      return null
  }
}

/* ------------------------------------------------------------------------- *
 * Create
 * ------------------------------------------------------------------------- */

function CreateWorkflow({
  onState,
}: {
  readonly onState: (state: BackupState) => void
}) {
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [attempted, setAttempted] = useState(false)

  /*
   * The two rules the real panel enforces, checked here so both error states
   * are reachable by typing rather than staged by the review tool. The concept
   * still encrypts nothing: this decides what the sheet says, not what happens.
   */
  const tooShort = attempted && passphrase.length < CONCEPT_MIN_PASSPHRASE
  const mismatched = attempted && !tooShort && passphrase !== confirmation

  return (
    <>
      <SheetHeader>
        <SheetTitle>Create encrypted backup</SheetTitle>
        <SheetDescription>
          Everything on this device, encrypted into one file you download and
          keep.
        </SheetDescription>
      </SheetHeader>

      {/*
        The warning that matters, stated plainly and not in a footnote. There is
        no recovery path for a lost passphrase, so this is the one thing an
        operator must read before typing.
      */}
      <Alert tone="warn">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>The passphrase is not stored anywhere</AlertTitle>
        <AlertDescription>
          Not by this application, not on this device, and not on the server.
          Without it the backup cannot be opened by anybody, including us. Write
          it down before you continue.
        </AlertDescription>
      </Alert>

      <form
        /* A concept. Nothing is encrypted, written or downloaded. */
        onSubmit={(event) => {
          event.preventDefault()
          setAttempted(true)
          if (
            passphrase.length >= CONCEPT_MIN_PASSPHRASE &&
            passphrase === confirmation
          ) {
            onState('create-success')
          }
        }}
        className="flex flex-col gap-4"
      >
        <FormField
          label="Backup passphrase"
          required
          hint={`At least ${CONCEPT_MIN_PASSPHRASE} characters.`}
          {...(tooShort
            ? { error: `Use a passphrase of at least ${CONCEPT_MIN_PASSPHRASE} characters.` }
            : {})}
        >
          {(field) => (
            <Input
              {...field}
              type="password"
              autoComplete="off"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          )}
        </FormField>

        <FormField
          label="Confirm passphrase"
          required
          {...(mismatched ? { error: 'The two passphrases do not match.' } : {})}
        >
          {(field) => (
            <Input
              {...field}
              type="password"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          )}
        </FormField>

        <WorkflowActions primary="Create encrypted backup" onCancel={() => onState('idle')} />
      </form>
    </>
  )
}

function CreateSuccess({ onState }: { readonly onState: (s: BackupState) => void }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>Backup file generated</SheetTitle>
        {/*
          "Generated", never "stored". The browser cannot tell us whether the
          operator kept the download, renamed it, or sent it to the bin, and a
          screen that claimed otherwise would be manufacturing confidence.
        */}
        <SheetDescription>
          The file has been handed to your browser. Check it reached the place
          you expect before relying on it.
        </SheetDescription>
      </SheetHeader>

      <Alert tone="ok">
        <CheckCircle2Icon aria-hidden="true" />
        <AlertDescription>
          <span className="font-mono text-small break-all select-all">
            {CONCEPT_BACKUP_FILENAME}
          </span>
        </AlertDescription>
      </Alert>

      <SummaryList
        rows={[
          ['Registrations', CONCEPT_BACKUP_SUMMARY.registrations.toLocaleString()],
          ['Feedback', CONCEPT_BACKUP_SUMMARY.feedback.toLocaleString()],
          ['Event', CONCEPT_BACKUP_SUMMARY.eventId],
        ]}
      />

      <p className="font-body text-small text-muted">
        Verify it now if you want evidence that it opens. Verifying imports
        nothing.
      </p>

      <div className="flex flex-wrap gap-2.5 border-t border-line pt-4">
        <AppButton onClick={() => onState('verify')}>
          <FileCheck2Icon />
          Verify this backup
        </AppButton>
        <AppButton variant="ghost" onClick={() => onState('idle')}>
          Done
        </AppButton>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------------- *
 * Verify
 * ------------------------------------------------------------------------- */

function VerifyWorkflow({
  failed = false,
  onState,
}: {
  readonly failed?: boolean
  readonly onState: (s: BackupState) => void
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

      {failed && (
        /*
         * One message for a wrong passphrase and an unreadable file, because
         * the application genuinely cannot tell them apart: both are a
         * decryption that did not produce a valid payload. Guessing which, and
         * being wrong, would send an operator looking for the wrong file.
         */
        <Alert tone="danger">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>That file could not be opened</AlertTitle>
          <AlertDescription>
            {CONCEPT_BACKUP_WRONG_PASSPHRASE} Nothing on this device was
            touched. A file larger than the application ever produces is refused
            before it is read at all.
          </AlertDescription>
        </Alert>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          onState('verify-success')
        }}
        className="flex flex-col gap-4"
      >
        <FileField />
        <FormField label="Backup passphrase" required>
          {(field) => <Input {...field} type="password" autoComplete="off" />}
        </FormField>

        <WorkflowActions primary="Verify backup file" onCancel={() => onState('idle')} />
      </form>
    </>
  )
}

function VerifySuccess({ onState }: { readonly onState: (s: BackupState) => void }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>Backup verified</SheetTitle>
        <SheetDescription>Nothing was imported.</SheetDescription>
      </SheetHeader>

      <Alert tone="ok">
        <CheckCircle2Icon aria-hidden="true" />
        <AlertTitle>This file opens, and this is what is in it</AlertTitle>
        <AlertDescription>
          That is the evidence a backup is real. A file that has never been
          opened is a file nobody knows is recoverable.
        </AlertDescription>
      </Alert>

      <BackupSummaryList />

      <div className="border-t border-line pt-4">
        <AppButton onClick={() => onState('idle')}>Done</AppButton>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------------- *
 * Restore
 * ------------------------------------------------------------------------- */

/**
 * Stage two of the restore, and the reason restore is two stages.
 *
 * The file has been decrypted and read; nothing has been written. The operator
 * sees exactly what is about to be merged, including whether it came from
 * another device, and confirms. Verification succeeding is not consent.
 */
function RestoreReview({ onState }: { readonly onState: (s: BackupState) => void }) {
  /*
   * The fixture backup deliberately comes from a different device, because that
   * is the branch worth reviewing. Compared as strings so the intent survives
   * if the fixtures ever change; TypeScript narrows literal fixtures to
   * never-equal, which is why the widening is explicit.
   */
  const fromAnotherDevice =
    (CONCEPT_BACKUP_SUMMARY.sourceDeviceId as string) !==
    (CONCEPT_DEVICE.deviceId as string)

  return (
    <>
      <SheetHeader>
        <SheetTitle>Restore backup</SheetTitle>
        <SheetDescription>
          This file opened. Nothing has been written yet.
        </SheetDescription>
      </SheetHeader>

      <BackupSummaryList />

      <Alert tone="info">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>This merges records</AlertTitle>
        <AlertDescription>
          Records already on this device are not deleted or replaced by older
          copies. Anything the backup has and this device does not is added.
        </AlertDescription>
      </Alert>

      {fromAnotherDevice && (
        <Alert tone="neutral">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription>
            This backup came from another device. This device keeps its own
            identity, so records captured here stay attributed to it.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2.5 border-t border-line pt-4">
        <AppButton onClick={() => onState('restore-complete')}>
          <UploadIcon />
          Restore backup
        </AppButton>
        <AppButton variant="ghost" onClick={() => onState('idle')}>
          Cancel
        </AppButton>
      </div>
    </>
  )
}

function RestoreComplete({ onState }: { readonly onState: (s: BackupState) => void }) {
  const c = CONCEPT_RESTORE_COUNTS

  return (
    <>
      <SheetHeader>
        <SheetTitle>Restore complete</SheetTitle>
        <SheetDescription>
          The counts on the console behind this have been refreshed.
        </SheetDescription>
      </SheetHeader>

      {/*
        Seven figures, as a list rather than seven stat cards. "Unchanged" is
        usually the largest of them and is the least interesting: what an
        operator wants is how much arrived.
      */}
      <div className="flex flex-col">
        <ResultGroup
          title="Registrations"
          added={c.registrationsAdded}
          updated={c.registrationsUpdated}
          unchanged={c.registrationsUnchanged}
        />
        <ResultGroup
          title="Feedback"
          added={c.feedbackAdded}
          updated={c.feedbackUpdated}
          unchanged={c.feedbackUnchanged}
        />
        <FactRow label="Sequences merged">
          <span className="font-ui tabular-nums">{c.sequencesMerged}</span>
        </FactRow>
      </div>

      <div className="border-t border-line pt-4">
        <AppButton onClick={() => onState('idle')}>Done</AppButton>
      </div>
    </>
  )
}

function RestoreError({ onState }: { readonly onState: (s: BackupState) => void }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>Restore stopped</SheetTitle>
        <SheetDescription>Nothing was imported.</SheetDescription>
      </SheetHeader>

      <Alert tone="danger">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle className="font-display text-title tracking-wide">
          Restore stopped
        </AlertTitle>
        {/*
          The guarantee, stated in the failure itself. An operator who is not
          told this will assume a half-finished restore left the device in an
          unknown state, and the next thing they do is something worse.
        */}
        <AlertDescription>{CONCEPT_RESTORE_STOPPED}</AlertDescription>
      </Alert>

      <div className="flex flex-col gap-2">
        <p className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-muted">
          What stopped it
        </p>
        <ul className="flex flex-col gap-1">
          {[
            'Registration A1-B8EFD9-00114-M: sequence 114 is already used by a different participant on this device.',
            'Registration A1-B8EFD9-00115-R: sequence 115 is already used by a different participant on this device.',
          ].map((issue) => (
            <li
              key={issue}
              className="border-t border-line py-2 font-body text-small text-muted"
            >
              {issue}
            </li>
          ))}
        </ul>
        <p className="font-body text-small text-faint">
          Send these lines to support. They name records, never people.
        </p>
      </div>

      <div className="flex flex-wrap gap-2.5 border-t border-line pt-4">
        <AppButton variant="secondary" onClick={() => onState('restore-review')}>
          Back
        </AppButton>
        <AppButton variant="ghost" onClick={() => onState('idle')}>
          Close
        </AppButton>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------------- *
 * Shared pieces
 * ------------------------------------------------------------------------- */

function FileField() {
  return (
    <FormField label="Backup file" required hint="A .oefbackup file.">
      {(field) => (
        <input
          {...field}
          type="file"
          accept=".oefbackup,application/octet-stream"
          className={cn(
            'flex min-h-touch w-full items-center rounded-control border border-line bg-field px-3.5 py-2',
            'font-ui text-base text-ink',
            'file:mr-3 file:rounded-chip file:border file:border-line file:bg-surface',
            'file:px-3 file:py-1.5 file:font-ui file:text-small file:text-ink',
            'hover:border-line-strong',
            'focus-visible:border-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive/40',
          )}
        />
      )}
    </FormField>
  )
}

function WorkflowActions({
  primary,
  onCancel,
}: {
  readonly primary: string
  readonly onCancel: () => void
}) {
  return (
    <div className="flex flex-wrap gap-2.5 border-t border-line pt-4">
      <AppButton type="submit">{primary}</AppButton>
      <AppButton type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </AppButton>
    </div>
  )
}

function BackupSummaryList() {
  const s = CONCEPT_BACKUP_SUMMARY

  return (
    <SummaryList
      rows={[
        ['Created', s.createdAt],
        ['Event', s.eventId],
        ['Source device', s.sourceDeviceId],
        ['Registrations', s.registrations.toLocaleString()],
        ['Feedback', s.feedback.toLocaleString()],
        ['Schema', `v${s.schemaVersion}`],
      ]}
    />
  )
}

function SummaryList({
  rows,
}: {
  readonly rows: readonly (readonly [string, string])[]
}) {
  return (
    <div className="flex flex-col">
      {rows.map(([label, value]) => (
        <FactRow key={label} label={label}>
          <span className="font-mono text-small break-all select-all text-ink">
            {value}
          </span>
        </FactRow>
      ))}
    </div>
  )
}

function ResultGroup({
  title,
  added,
  updated,
  unchanged,
}: {
  readonly title: string
  readonly added: number
  readonly updated: number
  readonly unchanged: number
}): ReactNode {
  return (
    <div className="flex flex-col">
      <p className="border-t border-line pt-4 pb-1 font-ui text-label font-semibold uppercase tracking-[0.16em] text-muted">
        {title}
      </p>
      <FactRow label="Added">
        <span className="font-ui text-stat-small font-semibold tabular-nums text-ok">
          {added.toLocaleString()}
        </span>
      </FactRow>
      <FactRow label="Updated">
        <span className="font-ui tabular-nums">{updated.toLocaleString()}</span>
      </FactRow>
      <FactRow label="Already here">
        <span className="font-ui tabular-nums text-muted">
          {unchanged.toLocaleString()}
        </span>
      </FactRow>
    </div>
  )
}
