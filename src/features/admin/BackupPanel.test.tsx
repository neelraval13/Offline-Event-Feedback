import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminScreen } from './AdminScreen'
import { setOfflineShell } from '../../lib/pwa/shellInstance'
import { db, getOrCreateDeviceId, peekDeviceId } from '../../lib/storage'
import { createEncryptedBackup } from '../../lib/backup'
import {
  DESTINATION_DEVICE,
  makeFeedback,
  makeRegistration,
  SOURCE_DEVICE,
} from '../../lib/backup/testFixtures'

/*
 * Admin's backup and recovery surface.
 *
 * Real crypto at production cost runs here, but only a handful of times — the
 * flows are what is under test, not the KDF.
 */

const PASSPHRASE = 'a passphrase of sufficient length'

let downloads: { fileName: string; contents: string }[] = []

beforeEach(async () => {
  await db.open()
  await Promise.all([
    db.registrations.clear(),
    db.feedback.clear(),
    db.sequences.clear(),
    db.deviceConfig.clear(),
  ])
  downloads = []
  setOfflineShell(null)

  // jsdom implements neither object URLs nor navigation, so the download
  // boundary is captured instead of performed.
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ fileName: this.download, contents: '' })
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function seed(registrations = 3) {
  const records = Array.from({ length: registrations }, (_, i) =>
    makeRegistration(i + 1),
  )
  await db.registrations.bulkAdd(records)
  await db.feedback.bulkAdd(records.map((record) => makeFeedback(record)))
  // A real device always has an identity before it can capture anything; a
  // backup records that provenance rather than creating it.
  await db.deviceConfig.put({
    key: 'deviceId',
    value: SOURCE_DEVICE,
    updatedAt: '2026-01-01T08:00:00.000Z',
  })
  return records
}

/** A backup file as an operator would have on disk. */
async function backupFile(passphrase = PASSPHRASE): Promise<File> {
  const result = await createEncryptedBackup(db, passphrase, { iterations: 1_000 })
  if (!result.ok) {
    throw new Error('fixture backup failed')
  }
  return new File([result.contents], result.fileName, {
    type: 'application/octet-stream',
  })
}

describe('local data counts', () => {
  it('shows totals and pending counts', async () => {
    await seed(4)
    render(<AdminScreen />)

    await waitFor(async () => {
      expect(screen.getByTestId('count-registrations').textContent).toBe('4')
    })
    expect(screen.getByTestId('count-feedback').textContent).toBe('4')
    expect(screen.getByTestId('count-registrations-pending').textContent).toBe('4')
    expect(screen.getByTestId('count-feedback-pending').textContent).toBe('4')
  })

  it('shows no participant details', async () => {
    await seed(2)
    const { container } = render(<AdminScreen />)
    await waitFor(() =>
      expect(screen.getByTestId('count-registrations').textContent).toBe('2'),
    )

    for (const secret of ['Ada', 'Lovelace', '7946', 'example.com']) {
      expect(container.textContent).not.toContain(secret)
    }
  })
})

