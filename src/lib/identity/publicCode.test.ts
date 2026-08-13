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
} from './publicCode'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** The first `count` issuable codes for a prefix, in order. */
function issueCodes(prefix: string, count: number): string[] {
  const codes: string[] = []
  let candidate = MIN_SEQUENCE

  for (let i = 0; i < count; i += 1) {
    const sequence = nextIssuableSequence(prefix, candidate)
    codes.push(formatPublicCode(prefix, sequence))
    candidate = sequence + 1
  }

  return codes
}

describe('formatPublicCode', () => {
  it('produces the documented A1-00001-X shape', () => {
    expect(formatPublicCode('A1', 1)).toBe('A1-00001-O')
  })

  it('matches fixed vectors, pinning the algorithm against silent change', () => {
    // Regenerating these requires deliberately re-issuing every printed code,
    // so a diff here is a migration, not a refactor.
    expect(formatPublicCode('A1', 2)).toBe('A1-00002-M')
    expect(formatPublicCode('A1', 10)).toBe('A1-00010-M')
    expect(formatPublicCode('A1', 10_000)).toBe('A1-10000-V')
    expect(formatPublicCode('A1', 99_999)).toBe('A1-99999-N')
    expect(formatPublicCode('B1', 1)).toBe('B1-00001-7')
  })

  it('upper-cases the issuer', () => {
    expect(formatPublicCode('a1', 1)).toBe('A1-00001-O')
  })

  it('grows past the padding width instead of truncating', () => {
    expect(formatPublicCode('A1', 100_000)).toBe('A1-100000-O')
    expect(formatPublicCode('A1', MAX_SEQUENCE)).toMatch(
      /^A1-999999999999-[0-9A-Z]$/,
    )
  })

  it('rejects sequences outside the valid range', () => {
    expect(() => formatPublicCode('A1', 0)).toThrow()
    expect(() => formatPublicCode('A1', -1)).toThrow()
    expect(() => formatPublicCode('A1', 1.5)).toThrow()
    expect(() => formatPublicCode('A1', MAX_SEQUENCE + 1)).toThrow()
  })

  it('rejects malformed issuers', () => {
    expect(() => formatPublicCode('', 1)).toThrow()
    expect(() => formatPublicCode('A-1', 1)).toThrow()
    expect(() => formatPublicCode('TOOLONGPREFIX', 1)).toThrow()
  })

  it('refuses to print a sequence with no printable check character', () => {
    expect(isIssuableSequence('A1', 288)).toBe(false)
    expect(() => formatPublicCode('A1', 288)).toThrow()
  })
})

describe('nextIssuableSequence', () => {
  it('skips sequences whose check value has no character', () => {
    // 288 is unprintable for A1; the allocator steps over it.
    expect(nextIssuableSequence('A1', 288)).toBe(289)
    expect(nextIssuableSequence('A1', 1)).toBe(1)
  })

  it('never returns a sequence below the minimum', () => {
    expect(nextIssuableSequence('A1', 0)).toBe(MIN_SEQUENCE)
    expect(nextIssuableSequence('A1', -5)).toBe(MIN_SEQUENCE)
  })

  it('skips roughly one sequence in 37', () => {
    let skipped = 0
    for (let sequence = 1; sequence <= 3700; sequence += 1) {
      if (!isIssuableSequence('A1', sequence)) {
        skipped += 1
      }
    }
    expect(skipped).toBeGreaterThan(50)
    expect(skipped).toBeLessThan(150)
  })
})

describe('normalizePublicCode', () => {
  it('upper-cases', () => {
    expect(normalizePublicCode('a1-00001-o')).toBe('A1-00001-O')
  })

  it('accepts spaces as separators', () => {
    expect(normalizePublicCode('A1 00001 O')).toBe('A1-00001-O')
  })

  it('collapses repeated separators and trims the ends', () => {
    expect(normalizePublicCode('  A1--00001 - O  ')).toBe('A1-00001-O')
  })

  it('does not fold visually similar characters', () => {
    // O and 0 are different values to the checksum; folding would corrupt
    // legitimate codes whose check character happens to be O.
    expect(normalizePublicCode('A1-00001-0')).toBe('A1-00001-0')
  })
})

