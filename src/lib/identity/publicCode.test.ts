import { describe, expect, it } from 'vitest'
import {
  computeCheckCharacter,
  formatPublicCode,
  isIssuableSequence,
  isValidPublicCode,
  MAX_SEQUENCE,
  MIN_SEQUENCE,
  nextIssuableSequence,
  normalizePublicCode,
  parsePublicCode,
  type CodeIssuer,
} from './publicCode'
import { deriveIssuerCode } from './issuerCode'
import { newDeviceId } from './uuid'
import { deviceId, issuerCode, stationId } from '../../types'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const DEVICE_A = deviceId('11111111-2222-4333-8444-555555555555')
const DEVICE_B = deviceId('99999999-8888-4777-8666-555555555555')

/** Station A1 as operated by device A — issuer B8EFD9. */
const A1: CodeIssuer = {
  stationId: stationId('A1'),
  issuerCode: deriveIssuerCode(DEVICE_A),
}

/** The same station, a second physical device — issuer 6091A1. */
const A1_SECOND_DEVICE: CodeIssuer = {
  stationId: stationId('A1'),
  issuerCode: deriveIssuerCode(DEVICE_B),
}

const B1: CodeIssuer = { ...A1, stationId: stationId('B1') }

/** The first `count` issuable codes for an issuer, in order. */
function issueCodes(issuer: CodeIssuer, count: number): string[] {
  const codes: string[] = []
  let candidate = MIN_SEQUENCE

  for (let i = 0; i < count; i += 1) {
    const sequence = nextIssuableSequence(issuer, candidate)
    codes.push(formatPublicCode(issuer, sequence))
    candidate = sequence + 1
  }

  return codes
}

describe('formatPublicCode', () => {
  it('produces the documented A1-7F3C2A-00001-K shape', () => {
    expect(formatPublicCode(A1, 1)).toBe('A1-B8EFD9-00001-X')
    expect(formatPublicCode(A1, 1)).toMatch(/^[0-9A-Z]{1,8}-[0-9A-F]{6}-\d{5}-[0-9A-Z]$/)
  })

  it('matches fixed vectors, pinning the algorithm against silent change', () => {
    // Regenerating these requires deliberately re-issuing every printed code,
    // so a diff here is a migration, not a refactor.
    expect(formatPublicCode(A1, 2)).toBe('A1-B8EFD9-00002-V')
    expect(formatPublicCode(A1, 10)).toBe('A1-B8EFD9-00010-V')
    expect(formatPublicCode(A1, 10_000)).toBe('A1-B8EFD9-10000-3')
    expect(formatPublicCode(A1, 99_999)).toBe('A1-B8EFD9-99999-W')
    expect(formatPublicCode(B1, 1)).toBe('B1-B8EFD9-00001-I')
  })

  it('upper-cases the station and issuer', () => {
    const lowered: CodeIssuer = {
      stationId: stationId('a1'),
      issuerCode: issuerCode('b8efd9'),
    }
    expect(formatPublicCode(lowered, 1)).toBe('A1-B8EFD9-00001-X')
  })

  it('grows past the padding width instead of truncating', () => {
    expect(formatPublicCode(A1, 100_000)).toBe('A1-B8EFD9-100000-5')
    expect(formatPublicCode(A1, MAX_SEQUENCE)).toMatch(
      /^A1-B8EFD9-999999999999-[0-9A-Z]$/,
    )
  })

  it('rejects sequences outside the valid range', () => {
    expect(() => formatPublicCode(A1, 0)).toThrow()
    expect(() => formatPublicCode(A1, -1)).toThrow()
    expect(() => formatPublicCode(A1, 1.5)).toThrow()
    expect(() => formatPublicCode(A1, MAX_SEQUENCE + 1)).toThrow()
  })

  it('rejects malformed stations', () => {
    for (const station of ['', 'A-1', 'TOOLONGPREFIX']) {
      expect(() =>
        formatPublicCode({ ...A1, stationId: stationId(station) }, 1),
      ).toThrow(/station/)
    }
  })

  it('rejects malformed issuer codes', () => {
    for (const issuer of ['', 'B8EFD', 'B8EFD99', 'G8EFD9', 'B8-FD9']) {
      expect(() =>
        formatPublicCode({ ...A1, issuerCode: issuerCode(issuer) }, 1),
      ).toThrow(/issuer/)
    }
  })

  it('refuses to print a sequence with no printable check character', () => {
    expect(isIssuableSequence(A1, 58)).toBe(false)
    expect(() => formatPublicCode(A1, 58)).toThrow()
  })
})