describe('creating a backup', () => {
  it('requires a long enough passphrase', async () => {
    await seed(1)
    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', { name: 'Create encrypted backup' }),
    )
    await user.type(screen.getByLabelText('Backup passphrase'), 'short')
    await user.type(screen.getByLabelText('Confirm passphrase'), 'short')
    await user.click(
      screen.getAllByRole('button', { name: 'Create encrypted backup' })[1] as HTMLElement,
    )

    expect((await screen.findByTestId('backup-message')).textContent).toContain(
      'at least 12 characters',
    )
    expect(downloads).toHaveLength(0)
  })

  it('requires the confirmation to match', async () => {
    await seed(1)
    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', { name: 'Create encrypted backup' }),
    )
    await user.type(screen.getByLabelText('Backup passphrase'), PASSPHRASE)
    await user.type(screen.getByLabelText('Confirm passphrase'), 'something else')
    await user.click(
      screen.getAllByRole('button', { name: 'Create encrypted backup' })[1] as HTMLElement,
    )

    expect((await screen.findByTestId('backup-message')).textContent).toContain(
      'do not match',
    )
    expect(downloads).toHaveLength(0)
  })

  it('generates a file and records the time', async () => {
    await seed(2)
    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', { name: 'Create encrypted backup' }),
    )
    await user.type(screen.getByLabelText('Backup passphrase'), PASSPHRASE)
    await user.type(screen.getByLabelText('Confirm passphrase'), PASSPHRASE)
    await user.click(
      screen.getAllByRole('button', { name: 'Create encrypted backup' })[1] as HTMLElement,
    )

    await waitFor(() =>
      expect(screen.getByTestId('backup-message').textContent).toContain(
        'Backup file generated',
      ),
    )
    expect(downloads[0]?.fileName).toMatch(/\.oefbackup$/)
    await waitFor(() =>
      expect(screen.getByTestId('last-backup-generated').textContent).not.toBe(
        'Never',
      ),
    )
  })

  it('says generated, never stored', async () => {
    // The browser cannot tell us whether the operator kept the file.
    await seed(1)
    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', { name: 'Create encrypted backup' }),
    )
    await user.type(screen.getByLabelText('Backup passphrase'), PASSPHRASE)
    await user.type(screen.getByLabelText('Confirm passphrase'), PASSPHRASE)
    await user.click(
      screen.getAllByRole('button', { name: 'Create encrypted backup' })[1] as HTMLElement,
    )

    const message = await screen.findByTestId('backup-message')
    await waitFor(() => expect(message.textContent).toContain('generated'))
    expect(message.textContent).not.toContain('safely stored')
    expect(message.textContent).not.toContain('backed up safely')
  })

  it('clears the passphrase fields afterwards', async () => {
    await seed(1)
    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', { name: 'Create encrypted backup' }),
    )
    await user.type(screen.getByLabelText('Backup passphrase'), PASSPHRASE)
    await user.type(screen.getByLabelText('Confirm passphrase'), PASSPHRASE)
    await user.click(
      screen.getAllByRole('button', { name: 'Create encrypted backup' })[1] as HTMLElement,
    )

    await waitFor(() =>
      expect(screen.getByTestId('backup-message').textContent).toContain(
        'generated',
      ),
    )
    expect(screen.getByLabelText('Backup passphrase')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Confirm passphrase')).toHaveProperty('value', '')
  })

  it('warns that the passphrase cannot be recovered', async () => {
    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', { name: 'Create encrypted backup' }),
    )

    expect(
      screen.getByText(/not stored by the application/),
    ).toBeDefined()
  })
})

