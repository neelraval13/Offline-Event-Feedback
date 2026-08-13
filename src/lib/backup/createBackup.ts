import type { OfflineEventDb } from '../storage'
import { encryptText, KDF_HASH, KDF_ALGORITHM, CIPHER_ALGORITHM } from './crypto'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  backupFileName,
  summarise,
  type BackupEnvelopeV1,
  type BackupSummary,
} from './format'
import { createSnapshot, validateSnapshot } from './snapshot'

/*
 * Creating an encrypted backup.
 *
 *   snapshot (one transaction)
 *     -> validate, before anything is encrypted
 *     -> serialise
 *     -> encrypt
 *     -> envelope
 *     -> file
 *
 * Read-only with respect to operational data. Taking a backup never writes a
 * record, never provisions identity and never touches a sequence counter.
 */

export type CreateBackupResult =
  | {
      readonly ok: true
      readonly fileName: string
      readonly contents: string
      readonly summary: BackupSummary
    }
  | {
      readonly ok: false
      readonly message: string
      readonly issues?: readonly string[]
    }

export interface CreateBackupOptions {
  /** Lower cost for tests only. Production always uses the pinned default. */
  readonly iterations?: number
}

export async function createEncryptedBackup(
  database: OfflineEventDb,
  passphrase: string,
  options: CreateBackupOptions = {},
): Promise<CreateBackupResult> {
  const payload = await createSnapshot(database)

  const validation = validateSnapshot(payload)
  if (!validation.ok) {
    /*
     * A backup of data that fails its own validation is worse than no backup:
     * it cannot be restored, and it makes the operator believe the device is
     * protected. The issues are structural — field names and indices — so
     * nothing about a participant is exposed by showing them.
     */
    return {
      ok: false,
      message:
        'Backup could not be created because local data failed validation.',
      issues: validation.issues,
    }
  }

  let encrypted
  try {
    encrypted = await encryptText(
      JSON.stringify(payload),
      passphrase,
      options.iterations,
    )
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'The backup could not be encrypted on this device.',
    }
  }

  const envelope: BackupEnvelopeV1 = {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    kdf: {
      algorithm: KDF_ALGORITHM,
      hash: KDF_HASH,
      iterations: encrypted.iterations,
      salt: encrypted.salt,
    },
    cipher: { algorithm: CIPHER_ALGORITHM, iv: encrypted.iv },
    ciphertext: encrypted.ciphertext,
  }

  return {
    ok: true,
    fileName: backupFileName(new Date(payload.createdAt)),
    contents: JSON.stringify(envelope),
    summary: summarise(payload),
  }
}
