import { describe, expect, it } from 'vitest'
import {
  CIPHER_ALGORITHM,
  decryptText,
  encryptText,
  IV_BYTES,
  KDF_ALGORITHM,
  KDF_HASH,
  KDF_ITERATIONS,
  MAX_ACCEPTED_ITERATIONS,
  randomBytes,
  SALT_BYTES,
} from './crypto'
import { base64ToBytes, bytesToBase64 } from './base64'

/*
 * Cryptographic primitives.
 *
 * These tests run real PBKDF2, so they are deliberately few. Everything about
 * backup structure and merge behaviour is tested elsewhere without crypto —
 * a suite that derived a 600,000-iteration key hundreds of times would take
 * minutes and teach nothing extra.
 *
 * A low iteration count is used where the test is about behaviour rather than
 * cost; the production configuration is pinned separately.
 */

const FAST = 1_000
const PASSPHRASE = 'correct horse battery staple'

describe('production configuration', () => {
  it('is pinned, so it cannot drift downwards unnoticed', () => {
    expect(KDF_ITERATIONS).toBe(600_000)
    expect(KDF_ALGORITHM).toBe('PBKDF2')
    expect(KDF_HASH).toBe('SHA-256')
    expect(CIPHER_ALGORITHM).toBe('AES-GCM')
    expect(SALT_BYTES).toBe(16)
    expect(IV_BYTES).toBe(12)
  })

  it('round-trips at the real production cost', async () => {
    // One full-cost round trip, to prove the shipped configuration works.
    const encrypted = await encryptText('production settings', PASSPHRASE)

    expect(encrypted.iterations).toBe(KDF_ITERATIONS)
    const decrypted = await decryptText(encrypted, PASSPHRASE)
    expect(decrypted.ok && decrypted.plaintext).toBe('production settings')
  })
})

describe('round trip', () => {
  it('recovers the exact plaintext', async () => {
    const plaintext = JSON.stringify({ records: [1, 2, 3], text: 'ünïcodé ✓' })
    const encrypted = await encryptText(plaintext, PASSPHRASE, FAST)

    const decrypted = await decryptText(encrypted, PASSPHRASE)
    expect(decrypted.ok && decrypted.plaintext).toBe(plaintext)
  })

  it('handles a payload of realistic size', async () => {
    const plaintext = JSON.stringify(
      Array.from({ length: 5_000 }, (_, i) => ({ i, text: 'record'.repeat(10) })),
    )

    const encrypted = await encryptText(plaintext, PASSPHRASE, FAST)
    const decrypted = await decryptText(encrypted, PASSPHRASE)

    expect(decrypted.ok && decrypted.plaintext).toBe(plaintext)
  })

  it('produces a different file every time from the same input', async () => {
    // Fresh salt and IV per run. Reusing an AES-GCM IV under one key is
    // catastrophic, and identical output would also reveal that two backups
    // hold identical data.
    const first = await encryptText('same', PASSPHRASE, FAST)
    const second = await encryptText('same', PASSPHRASE, FAST)

    expect(first.salt).not.toBe(second.salt)
    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)

    // Both still decrypt.
    expect((await decryptText(first, PASSPHRASE)).ok).toBe(true)
    expect((await decryptText(second, PASSPHRASE)).ok).toBe(true)
  })

  it('never leaks the plaintext into the encrypted output', async () => {
    const encrypted = await encryptText(
      'Ada Lovelace ada@example.com',
      PASSPHRASE,
      FAST,
    )

    const serialised = JSON.stringify(encrypted)
    expect(serialised).not.toContain('Ada')
    expect(serialised).not.toContain('example.com')
    expect(serialised).not.toContain(PASSPHRASE)
  })
})