describe('verifying a backup', () => {
  it('reports the contents without importing anything', async () => {
    await seed(3)
    const file = await backupFile()
    await db.registrations.clear()
    await db.feedback.clear()

    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Verify backup file' }))
    await user.upload(screen.getByLabelText('Backup file'), file)
    await user.type(screen.getByLabelText('Backup passphrase'), PASSPHRASE)
    await user.click(
      screen.getAllByRole('button', { name: 'Verify backup file' })[1] as HTMLElement,
    )

    const summary = await screen.findByTestId('backup-summary')
    expect(within(summary).getByTestId('summary-registrations').textContent).toBe('3')
    expect(within(summary).getByTestId('summary-feedback').textContent).toBe('3')
    // Verification is read-only.
    expect(await db.registrations.count()).toBe(0)
  })

  it('records the verification time, which is real evidence', async () => {
    await seed(1)
    const file = await backupFile()

    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Verify backup file' }))
    await user.upload(screen.getByLabelText('Backup file'), file)
    await user.type(screen.getByLabelText('Backup passphrase'), PASSPHRASE)
    await user.click(
      screen.getAllByRole('button', { name: 'Verify backup file' })[1] as HTMLElement,
    )

    await waitFor(() =>
      expect(screen.getByTestId('last-backup-verified').textContent).not.toBe(
        'Never',
      ),
    )
  })

  it('refuses the wrong passphrase with one safe message', async () => {
    await seed(1)
    const file = await backupFile()

    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Verify backup file' }))
    await user.upload(screen.getByLabelText('Backup file'), file)
    await user.type(screen.getByLabelText('Backup passphrase'), 'wrong passphrase!!')
    await user.click(
      screen.getAllByRole('button', { name: 'Verify backup file' })[1] as HTMLElement,
    )

    const message = await screen.findByTestId('backup-message')
    expect(message.textContent).toContain('could not be unlocked')
    // No cryptographic detail reaches the operator.
    expect(message.textContent).not.toMatch(/AES|GCM|PBKDF2|OperationError/i)
    expect(screen.getByTestId('last-backup-verified').textContent).toBe('Never')
  })

  it('refuses a tampered file', async () => {
    await seed(1)
    const original = await backupFile()
    const text = await original.text()
    const tampered = new File(
      [text.replace(/"ciphertext":"./, '"ciphertext":"A')],
      'tampered.oefbackup',
    )

    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Verify backup file' }))
    await user.upload(screen.getByLabelText('Backup file'), tampered)
    await user.type(screen.getByLabelText('Backup passphrase'), PASSPHRASE)
    await user.click(
      screen.getAllByRole('button', { name: 'Verify backup file' })[1] as HTMLElement,
    )

    expect((await screen.findByTestId('backup-message')).textContent).toContain(
      'could not be unlocked',
    )
  })
})

describe('restoring a backup', () => {
  it('previews before writing anything, then merges', async () => {
    const records = await seed(3)
    const file = await backupFile()
    await db.registrations.clear()
    await db.feedback.clear()

    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Restore backup' }))
    await user.upload(screen.getByLabelText('Backup file'), file)
    await user.type(screen.getByLabelText('Backup passphrase'), PASSPHRASE)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // Preview: nothing written yet.
    const summary = await screen.findByTestId('backup-summary')
    expect(within(summary).getByText(/merge/)).toBeDefined()
    expect(await db.registrations.count()).toBe(0)

    await user.click(
      within(summary).getByRole('button', { name: 'Restore backup' }),
    )

    const result = await screen.findByTestId('restore-result')
    expect(
      within(result).getByTestId('restored-registrations-added').textContent,
    ).toBe('3')
    expect(await db.registrations.count()).toBe(3)
    expect(
      (await db.registrations.get(records[0]?.recordId ?? ''))?.publicCode,
    ).toBe(records[0]?.publicCode)
  })

  it('can be cancelled without writing', async () => {
    await seed(2)
    const file = await backupFile()
    await db.registrations.clear()

    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Restore backup' }))
    await user.upload(screen.getByLabelText('Backup file'), file)
    await user.type(screen.getByLabelText('Backup passphrase'), PASSPHRASE)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const summary = await screen.findByTestId('backup-summary')
    await user.click(within(summary).getByRole('button', { name: 'Cancel' }))

    expect(await db.registrations.count()).toBe(0)
  })

  it('warns when the backup came from another device', async () => {
    await seed(1)
    const file = await backupFile()
    // The replacement installation has its own identity.
    await db.deviceConfig.put({
      key: 'deviceId',
      value: DESTINATION_DEVICE,
      updatedAt: '2026-02-01T08:00:00.000Z',
    })
    const destinationDeviceId = await getOrCreateDeviceId(db)

    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Restore backup' }))
    await user.upload(screen.getByLabelText('Backup file'), file)
    await user.type(screen.getByLabelText('Backup passphrase'), PASSPHRASE)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      (await screen.findByTestId('different-device-notice')).textContent,
    ).toContain('keep its current device identity')

    await user.click(
      within(screen.getByTestId('backup-summary')).getByRole('button', {
        name: 'Restore backup',
      }),
    )
    await screen.findByTestId('restore-result')

    // And it does.
    expect(await peekDeviceId(db)).toBe(destinationDeviceId)
  })

  it('refreshes the counts afterwards', async () => {
    await seed(3)
    const file = await backupFile()
    await db.registrations.clear()
    await db.feedback.clear()

    render(<AdminScreen />)
    const user = userEvent.setup()
    await waitFor(() =>
      expect(screen.getByTestId('count-registrations').textContent).toBe('0'),
    )

    await user.click(await screen.findByRole('button', { name: 'Restore backup' }))
    await user.upload(screen.getByLabelText('Backup file'), file)
    await user.type(screen.getByLabelText('Backup passphrase'), PASSPHRASE)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      within(await screen.findByTestId('backup-summary')).getByRole('button', {
        name: 'Restore backup',
      }),
    )
    await screen.findByTestId('restore-result')

    await waitFor(() =>
      expect(screen.getByTestId('count-registrations').textContent).toBe('3'),
    )
  })

  it('reports a conflict without importing anything', async () => {
    const records = await seed(2)
    const file = await backupFile()

    // Make the local copy disagree at the same revision: a hard conflict.
    const first = records[0]
    if (first !== undefined) {
      await db.registrations.put({ ...first, email: 'different@example.com' })
    }

    render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Restore backup' }))
    await user.upload(screen.getByLabelText('Backup file'), file)
    await user.type(screen.getByLabelText('Backup passphrase'), PASSPHRASE)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      within(await screen.findByTestId('backup-summary')).getByRole('button', {
        name: 'Restore backup',
      }),
    )

    const message = await screen.findByTestId('backup-message')
    expect(message.textContent).toContain('nothing was imported')
    // The local record is untouched.
    expect((await db.registrations.get(first?.recordId ?? ''))?.email).toBe(
      'different@example.com',
    )
  })

  it('never shows participant details in a conflict report', async () => {
    const records = await seed(1)
    const file = await backupFile()
    const first = records[0]
    if (first !== undefined) {
      await db.registrations.put({ ...first, email: 'different@example.com' })
    }

    const { container } = render(<AdminScreen />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Restore backup' }))
    await user.upload(screen.getByLabelText('Backup file'), file)
    await user.type(screen.getByLabelText('Backup passphrase'), PASSPHRASE)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      within(await screen.findByTestId('backup-summary')).getByRole('button', {
        name: 'Restore backup',
      }),
    )
    await screen.findByTestId('backup-issues')

    for (const secret of ['Ada', 'Lovelace', 'different@example.com', '7946']) {
      expect(container.textContent).not.toContain(secret)
    }
  })
})
