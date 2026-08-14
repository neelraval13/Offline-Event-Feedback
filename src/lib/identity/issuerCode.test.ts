import { describe, expect, it } from 'vitest'
import {
  deriveIssuerCode,
  ISSUER_CODE_LENGTH,
  isIssuerCode,
} from './issuerCode'
import { newDeviceId } from './uuid'
import { deviceId, type DeviceId } from '../../types'

/** Fixed device IDs, so these expectations never depend on randomness. */
const FIXTURES: readonly DeviceId[] = [
  deviceId('11111111-2222-4333-8444-555555555555'),
  deviceId('99999999-8888-4777-8666-555555555555'),
  deviceId('0199f5c2-1234-4abc-8def-0123456789ab'),
  deviceId('deadbeef-dead-4eef-8eef-deadbeefdead'),
  deviceId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  deviceId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  deviceId('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  deviceId('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
]

describe('deriveIssuerCode', () => {
  it('produces six uppercase hex characters', () => {
    for (const device of FIXTURES) {
      const code = deriveIssuerCode(device)
      expect(code).toHaveLength(ISSUER_CODE_LENGTH)
      expect(code).toMatch(/^[0-9A-F]{6}$/)
      expect(isIssuerCode(code)).toBe(true)
    }
  })

  it('matches fixed vectors, pinning the derivation against silent change', () => {
    // A change here re-namespaces every code a device would issue, so a diff
    // is a migration decision rather than a refactor.
    expect(deriveIssuerCode(FIXTURES[0] as DeviceId)).toBe('B8EFD9')
    expect(deriveIssuerCode(FIXTURES[1] as DeviceId)).toBe('6091A1')
    expect(deriveIssuerCode(FIXTURES[2] as DeviceId)).toBe('12B877')
  })

  it('gives the same device the same issuer code every time', () => {
    const device = newDeviceId()
    const first = deriveIssuerCode(device)

    for (let i = 0; i < 100; i += 1) {
      expect(deriveIssuerCode(device)).toBe(first)
    }
  })

  it('is a pure function of the device ID, with nothing stored', () => {
    // Two independent derivations in different "installations" of the code
    // agree, because there is no state to diverge.
    const device = deviceId('0199f5c2-1234-4abc-8def-0123456789ab')
    expect(deriveIssuerCode(device)).toBe(deriveIssuerCode(device))
    expect(deriveIssuerCode(device)).toBe('12B877')
  })

  it('gives different device IDs different issuer codes', () => {
    const codes = FIXTURES.map(deriveIssuerCode)
    expect(new Set(codes).size).toBe(FIXTURES.length)
  })

  it('separates device IDs that differ by a single character', () => {
    const a = deviceId('11111111-2222-4333-8444-555555555555')
    const b = deviceId('11111111-2222-4333-8444-555555555556')
    expect(deriveIssuerCode(a)).not.toBe(deriveIssuerCode(b))
  })

  it('disperses across the space at the rate a uniform hash would', () => {
    // 20,000 random device IDs into 2^24 buckets: the birthday expectation is
    // ~12 collisions. The bound is deliberately loose; this detects a broken
    // derivation (clustering, truncation to too few bits), not statistical
    // noise.
    const codes = new Set<string>()
    for (let i = 0; i < 20_000; i += 1) {
      codes.add(deriveIssuerCode(newDeviceId()))
    }
    expect(codes.size).toBeGreaterThan(19_950)
  })

  it('never emits characters that can be misread as each other', () => {
    // Hex excludes O and I, so the issuer segment cannot add O/0 or I/1
    // confusion to a code staff types by hand.
    for (let i = 0; i < 2_000; i += 1) {
      expect(deriveIssuerCode(newDeviceId())).not.toMatch(/[OI]/)
    }
  })

  it('carries no PII', () => {
    // The input is a random UUIDv4 that encodes nothing about a person, and
    // the output is a truncated hash of it.
    const device = deviceId('11111111-2222-4333-8444-555555555555')
    expect(deriveIssuerCode(device)).not.toContain('1111')
  })
})

describe('isIssuerCode', () => {
  it('rejects anything that is not six hex characters', () => {
    for (const value of ['', 'B8EFD', 'B8EFD99', 'b8efd9', 'G8EFD9', 'B8-FD9']) {
      expect(isIssuerCode(value)).toBe(false)
    }
  })
})
