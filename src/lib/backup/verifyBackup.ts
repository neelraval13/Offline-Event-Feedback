import { decryptText } from './crypto'
import {
  MAX_BACKUP_FILE_BYTES,
  summarise,
  type BackupPayloadV1,
  type BackupSummary,
} from './format'
import { validateEnvelope, validatePayload } from './validate'

/*
 * Verifying a backup file without importing anything.
 *
 * The point of this path is that an operator can establish a file is genuinely
 * recoverable *before* trusting it — and before a real recovery, when the
 * original device may no longer exist. Verification reads, decrypts, checks and
 * reports. It writes nothing to the database.
 */

/** One message for every unlock failure. See below for why. */
export const UNLOCK_FAILURE_MESSAGE =
  'This backup could not be unlocked or verified. Check the passphrase and make sure the file has not been damaged.'

export type VerifyBackupResult =
  | {
      readonly ok: true
      readonly summary: BackupSummary
      /** Kept for the restore step so the file is decrypted exactly once. */
      readonly payload: BackupPayloadV1
    }
  | {
      readonly ok: false
      readonly message: string
      readonly issues?: readonly string[]
    }

function tooLarge(byteLength: number): boolean {
  return byteLength > MAX_BACKUP_FILE_BYTES
}

/**
 * Verifies a backup file.
 *
 * Wrong passphrase, a flipped byte, an altered IV and a truncated file all
 * surface as one message. That is deliberate: AES-GCM cannot distinguish them,
 * saying which would help an attacker more than an operator, and the operator's
 * next action — check the passphrase, check the file — is the same in every
 * case.
 */
export async function verifyBackupFile(
  contents: string,
  passphrase: string,
): Promise<VerifyBackupResult> {
  /*
   * Size is checked before parsing. A restore file is untrusted input, and
   * `JSON.parse` on an arbitrarily large string is a way to take the tab down
   * before any of the careful validation below ever runs.
   */
  if (tooLarge(new Blob([contents]).size)) {
    return {
      ok: false,
      message: `This file is too large to be a backup from this application (limit ${Math.round(
        MAX_BACKUP_FILE_BYTES / (1024 * 1024),
      )} MB).`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return { ok: false, message: 'The backup file is damaged.' }
  }

  const envelope = validateEnvelope(parsed)
  if (!envelope.ok) {
    return { ok: false, message: envelope.issues[0] ?? UNLOCK_FAILURE_MESSAGE }
  }

  const decrypted = await decryptText(
    {
      salt: envelope.value.kdf.salt,
      iv: envelope.value.cipher.iv,
      ciphertext: envelope.value.ciphertext,
      iterations: envelope.value.kdf.iterations,
    },
    passphrase,
  )

  if (!decrypted.ok) {
    return { ok: false, message: UNLOCK_FAILURE_MESSAGE }
  }

  let payload: unknown
  try {
    payload = JSON.parse(decrypted.plaintext)
  } catch {
    // Authenticated but unreadable: the file decrypted, so it was made with
    // this passphrase, but its contents are not a backup this build understands.
    return { ok: false, message: 'The backup contents are not readable.' }
  }

  const validated = validatePayload(payload)
  if (!validated.ok) {
    return {
      ok: false,
      message: 'This backup did not pass validation and was not imported.',
      issues: validated.issues,
    }
  }

  return {
    ok: true,
    summary: summarise(validated.value),
    payload: validated.value,
  }
}
