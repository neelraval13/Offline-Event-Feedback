/*
 * Base64 for the binary parts of a backup envelope.
 *
 * Chunked rather than a single `String.fromCharCode(...bytes)` spread: a
 * 10,000-participant backup produces megabytes of ciphertext, and spreading
 * that many arguments overflows the call stack. This is the kind of thing that
 * works perfectly on a developer's ten test records and fails at the venue.
 */

const CHUNK_SIZE = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

/** Strict Base64 — used on untrusted files, so anything odd is rejected. */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

export function isBase64(value: string): boolean {
  return value.length % 4 === 0 && BASE64_PATTERN.test(value)
}

/** Decodes Base64, returning `null` rather than throwing on malformed input. */
export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!isBase64(value)) {
    return null
  }

  let binary: string
  try {
    binary = atob(value)
  } catch {
    return null
  }

  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}
