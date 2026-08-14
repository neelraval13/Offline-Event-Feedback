import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/*
 * Device credentials.
 *
 * A single API secret baked into the PWA would not be a secret: the bundle is
 * readable by anyone who visits. Instead an operator types a short-lived
 * enrolment code once, on a device that has Internet, and the device receives
 * its own long random token in exchange.
 *
 * The server stores only a hash of that token. A leaked database therefore
 * yields no usable upload credential, and the plaintext token exists exactly
 * once, in the response to the enrolment request.
 */

/** 256 bits of CSPRNG output, base64url so it survives a header intact. */
export function generateDeviceToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Hashes a token for storage.
 *
 * Plain SHA-256 rather than a password KDF, deliberately: this is a 256-bit
 * random value, not a human-chosen secret. There is no dictionary to attack, so
 * an expensive KDF would buy nothing and would slow every ingest request.
 */
export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Constant-time comparison, so a token cannot be recovered by timing. */
export function tokensMatch(candidateHash: string, storedHash: string): boolean {
  const candidate = Buffer.from(candidateHash, 'utf8')
  const stored = Buffer.from(storedHash, 'utf8')

  if (candidate.length !== stored.length) {
    return false
  }
  return timingSafeEqual(candidate, stored)
}

/** Constant-time comparison of the operator-entered enrolment code. */
export function enrollmentSecretMatches(
  provided: string,
  expected: string,
): boolean {
  // Hashed first so the comparison is over fixed-length buffers regardless of
  // what was submitted, otherwise length alone leaks through timing.
  return tokensMatch(hashDeviceToken(provided), hashDeviceToken(expected))
}

/** Extracts a bearer token. Never logged, never echoed. */
export function bearerToken(header: string | undefined | null): string | null {
  if (typeof header !== 'string') {
    return null
  }

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match?.[1] ?? null
}
