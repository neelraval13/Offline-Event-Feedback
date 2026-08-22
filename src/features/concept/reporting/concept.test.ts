import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTE_PATHS } from '../../../lib/routing/hashRoute'
import {
  ANALYSIS_BASE,
  COUNTS,
  COVERAGE,
  DUPLICATES,
  LEGACY_ANALYTICS,
  PARTICIPANTS,
  QUESTIONNAIRES,
  RATINGS,
  RESPONSES,
  REVIEW_CATEGORIES,
} from './fixtures'

/*
 * The concept's isolation and its arithmetic.
 *
 * Two jobs. The first is proving this route cannot reach the central database:
 * it is the one design surface whose production counterpart reads every
 * participant's contact details, so "it only uses fixtures" has to be a fact
 * the build checks rather than a claim in a comment.
 *
 * The second is proving the fixtures add up. A reviewer's first instinct with a
 * coverage fraction is to check it against the counts beside it, and a concept
 * whose numbers do not reconcile teaches them to stop trusting the screen.
 */

const DIRECTORY = join(process.cwd(), 'src/features/concept/reporting')

function conceptSources(): { readonly file: string; readonly text: string }[] {
  return readdirSync(DIRECTORY)
    .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
    .filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'))
    .map((file) => ({ file, text: readFileSync(join(DIRECTORY, file), 'utf8') }))
}

describe('concept isolation', () => {
  it('imports no effectful reporting function', () => {
    /*
     * The named functions from the spec, plus the session module. Any one of
     * them would give this route a path to a real credential or real data.
     *
     * Matched against the import statements rather than the whole file, so a
     * comment may name what is deliberately absent. Saying "this route does not
     * import `reportingClient`" is the sentence a reader needs, and a text
     * search over the source would make writing it impossible.
     */
    const forbidden = [
      'reportingClient',
      'useReportingSession',
      'ReportingSessionProvider',
      'requestReconciliation',
      'queryRegistrations',
      'queryFeedback',
      'downloadExport',
      'saveExport',
      'fetchOverview',
      'fetchRuns',
      'fetchDuplicateCandidates',
      'fetchRegistrationDetail',
      'fetchFeedbackDetail',
    ]

    for (const { file, text } of conceptSources()) {
      const statements = [...text.matchAll(/^import[\s\S]*?from '[^']+'/gm)].map(
        (match) => match[0],
      )

      for (const symbol of forbidden) {
        const imported = statements.some((statement) => statement.includes(symbol))
        expect(`${file}: ${symbol} ${imported}`).toBe(`${file}: ${symbol} false`)
      }
    }
  })

  it('imports nothing from the production reporting feature or its client', () => {
    for (const { file, text } of conceptSources()) {
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((match) => match[1])
      for (const specifier of imports) {
        expect(`${file}: ${specifier}`).not.toContain('features/reporting')
        expect(`${file}: ${specifier}`).not.toContain('lib/reporting')
      }
    }
  })

  it('makes no network request and reads no browser storage', () => {
    /*
     * Checked as source text rather than by rendering, because a route that
     * only fetches on a state the test never reaches would still pass a render
     * assertion.
     */
    const banned = [
      'fetch(',
      'XMLHttpRequest',
      'navigator.sendBeacon',
      'WebSocket',
      'EventSource',
      'indexedDB',
      'localStorage',
      'sessionStorage',
      'document.cookie',
      'caches.',
    ]

    for (const { file, text } of conceptSources()) {
      for (const token of banned) {
        expect(`${file}: ${token} ${text.includes(token)}`).toBe(
          `${file}: ${token} false`,
        )
      }
    }
  })

  it('creates no download and triggers no reconciliation', () => {
    for (const { file, text } of conceptSources()) {
      for (const token of ['createObjectURL', 'download=', '.download', 'Blob(']) {
        expect(`${file}: ${token} ${text.includes(token)}`).toBe(
          `${file}: ${token} false`,
        )
      }
    }
  })

  it('is registered as an unlisted route, separate from /reporting', () => {
    expect(ROUTE_PATHS).toContain('/concept/reporting')
    expect(ROUTE_PATHS).toContain('/reporting')
    expect('/concept/reporting').not.toBe('/reporting')
  })
})