describe('parsePublicCode', () => {
  it('accepts a well-formed code and returns its parts', () => {
    const result = parsePublicCode('A1-00001-O')
    expect(result).toMatchObject({
      ok: true,
      code: 'A1-00001-O',
      prefix: 'A1',
      sequence: 1,
      checkCharacter: 'O',
    })
  })

  it('accepts the same code however staff types it', () => {
    for (const typed of [
      'a1-00001-o',
      'A1 00001 O',
      '  a1--00001--o ',
      'A1.00001.O',
    ]) {
      const result = parsePublicCode(typed)
      expect(result.ok).toBe(true)
      expect(result.ok && result.code).toBe('A1-00001-O')
    }
  })

  it('canonicalises an under-padded sequence', () => {
    // The check character is computed over the padded payload, so a code typed
    // without its leading zeros still validates and normalises to one form.
    const result = parsePublicCode('A1-1-O')
    expect(result.ok && result.code).toBe('A1-00001-O')
  })

  it('rejects a wrong check character', () => {
    const result = parsePublicCode('A1-00001-P')
    expect(result).toEqual({ ok: false, reason: 'invalid-check-character' })
  })

  it('rejects malformed input', () => {
    for (const raw of [
      '',
      'A1',
      'A1-00001',
      'A1-00001-OO',
      'A1-ABCDE-O',
      'not a code at all',
      '-----',
      'A1-00001-!',
    ]) {
      expect(parsePublicCode(raw)).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('rejects a zero sequence', () => {
    expect(parsePublicCode('A1-00000-Y')).toEqual({
      ok: false,
      reason: 'sequence-out-of-range',
    })
  })

  it('rejects a code issued by another station when one is expected', () => {
    const b1 = formatPublicCode('B1', 1)
    expect(parsePublicCode(b1, { expectedPrefix: 'A1' })).toEqual({
      ok: false,
      reason: 'unexpected-prefix',
    })
    expect(parsePublicCode(b1, { expectedPrefix: 'B1' }).ok).toBe(true)
    expect(parsePublicCode(b1, { expectedPrefix: 'b1' }).ok).toBe(true)
  })

  it('reports the prefix mismatch ahead of the checksum failure', () => {
    // A wrong-station code also fails its checksum against the expected
    // prefix; the more specific reason is the useful one for staff.
    expect(
      parsePublicCode('B1-00001-7', { expectedPrefix: 'A1' }).ok,
    ).toBe(false)
    const result = parsePublicCode('B1-00001-7', { expectedPrefix: 'A1' })
    expect(!result.ok && result.reason).toBe('unexpected-prefix')
  })

  it('round-trips everything the issuer produces', () => {
    for (const code of issueCodes('A1', 500)) {
      expect(isValidPublicCode(code, { expectedPrefix: 'A1' })).toBe(true)
    }
  })
})

describe('check character detection properties', () => {
  const codes = issueCodes('A1', 300).map((code) => code.replace(/-/g, ''))

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

    expect(tested).toBeGreaterThan(50_000)
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

    expect(tested).toBeGreaterThan(1_000)
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
    const codes = issueCodes('A1', 10_000)
    expect(new Set(codes).size).toBe(10_000)
    expect(codes.every((code) => isValidPublicCode(code))).toBe(true)
  })

  it('keeps codes distinct across stations', () => {
    const a = new Set(issueCodes('A1', 500))
    const b = issueCodes('B1', 500)
    expect(b.some((code) => a.has(code))).toBe(false)
  })

  it('stays five digits wide for the whole V1 range', () => {
    const codes = issueCodes('A1', 10_000)
    expect(codes[0]).toBe('A1-00001-O')
    expect(codes.every((code) => /^A1-\d{5}-[0-9A-Z]$/.test(code))).toBe(true)
  })
})
