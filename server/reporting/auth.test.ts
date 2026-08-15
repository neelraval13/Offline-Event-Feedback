import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  authorizeReporting,
  describeReportingConfigProblem,
  describeSecretWeakness,
  REPORTING_SECRET_MIN_LENGTH,
} from './auth.js'

/*
 * The credential boundary between "may upload what I captured" and "may read
 * everyone's name, phone number and email".
 */

const SECRET = randomBytes(32).toString('hex')

describe('authorizeReporting', () => {
  it('fails closed when no secret is configured', () => {
    expect(authorizeReporting(`Bearer ${SECRET}`, undefined)).toEqual({
      ok: false,
      reason: 'not_configured',
    })
    expect(authorizeReporting(`Bearer ${SECRET}`, '')).toEqual({
      ok: false,
      reason: 'not_configured',
    })
  })

  it('accepts the configured secret', () => {
    expect(authorizeReporting(`Bearer ${SECRET}`, SECRET)).toEqual({ ok: true })
    // Scheme is case-insensitive per RFC 7235.
    expect(authorizeReporting(`bearer ${SECRET}`, SECRET)).toEqual({ ok: true })
  })

  it('rejects a missing or malformed header', () => {
    for (const header of [undefined, '', 'Bearer', 'Basic abc', SECRET]) {
      expect(authorizeReporting(header, SECRET)).toEqual({
        ok: false,
        reason: 'missing',
      })
    }
  })

  it('rejects a wrong secret, including a near-miss', () => {
    expect(authorizeReporting(`Bearer ${SECRET}x`, SECRET)).toEqual({
      ok: false,
      reason: 'rejected',
    })
    expect(authorizeReporting(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toEqual({
      ok: false,
      reason: 'rejected',
    })
  })

  it('rejects sync credentials: a device token and the enrolment secret', () => {
    // Both are perfectly valid elsewhere in the system. Neither may read PII.
    const deviceToken = randomBytes(32).toString('base64url')
    const enrollmentSecret = 'dev-enrollment-secret'

    expect(authorizeReporting(`Bearer ${deviceToken}`, SECRET)).toEqual({
      ok: false,
      reason: 'rejected',
    })
    expect(authorizeReporting(`Bearer ${enrollmentSecret}`, SECRET)).toEqual({
      ok: false,
      reason: 'rejected',
    })
  })
})

describe('describeSecretWeakness', () => {
  it('accepts a 32-byte hex secret', () => {
    expect(describeSecretWeakness(SECRET)).toBeNull()
  })

  it('rejects anything shorter than the minimum, and says how to generate one', () => {
    const weakness = describeSecretWeakness('a'.repeat(REPORTING_SECRET_MIN_LENGTH - 1))
    expect(weakness).toContain('openssl rand -hex 32')
  })

  it('never includes the secret in its message', () => {
    const weak = 'hunter2'
    expect(describeSecretWeakness(weak)).not.toContain(weak)
  })
})

describe('describeReportingConfigProblem', () => {
  const ENROLMENT = 'a-perfectly-good-enrolment-code-value'

  it('accepts a strong secret that differs from the enrolment code', () => {
    expect(describeReportingConfigProblem(SECRET, ENROLMENT)).toBeNull()
  })

  it('accepts reporting being switched off', () => {
    // Not a misconfiguration: reporting fails closed and sync is unaffected.
    expect(describeReportingConfigProblem(undefined, ENROLMENT)).toBeNull()
    expect(describeReportingConfigProblem('', ENROLMENT)).toBeNull()
  })

  it('rejects a weak secret', () => {
    const problem = describeReportingConfigProblem('short', ENROLMENT)
    expect(problem).toContain(String(REPORTING_SECRET_MIN_LENGTH))
  })

  it('rejects reusing the enrolment code as the reporting secret', () => {
    /*
     * The plausible mistake: one generated value, pasted into both variables.
     * It looks configured and quietly hands every tablet operator who has typed
     * the enrolment code the ability to read the whole event's contact details.
     */
    const shared = 'z'.repeat(48)
    const problem = describeReportingConfigProblem(shared, shared)

    expect(problem).not.toBeNull()
    expect(problem).toContain('SYNC_ENROLLMENT_SECRET')
    // The message is read in terminals and pasted into tickets.
    expect(problem).not.toContain(shared)
  })

  it('does not compare against an absent enrolment code', () => {
    expect(describeReportingConfigProblem(SECRET, undefined)).toBeNull()
    expect(describeReportingConfigProblem(SECRET, '')).toBeNull()
  })
})
