import { createHash, timingSafeEqual } from 'node:crypto'

/*
 * Reporting authentication.
 *
 * This is the first API that returns participant PII, and it deliberately does
 * **not** share an identity with anything else. A device token authorises one
 * enrolled tablet to *upload* what it captured; the enrolment code lets a device
 * obtain such a token. Neither should be able to read the whole event's names,
 * phone numbers and email addresses: a tablet left on a desk at a venue is a
 * very different threat model from an operator's admin session.
 *
 * So reporting requires its own secret, and it fails **closed**: if none is
 * configured, no reporting request succeeds. Sync is unaffected either way.
 */

export type ReportingAuthFailure =
  /** No secret configured on the server. Reporting is switched off entirely. */
  | 'not_configured'
  /** Missing or malformed Authorization header. */
  | 'missing'
  /** Wrong secret. */
  | 'rejected'

export type ReportingAuthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ReportingAuthFailure }

/**
 * Extracts a bearer credential. Never logged, never echoed.
 *
 * ## One character the secret cannot contain: a space
 *
 * `\S+` anchored to the end is the credential, which is the ordinary reading of
 * the `Authorization: Bearer <token>` syntax rather than a restriction invented
 * here. A secret containing a space therefore produces a header that does not
 * match at all: the request reports `missing`, and no partial secret is ever
 * compared against the configured one. Truncating at the space and testing the
 * first word would have been the worse behaviour of the two.
 *
 * The operator-facing consequence is documented where the secret is set: use a
 * memorable password without spaces. Letters, digits and symbols are all fine.
 * Escaping a space into the header instead would be a custom encoding on both
 * sides of an authentication path, which is a poor trade for one character.
 */
function bearer(header: string | undefined | null): string | null {
  if (typeof header !== 'string') {
    return null
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

/**
 * Constant-time comparison of two secrets.
 *
 * Hashed first so the comparison runs over fixed-length buffers whatever was
 * submitted, otherwise the length of a guess leaks through timing.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}

/**
 * Authorises a reporting request.
 *
 * @param configured the server's `REPORTING_ADMIN_SECRET`, if any
 */
export function authorizeReporting(
  authorizationHeader: string | undefined,
  configured: string | undefined,
): ReportingAuthResult {
  if (configured === undefined || configured.length === 0) {
    // Fail closed. A deployment that forgot to configure reporting must not
    // accidentally serve PII to anyone who asks.
    return { ok: false, reason: 'not_configured' }
  }

  const provided = bearer(authorizationHeader)
  if (provided === null) {
    return { ok: false, reason: 'missing' }
  }

  return secretsMatch(provided, configured)
    ? { ok: true }
    : { ok: false, reason: 'rejected' }
}

/**
 * Validates the reporting configuration as a whole, before the server listens.
 *
 * Pure, so it is tested directly rather than by spawning processes and reading
 * stderr. Returns the operator-facing message, or null when the configuration is
 * acceptable, including the entirely valid case of reporting being switched off.
 *
 * ## Separation is the only rule left here
 *
 * There used to be a second rule: a reporting secret under 32 characters failed
 * the deployment. It is gone. The people who run this event set these values by
 * hand, on a phone, at a venue, and a generated 64-character hex string is not
 * something they can type or remember; in practice it gets written down
 * somewhere worse than a memorable password would be. Length is now the
 * operator's judgement, and the documentation asks for a good password rather
 * than the server refusing to start over one.
 *
 * What remains is the check a strong secret would not have saved anyone from.
 * The whole argument for a second credential is that uploading and reading the
 * venue's contact list are different privileges; setting both variables to the
 * same string reinstates exactly the problem the design exists to prevent, while
 * looking correctly configured. It is a plausible mistake, an operator with one
 * secret to hand pasting it twice, so it fails the deployment rather than being
 * documented against.
 *
 * No message ever contains either secret: startup errors are read in terminals,
 * copied into tickets and captured by process supervisors.
 */
export function describeReportingConfigProblem(
  reportingSecret: string | undefined,
  enrollmentSecret: string | undefined,
): string | null {
  if (reportingSecret === undefined || reportingSecret.length === 0) {
    // Reporting off. It fails closed at request time; sync is unaffected.
    return null
  }

  if (
    enrollmentSecret !== undefined &&
    enrollmentSecret.length > 0 &&
    reportingSecret === enrollmentSecret
  ) {
    return (
      'REPORTING_ADMIN_SECRET must not be the same value as SYNC_ENROLLMENT_SECRET. ' +
      'The enrolment code is typed into tablets on the venue floor; the reporting ' +
      'secret reads every participant\'s contact details. Set two different values.'
    )
  }

  return null
}
