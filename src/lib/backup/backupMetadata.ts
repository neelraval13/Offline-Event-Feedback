import type { OfflineEventDb } from '../storage'

/*
 * Backup bookkeeping for this installation.
 *
 * Stored in `deviceConfig`, which restore deliberately never imports — so
 * these dates always describe the device in front of the operator, and a
 * restored backup can never make a fresh machine claim it was backed up last
 * Tuesday.
 */

export const LAST_BACKUP_GENERATED_KEY = 'lastBackupGeneratedAt'
export const LAST_BACKUP_VERIFIED_KEY = 'lastBackupVerifiedAt'
export const LAST_RESTORE_KEY = 'lastRestoreAt'

export interface BackupMetadata {
  /** When a backup file was last produced. Not proof it was kept. */
  readonly lastBackupGeneratedAt: string | null
  /**
   * When a backup file was last selected and successfully decrypted.
   *
   * Much stronger evidence than generating one: the operator had the file, and
   * it opened.
   */
  readonly lastBackupVerifiedAt: string | null
  readonly lastRestoreAt: string | null
}

export async function readBackupMetadata(
  database: OfflineEventDb,
): Promise<BackupMetadata> {
  const [generated, verified, restored] = await Promise.all([
    database.deviceConfig.get(LAST_BACKUP_GENERATED_KEY),
    database.deviceConfig.get(LAST_BACKUP_VERIFIED_KEY),
    database.deviceConfig.get(LAST_RESTORE_KEY),
  ])

  return {
    lastBackupGeneratedAt: generated?.value ?? null,
    lastBackupVerifiedAt: verified?.value ?? null,
    lastRestoreAt: restored?.value ?? null,
  }
}

export async function recordBackupEvent(
  database: OfflineEventDb,
  key: string,
  at: Date = new Date(),
): Promise<void> {
  const timestamp = at.toISOString()
  await database.deviceConfig.put({
    key,
    value: timestamp,
    updatedAt: timestamp,
  })
}