describe('concept fixtures', () => {
  it('uses only synthetic email domains', () => {
    const emails = [
      ...PARTICIPANTS.map((row) => row.email),
      ...RESPONSES.map((row) => row.respondentEmail).filter(
        (value): value is string => value !== null,
      ),
      ...DUPLICATES.flatMap((pair) => [pair.left.email, pair.right.email]),
    ]

    expect(emails.length).toBeGreaterThan(0)
    for (const email of emails) {
      // `.test` is reserved by RFC 6761 and can never be a real address.
      expect(email.endsWith('@example.test')).toBe(true)
    }
  })

  it('reconciles the registration counts', () => {
    expect(COUNTS.matchedRegistrations + COUNTS.registrationsWithMultipleFeedback).toBe(
      COVERAGE.withFeedback,
    )
    expect(COVERAGE.withFeedback + COVERAGE.noResponse).toBe(COUNTS.registrationCount)
    expect(COVERAGE.totalRegistrations).toBe(COUNTS.registrationCount)
  })

  it('reconciles the response counts', () => {
    const total =
      COUNTS.matchedFeedback +
      COUNTS.feedbackInMultipleGroups +
      COUNTS.standaloneFeedback +
      COUNTS.feedbackWithoutRegistration +
      COUNTS.feedbackIdentityConflicts

    expect(total).toBe(COUNTS.feedbackCount)
  })

  it('states a coverage percentage that matches its own fraction', () => {
    const computed =
      Math.round((COVERAGE.withFeedback / COVERAGE.totalRegistrations) * 1000) / 10
    expect(COVERAGE.percentage).toBe(computed)
  })

  it('keeps direct feedback out of both halves of registration coverage', () => {
    /*
     * The locked rule. A rider with no registration is not on the registration
     * list, so counting them in the numerator could push coverage past 100% at
     * an event where the contact path was popular, and counting them in the
     * denominator would invent registrations to divide by.
     */
    expect(COVERAGE.directResponses).toBeGreaterThan(0)
    expect(COVERAGE.withFeedback).toBeLessThanOrEqual(COVERAGE.totalRegistrations)
    expect(COVERAGE.withFeedback + COVERAGE.noResponse).toBe(
      COVERAGE.totalRegistrations,
    )
    expect(COVERAGE.percentage).toBeLessThanOrEqual(100)
  })

  it('builds the analysis base from matched and direct responses only', () => {
    // Mirrors `buildOverview`: WHERE r.status IN ('matched', 'standalone').
    expect(ANALYSIS_BASE.matched).toBe(COUNTS.matchedFeedback)
    expect(ANALYSIS_BASE.direct).toBe(COUNTS.standaloneFeedback)
    expect(ANALYSIS_BASE.matched + ANALYSIS_BASE.direct).toBe(ANALYSIS_BASE.total)

    const excluded = ANALYSIS_BASE.excluded.reduce((sum, row) => sum + row.count, 0)
    expect(ANALYSIS_BASE.total + excluded).toBe(COUNTS.feedbackCount)
  })

  it('splits the analysis base across questionnaires without remainder', () => {
    const total = QUESTIONNAIRES.reduce(
      (sum, questionnaire) => sum + questionnaire.responses,
      0,
    )
    expect(total).toBe(ANALYSIS_BASE.total)
  })

  it('states rating averages its own distributions produce', () => {
    for (const rating of RATINGS) {
      const answered = rating.distribution.reduce((sum, count) => sum + count, 0)
      const weighted = rating.distribution.reduce(
        (sum, count, index) => sum + count * (index + 1),
        0,
      )
      expect(answered).toBe(rating.answered)
      expect(Math.round((weighted / answered) * 100) / 100).toBe(rating.average)
    }
  })

  it('never averages the 1-5 and 1-7 questionnaires together', () => {
    /*
     * The two are separate shapes holding separate figures. There is no field
     * anywhere that could carry a combined mean, which is the point: a screen
     * cannot render a number that does not exist.
     */
    expect(RATINGS.every((rating) => rating.distribution.length === 7)).toBe(true)
    expect(LEGACY_ANALYTICS.ratingCounts.length).toBe(5)
    expect(LEGACY_ANALYTICS.averageOverallRating).toBeLessThanOrEqual(5)

    const combined = { ...LEGACY_ANALYTICS } as Record<string, unknown>
    expect(combined['ratings']).toBeUndefined()
    expect(combined['distribution']).toBeUndefined()
  })

  it('keeps direct feedback out of every review category', () => {
    const keys = REVIEW_CATEGORIES.map((category) => category.key)
    expect(keys).not.toContain('standalone')

    const total = REVIEW_CATEGORIES.reduce((sum, category) => sum + category.count, 0)
    // Adding the 37 direct responses would change this total; it must not.
    expect(total).toBe(
      COUNTS.feedbackWithoutRegistration +
        COUNTS.feedbackIdentityConflicts +
        COUNTS.registrationsWithMultipleFeedback +
        COUNTS.registrationsWithoutFeedback,
    )
  })

  it('gives a participant as many responses as their status claims', () => {
    /*
     * The detail sheet lists the responses whose linked code is the
     * participant's. A row saying "3" above a panel listing one is exactly the
     * kind of thing a reviewer spots and a reader never trusts again.
     */
    for (const participant of PARTICIPANTS) {
      const linked = RESPONSES.filter(
        (row) => row.linkedCode === participant.publicCode,
      )

      if (participant.status === 'multiple_feedback') {
        expect(linked.length).toBeGreaterThan(1)
      }
      if (participant.status === 'without_feedback') {
        expect(linked.length).toBe(0)
      }
      // Fixtures list a sample of responses, so a matched participant may have
      // theirs omitted; what must never happen is more than the row claims.
      expect(linked.length).toBeLessThanOrEqual(participant.responses)
    }
  })

  it('matches duplicate candidates on contact fields and never on a name', () => {
    for (const pair of DUPLICATES) {
      expect(['phone_and_email', 'phone_only', 'email_only']).toContain(pair.matchBasis)

      if (pair.matchBasis !== 'email_only') {
        expect(pair.left.phone).toBe(pair.right.phone)
      }
      if (pair.matchBasis !== 'phone_only') {
        expect(pair.left.email).toBe(pair.right.email)
      }
    }

    // At least one pair has different names, proving names are not the basis.
    expect(DUPLICATES.some((pair) => pair.left.name !== pair.right.name)).toBe(true)
  })
})