describe('nextIssuableSequence', () => {
  it('skips sequences whose check value has no character', () => {
    // 58 is unprintable for A1/B8EFD9; the allocator steps over it.
    expect(nextIssuableSequence(A1, 58)).toBe(59)
    expect(nextIssuableSequence(A1, 1)).toBe(1)
  })

  it('never returns a sequence below the minimum', () => {
    expect(nextIssuableSequence(A1, 0)).toBe(MIN_SEQUENCE)
    expect(nextIssuableSequence(A1, -5)).toBe(MIN_SEQUENCE)
  })

  it('skips roughly one sequence in 37', () => {
    let skipped = 0
    for (let sequence = 1; sequence <= 3700; sequence += 1) {
      if (!isIssuableSequence(A1, sequence)) {
        skipped += 1
      }
    }
    expect(skipped).toBeGreaterThan(50)
    expect(skipped).toBeLessThan(150)
  })
})

describe('normalizePublicCode', () => {
  it('upper-cases', () => {
    expect(normalizePublicCode('a1-b8efd9-00001-x')).toBe('A1-B8EFD9-00001-X')
  })

  it('accepts spaces as separators', () => {
    expect(normalizePublicCode('A1 B8EFD9 00001 X')).toBe('A1-B8EFD9-00001-X')
  })

  it('collapses repeated separators and trims the ends', () => {
    expect(normalizePublicCode('  A1--B8EFD9 - 00001 - X  ')).toBe(
      'A1-B8EFD9-00001-X',
    )
  })

  it('does not fold visually similar characters', () => {
    expect(normalizePublicCode('A1-B8EFD9-00001-0')).toBe('A1-B8EFD9-00001-0')
  })
})

