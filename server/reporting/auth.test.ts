import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  authorizeReporting,
  describeReportingConfigProblem,
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

  it('authenticates a short memorable secret, and rejects a near-miss of it', () => {
    /*
     * The comparison hashes before comparing, so it is length-agnostic by
     * construction. Asserted anyway: this is the case the removed 32-character
     * rule used to make impossible, and it is now the common one.
     */
    const memorable = 'flea26'

    expect(authorizeReporting(`Bearer ${memorable}`, memorable)).toEqual({ ok: true })
    expect(authorizeReporting('Bearer flea27', memorable)).toEqual({
      ok: false,
      reason: 'rejected',
    })
    expect(authorizeReporting('Bearer flea2', memorable)).toEqual({
      ok: false,
      reason: 'rejected',
    })
  })

  it('cannot carry a secret containing a space', () => {
    /*
     * Not a rule this module invented: `Bearer <token>` is one whitespace-free
     * credential. A secret with a space in it produces a header that does not
     * parse at all, so it reports `missing` rather than being silently
     * truncated to the part before the space and compared. That is the safer of
     * the two failure modes, and it is worth pinning: it means no partial
     * secret is ever tested against the configured one.
     *
     * Pinned so the limitation is a known contract rather than a support call,
     * and so nobody adds custom escaping to an authentication path.
     */
    const spaced = 'two words'

    expect(authorizeReporting(`Bearer ${spaced}`, spaced)).toEqual({
      ok: false,
      reason: 'missing',
    })
    // Specifically: the leading word is not accepted as the credential either.
    expect(authorizeReporting(`Bearer ${spaced}`, 'two')).toEqual({
      ok: false,
      reason: 'missing',
    })
    // Everything else an operator is likely to type is fine.
    for (const secret of ['pa55word', 'Flea-26!', 'a', 'ünïcodé', '£$%^&*()_+']) {
      expect(authorizeReporting(`Bearer ${secret}`, secret)).toEqual({ ok: true })
    }
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

  it('accepts a short secret, because length is the operator’s judgement', () => {
    /*
     * This used to be the opposite assertion: under 32 characters failed the
     * deployment. The people who set these values do it by hand at a venue, and
     * a generated hex string they cannot type gets written down somewhere worse
     * than a memorable password would be.
     */
    expect(describeReportingConfigProblem('x', ENROLMENT)).toBeNull()
    expect(describeReportingConfigProblem('short', ENROLMENT)).toBeNull()
  })

  it('accepts a memorable password', () => {
    expect(describeReportingConfigProblem('correct-horse-battery', ENROLMENT)).toBeNull()
    expect(describeReportingConfigProblem('Fl3a!Report#26', ENROLMENT)).toBeNull()
  })

  it('rejects reusing the enrolment code as the reporting secret', () => {
    /*
     * The plausible mistake: one generated value, pasted into both variables.
     * It looks configured and quietly hands every tablet operator who has typed
     * the enrolment code the ability to read the whole event's contact details.
     */
    const shared = 'the-same-value-twice'
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
