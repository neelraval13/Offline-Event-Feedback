import { issuerCode, type DeviceId, type IssuerCode } from '../../types'

/*
 * The issuer segment of a public code: `A1-7F3C2A-00001-K`.
 *                                          ^^^^^^
 *
 * Why it exists: IndexedDB is device-local and there is no coordination
 * between devices during the event. Two installations working station A1 would
 * each start their counter at 1 and print `A1-00001-O` for two different
 * participants. Since the public code is the manual fallback identity, that
 * collision is silent and unrecoverable. Point B cannot tell the two apart,
 * and neither can the server afterwards. Namespacing the counter per device
 * removes the possibility rather than making it unlikely.
 *
 * Six uppercase hex characters, derived deterministically from the persisted
 * `deviceId`:
 *
 * - **Deterministic**, so a device's issuer code is a pure function of identity
 *   it already has. Nothing new to persist, nothing to keep in sync, and a
 *   device that reloads keeps the same issuer forever.
 * - **Hexadecimal**, not base36. `0-9A-F` contains neither `O` nor `I`, so
 *   adding six characters to a code staff types by hand introduces no new
 *   glyph ambiguity, which matters given `O`/`0` and `I`/`1` are already a
 *   known concern for the check character.
 * - **24 bits** (~16.7 million values). For the ~10 devices an event of this
 *   size runs, the probability that any two share an issuer code is around
 *   3 in a million; at 100 devices it is still under 1 in 3,000. Measured
 *   dispersion over 200,000 random device IDs matched the uniform birthday
 *   expectation almost exactly (1,194 collisions against 1,192 predicted).
 * - **No PII**: the input is a random UUIDv4 that encodes nothing about a
 *   person, and the output is a truncated hash of it.
 *
 * The hash is FNV-1a (32-bit) followed by the MurmurHash3 `fmix32` finalizer,
 * both standard published algorithms, both synchronous. A cryptographic digest
 * would be the reflex choice, but `crypto.subtle` is restricted to secure
 * contexts, the same trap that rules out `crypto.randomUUID()` here, and this
 * needs dispersion, not preimage resistance. Nothing about the issuer code is
 * a security control; it is a namespace.
 */

/** Characters in the issuer segment. */
export const ISSUER_CODE_LENGTH = 6

/** Bits of the hash kept: exactly what {@link ISSUER_CODE_LENGTH} hex digits hold. */
const ISSUER_CODE_MASK = 0xffffff

export const ISSUER_CODE_PATTERN = /^[0-9A-F]{6}$/

/** FNV-1a, 32-bit. */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash >>> 0
}

/**
 * MurmurHash3's 32-bit finalizer.
 *
 * FNV-1a alone already disperses random UUIDs well; measurement put it within
 * noise of uniform. This runs anyway so the result does not depend on the input
 * being random: FNV's low bits mix weakly, and a future device ID that is
 * structured rather than random would otherwise cluster.
 */
function fmix32(value: number): number {
  let hash = value
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return hash >>> 0
}

/**
 * The stable issuer code for a device.
 *
 * Pure and deterministic: the same device ID always yields the same code, on
 * any installation, with no stored state and no coordination.
 */
export function deriveIssuerCode(deviceId: DeviceId): IssuerCode {
  const hashed = fmix32(fnv1a32(deviceId)) & ISSUER_CODE_MASK

  return issuerCode(
    hashed.toString(16).toUpperCase().padStart(ISSUER_CODE_LENGTH, '0'),
  )
}

/** Whether a string is shaped like an issuer code. */
export function isIssuerCode(value: string): boolean {
  return ISSUER_CODE_PATTERN.test(value)
}