describe('parsePublicCode', () => {
  it('accepts a well-formed code and returns its parts', () => {
    expect(parsePublicCode('A1-B8EFD9-00001-X')).toMatchObject({
      ok: true,
      code: 'A1-B8EFD9-00001-X',
      stationId: 'A1',
      issuerCode: 'B8EFD9',
      sequence: 1,
      checkCharacter: 'X',
    })
  })

  it('accepts the same code however staff types it', () => {
    for (const typed of [
      'a1-b8efd9-00001-x',
      'A1 B8EFD9 00001 X',
      '  a1--b8efd9--00001--x ',
      'A1.B8EFD9.00001.X',
      'a1 B8efd9 00001 x',
    ]) {
      const result = parsePublicCode(typed)
      expect(result.ok).toBe(true)
      expect(result.ok && result.code).toBe('A1-B8EFD9-00001-X')
    }
  })

  it('canonicalises an under-padded sequence', () => {
    const result = parsePublicCode('A1-B8EFD9-1-X')
    expect(result.ok && result.code).toBe('A1-B8EFD9-00001-X')
  })

  it('rejects a wrong check character', () => {
    expect(parsePublicCode('A1-B8EFD9-00001-Y')).toEqual({
      ok: false,
      reason: 'invalid-check-character',
    })
  })

  it('rejects malformed input', () => {
    for (const raw of [
      '',
      'A1',
      'A1-B8EFD9-00001',
      'A1-B8EFD9-00001-XX',
      'A1-B8EFD9-ABCDE-X',
      'A1-B8EFDG-00001-X',
      'A1-B8EFD-00001-X',
      'not a code at all',
      '-----',
      'A1-B8EFD9-00001-!',
    ]) {
      expect(parsePublicCode(raw)).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('rejects the old station-only format, which is no longer issued', () => {
    expect(parsePublicCode('A1-00001-O')).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('rejects a zero sequence', () => {
    const result = parsePublicCode('A1-B8EFD9-00000-Z')
    expect(!result.ok && result.reason).toBe('sequence-out-of-range')
  })

  it('rejects a code issued at another station when one is expected', () => {
    const b1 = formatPublicCode(B1, 1)
    expect(parsePublicCode(b1, { expectedStation: 'A1' })).toEqual({
      ok: false,
      reason: 'unexpected-station',
    })
    expect(parsePublicCode(b1, { expectedStation: 'B1' }).ok).toBe(true)
    expect(parsePublicCode(b1, { expectedStation: 'b1' }).ok).toBe(true)
  })

  it('accepts codes from any device at the expected station', () => {
    // Point B sees stickers from every registration device, so the issuer must
    // never be constrained. It is a namespace, not an access check.
    for (const issuer of [A1, A1_SECOND_DEVICE]) {
      const code = formatPublicCode(issuer, 1)
      expect(parsePublicCode(code, { expectedStation: 'A1' }).ok).toBe(true)
    }
  })

  it('detects a mistyped issuer segment through the checksum', () => {
    // The issuer is inside the checksum payload, so corrupting it invalidates
    // the code rather than silently pointing at another device's namespace.
    const result = parsePublicCode('A1-6091A1-00001-X')
    expect(!result.ok && result.reason).toBe('invalid-check-character')
  })

  it('round-trips everything the issuer produces', () => {
    for (const code of issueCodes(A1, 500)) {
      expect(isValidPublicCode(code, { expectedStation: 'A1' })).toBe(true)
    }
  })
})

describe('check character detection properties', () => {
  const codes = issueCodes(A1, 300).map((code) => code.replace(/-/g, ''))

  it('detects every single-character substitution', () => {
    let tested = 0

    for (const code of codes) {
      for (let index = 0; index < code.length; index += 1) {
        for (const replacement of ALPHABET) {
          if (replacement === code[index]) {
            continue
          }
          const mutated =
            code.slice(0, index) + replacement + code.slice(index + 1)
          tested += 1
          expect(
            computeCheckCharacter(mutated.slice(0, -1)) === mutated.slice(-1),
          ).toBe(false)
        }
      }
    }

    expect(tested).toBeGreaterThan(100_000)
  })

  it('detects every adjacent transposition of two distinct characters', () => {
    let tested = 0

    for (const code of codes) {
      for (let index = 0; index < code.length - 1; index += 1) {
        if (code[index] === code[index + 1]) {
          continue
        }
        const mutated =
          code.slice(0, index) +
          code[index + 1] +
          code[index] +
          code.slice(index + 2)
        tested += 1
        expect(
          computeCheckCharacter(mutated.slice(0, -1)) === mutated.slice(-1),
        ).toBe(false)
      }
    }

    expect(tested).toBeGreaterThan(2_000)
  })

  it('detects every jump transposition across one character', () => {
    for (const code of codes) {
      for (let index = 0; index < code.length - 2; index += 1) {
        if (code[index] === code[index + 2]) {
          continue
        }
        const mutated =
          code.slice(0, index) +
          code[index + 2] +
          code[index + 1] +
          code[index] +
          code.slice(index + 3)
        expect(
          computeCheckCharacter(mutated.slice(0, -1)) === mutated.slice(-1),
        ).toBe(false)
      }
    }
  })
})

describe('code uniqueness at event scale', () => {
  it('issues 10,000 distinct, valid codes', () => {
    const codes = issueCodes(A1, 10_000)
    expect(new Set(codes).size).toBe(10_000)
    expect(codes.every((code) => isValidPublicCode(code))).toBe(true)
  })

  it('keeps codes distinct across stations', () => {
    const a = new Set(issueCodes(A1, 500))
    expect(issueCodes(B1, 500).some((code) => a.has(code))).toBe(false)
  })

  it('keeps codes distinct across devices at the SAME station', () => {
    // The reason the issuer segment exists. Both devices count 1, 2, 3... and
    // still cannot collide.
    const first = issueCodes(A1, 5_000)
    const second = issueCodes(A1_SECOND_DEVICE, 5_000)

    expect(new Set([...first, ...second]).size).toBe(10_000)

    // Same sequence numbers, different codes.
    expect(first[0]).toBe('A1-B8EFD9-00001-X')
    expect(second[0]).toBe('A1-6091A1-00001-C')
  })

  it('keeps codes distinct across a whole fleet of devices at one station', () => {
    const fleet = Array.from({ length: 8 }, () => ({
      stationId: stationId('A1'),
      issuerCode: deriveIssuerCode(newDeviceId()),
    }))

    const all = fleet.flatMap((issuer) => issueCodes(issuer, 1_000))
    expect(new Set(all).size).toBe(8_000)
  })

  it('stays five digits wide for the whole V1 range', () => {
    const codes = issueCodes(A1, 10_000)
    expect(codes[0]).toBe('A1-B8EFD9-00001-X')
    expect(codes.every((code) => /^A1-B8EFD9-\d{5}-[0-9A-Z]$/.test(code))).toBe(
      true,
    )
  })
})