describe('failures are safe and indistinguishable', () => {
  it('rejects the wrong passphrase', async () => {
    const encrypted = await encryptText('secret', PASSPHRASE, FAST)

    const decrypted = await decryptText(encrypted, 'not the passphrase')

    expect(decrypted.ok).toBe(false)
    expect(!decrypted.ok && decrypted.reason).toBe('authentication-failed')
  })

  it('rejects tampered ciphertext', async () => {
    const encrypted = await encryptText('secret', PASSPHRASE, FAST)
    const bytes = base64ToBytes(encrypted.ciphertext)
    if (bytes === null) {
      throw new Error('fixture failed to decode')
    }
    bytes[0] = bytes[0] === undefined ? 0 : bytes[0] ^ 0xff

    const decrypted = await decryptText(
      { ...encrypted, ciphertext: bytesToBase64(bytes) },
      PASSPHRASE,
    )

    expect(decrypted.ok).toBe(false)
  })

  it('rejects a tampered IV', async () => {
    const encrypted = await encryptText('secret', PASSPHRASE, FAST)
    const iv = base64ToBytes(encrypted.iv)
    if (iv === null) {
      throw new Error('fixture failed to decode')
    }
    iv[0] = iv[0] === undefined ? 0 : iv[0] ^ 0x01

    const decrypted = await decryptText(
      { ...encrypted, iv: bytesToBase64(iv) },
      PASSPHRASE,
    )

    expect(decrypted.ok).toBe(false)
  })

  it('rejects a tampered salt', async () => {
    const encrypted = await encryptText('secret', PASSPHRASE, FAST)
    const salt = base64ToBytes(encrypted.salt)
    if (salt === null) {
      throw new Error('fixture failed to decode')
    }
    salt[0] = salt[0] === undefined ? 0 : salt[0] ^ 0x01

    expect(
      (await decryptText({ ...encrypted, salt: bytesToBase64(salt) }, PASSPHRASE))
        .ok,
    ).toBe(false)
  })

  it('rejects truncated ciphertext', async () => {
    const encrypted = await encryptText('secret'.repeat(100), PASSPHRASE, FAST)
    const bytes = base64ToBytes(encrypted.ciphertext)
    if (bytes === null) {
      throw new Error('fixture failed to decode')
    }

    const decrypted = await decryptText(
      { ...encrypted, ciphertext: bytesToBase64(bytes.subarray(0, 40)) },
      PASSPHRASE,
    )

    expect(decrypted.ok).toBe(false)
  })

  it('rejects malformed Base64', async () => {
    const encrypted = await encryptText('secret', PASSPHRASE, FAST)

    expect(
      (await decryptText({ ...encrypted, ciphertext: 'not base64!!' }, PASSPHRASE))
        .ok,
    ).toBe(false)
  })

  it('never returns partially decoded data', async () => {
    const encrypted = await encryptText('secret', PASSPHRASE, FAST)
    const decrypted = await decryptText(encrypted, 'wrong')

    // The failure branch carries no plaintext field at all.
    expect('plaintext' in decrypted).toBe(false)
  })

  it('refuses an absurd iteration count instead of hanging', async () => {
    // A hostile file could otherwise freeze the browser on a single click.
    const encrypted = await encryptText('secret', PASSPHRASE, FAST)

    const decrypted = await decryptText(
      { ...encrypted, iterations: MAX_ACCEPTED_ITERATIONS + 1 },
      PASSPHRASE,
    )

    expect(!decrypted.ok && decrypted.reason).toBe('unsupported-parameters')
  })

  it('refuses a trivially cheap iteration count', async () => {
    const encrypted = await encryptText('secret', PASSPHRASE, FAST)

    expect((await decryptText({ ...encrypted, iterations: 1 }, PASSPHRASE)).ok).toBe(
      false,
    )
  })
})

describe('randomness', () => {
  it('uses the platform CSPRNG', () => {
    const first = randomBytes(16)
    const second = randomBytes(16)

    expect(first).toHaveLength(16)
    expect(bytesToBase64(first)).not.toBe(bytesToBase64(second))
  })
})

describe('base64', () => {
  it('round-trips binary data of every byte value', () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) {
      bytes[i] = i
    }

    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('round-trips data far larger than the call-stack limit', () => {
    // A spread-based encoder overflows here; a 10,000-participant backup is
    // this size and larger.
    const bytes = new Uint8Array(500_000).fill(7)

    expect(base64ToBytes(bytesToBase64(bytes))?.length).toBe(500_000)
  })

  it('rejects malformed input rather than throwing', () => {
    for (const value of ['!!!', 'abc', 'a===', '@@@@']) {
      expect(base64ToBytes(value)).toBeNull()
    }
  })
})
