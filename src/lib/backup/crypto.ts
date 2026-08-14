import { base64ToBytes, bytesToBase64 } from './base64'

/*
 * Backup encryption.
 *
 * Web Crypto only. Nothing here is invented: PBKDF2-SHA-256 to turn an operator
 * passphrase into a key, then AES-GCM, which authenticates as well as encrypts.
 * That second property is what makes a tampered or truncated backup fail loudly
 * instead of decrypting into plausible nonsense.
 *
 * The passphrase is never persisted, not in IndexedDB, not in localStorage,
 * not in a URL, not in a log. There is no recovery mechanism and no pretence of
 * one: lose the passphrase and the backup is gone.
 */

/** Production KDF cost. Pinned by tests so it cannot drift downwards quietly. */
export const KDF_ITERATIONS = 600_000
export const KDF_HASH = 'SHA-256'
export const KDF_ALGORITHM = 'PBKDF2'
export const CIPHER_ALGORITHM = 'AES-GCM'

export const SALT_BYTES = 16
export const IV_BYTES = 12
const KEY_BITS = 256

/**
 * Bounds on the iteration count read out of an untrusted file.
 *
 * A backup declares its own KDF cost, which it must; otherwise an older file
 * could never be opened. But an attacker-supplied file claiming a billion
 * iterations would hang the browser on a single click, so the declared value is
 * clamped to a sane range before any work is done with it.
 */
export const MIN_ACCEPTED_ITERATIONS = 1_000
export const MAX_ACCEPTED_ITERATIONS = 2_000_000

export interface KdfParameters {
  readonly iterations: number
  readonly salt: Uint8Array<ArrayBuffer>
}

export interface EncryptedPayload {
  readonly salt: string
  readonly iv: string
  readonly ciphertext: string
  readonly iterations: number
}

function assertSecureRandomAvailable(): void {
  if (
    typeof crypto === 'undefined' ||
    typeof crypto.getRandomValues !== 'function' ||
    crypto.subtle === undefined
  ) {
    throw new Error(
      'This browser cannot create encrypted backups. Use an up-to-date browser over a secure (https) address.',
    )
  }
}

/** Cryptographically secure random bytes. Never `Math.random()`. */
export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  assertSecureRandomAvailable()
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)))
}

async function deriveKey(
  passphrase: string,
  parameters: KdfParameters,
): Promise<CryptoKey> {
  assertSecureRandomAvailable()

  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    KDF_ALGORITHM,
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: KDF_ALGORITHM,
      salt: parameters.salt,
      iterations: parameters.iterations,
      hash: KDF_HASH,
    },
    material,
    { name: CIPHER_ALGORITHM, length: KEY_BITS },
    // Not extractable: the derived key cannot be read back out of the browser.
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Encrypts UTF-8 plaintext under a passphrase.
 *
 * A fresh salt and IV are generated every time, so encrypting the same snapshot
 * twice produces two different files. That is a property, not a defect: reusing
 * an AES-GCM IV under one key is catastrophic, and deterministic output would
 * also leak whether two backups hold identical data.
 */
export async function encryptText(
  plaintext: string,
  passphrase: string,
  iterations: number = KDF_ITERATIONS,
): Promise<EncryptedPayload> {
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = await deriveKey(passphrase, { salt, iterations })

  const ciphertext = await crypto.subtle.encrypt(
    { name: CIPHER_ALGORITHM, iv },
    key,
    new TextEncoder().encode(plaintext),
  )

  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iterations,
  }
}

export type DecryptFailure =
  | 'malformed-encoding'
  | 'unsupported-parameters'
  | 'authentication-failed'

export type DecryptResult =
  | { readonly ok: true; readonly plaintext: string }
  | { readonly ok: false; readonly reason: DecryptFailure }

/**
 * Decrypts and authenticates.
 *
 * Every failure (wrong passphrase, flipped byte, altered IV, truncated file)
 * arrives here as the same AES-GCM authentication error, and is reported as one
 * outcome. There is deliberately no way to learn *which* of those went wrong,
 * and no partially decoded data is ever returned.
 */
export async function decryptText(
  payload: EncryptedPayload,
  passphrase: string,
): Promise<DecryptResult> {
  const salt = base64ToBytes(payload.salt)
  const iv = base64ToBytes(payload.iv)
  const ciphertext = base64ToBytes(payload.ciphertext)

  if (salt === null || iv === null || ciphertext === null) {
    return { ok: false, reason: 'malformed-encoding' }
  }

  if (
    salt.length !== SALT_BYTES ||
    iv.length !== IV_BYTES ||
    ciphertext.length === 0 ||
    !Number.isInteger(payload.iterations) ||
    payload.iterations < MIN_ACCEPTED_ITERATIONS ||
    payload.iterations > MAX_ACCEPTED_ITERATIONS
  ) {
    return { ok: false, reason: 'unsupported-parameters' }
  }

  try {
    const key = await deriveKey(passphrase, {
      salt,
      iterations: payload.iterations,
    })
    const plaintext = await crypto.subtle.decrypt(
      { name: CIPHER_ALGORITHM, iv },
      key,
      ciphertext,
    )

    return { ok: true, plaintext: new TextDecoder().decode(plaintext) }
  } catch {
    // Never surfaced verbatim: a crypto stack trace tells an operator nothing
    // and tells an attacker something.
    return { ok: false, reason: 'authentication-failed' }
  }
}
