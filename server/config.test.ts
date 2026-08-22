import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  MISSING_MIGRATION_URL_MESSAGE,
  readServerConfig,
  resolveMigrationDatabaseUrl,
} from './config.js'
import { authorizeReporting } from './reporting/auth.js'

/*
 * Configuration, which both runtimes read through this one module.
 *
 * Pure and injectable, so the rules are tested directly rather than by starting
 * a process and reading its stderr, and so a rule cannot be true of the local
 * server and false of the deployed function.
 */

const DATABASE_URL = 'postgres://user:pw@db.example/app'
const ENROLMENT = 'an-enrolment-code-of-adequate-length'
const REPORTING = randomBytes(32).toString('hex')

describe('readServerConfig', () => {
  it('accepts a complete environment', () => {
    const result = readServerConfig({
      DATABASE_URL,
      SYNC_ENROLLMENT_SECRET: ENROLMENT,
      REPORTING_ADMIN_SECRET: REPORTING,
      SYNC_ALLOWED_ORIGINS: 'http://localhost:5173, http://localhost:4173',
      PORT: '8788',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.allowedOrigins).toEqual([
        'http://localhost:5173',
        'http://localhost:4173',
      ])
      expect(result.config.port).toBe(8788)
      expect(result.config.reportingSecret).toBe(REPORTING)
    }
  })

  it('treats an empty origin list as same-origin only', () => {
    /*
     * Production is one origin serving both the app and the API, so there is
     * nothing to allow-list. Requiring a value here would mean a deployment
     * could not start without inventing one, and would tempt someone into
     * pasting a generated preview hostname, or a wildcard.
     */
    const result = readServerConfig({
      DATABASE_URL,
      SYNC_ENROLLMENT_SECRET: ENROLMENT,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.allowedOrigins).toEqual([])
    }
  })

  it('runs without reporting configured', () => {
    // Reporting fails closed; sync is unaffected.
    const result = readServerConfig({
      DATABASE_URL,
      SYNC_ENROLLMENT_SECRET: ENROLMENT,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.reportingSecret).toBeUndefined()
    }
  })

  it('names a missing variable without printing anything else', () => {
    const missingDatabase = readServerConfig({
      SYNC_ENROLLMENT_SECRET: ENROLMENT,
    })
    const missingEnrolment = readServerConfig({ DATABASE_URL })

    expect(missingDatabase.ok).toBe(false)
    expect(!missingDatabase.ok && missingDatabase.problem).toContain(
      'DATABASE_URL',
    )
    expect(missingEnrolment.ok).toBe(false)
    expect(!missingEnrolment.ok && missingEnrolment.problem).toContain(
      'SYNC_ENROLLMENT_SECRET',
    )
  })

  it('accepts a short reporting secret, so long as it differs', () => {
    /*
     * These two assertions replace a rule that failed startup below 32
     * characters. The values here are the point: an operator setting this by
     * hand at a venue gets to choose something they can actually type.
     */
    for (const secret of ['x', 'flea26', 'correct-horse-battery']) {
      const result = readServerConfig({
        DATABASE_URL,
        SYNC_ENROLLMENT_SECRET: ENROLMENT,
        REPORTING_ADMIN_SECRET: secret,
      })

      expect(result.ok, `rejected ${secret.length}-character secret`).toBe(true)
      if (result.ok) {
        expect(result.config.reportingSecret).toBe(secret)
      }
    }
  })

  it('accepts a short enrolment code, whose contract is only non-empty', () => {
    const result = readServerConfig({
      DATABASE_URL,
      SYNC_ENROLLMENT_SECRET: 'abc',
      REPORTING_ADMIN_SECRET: 'xyz',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.enrollmentSecret).toBe('abc')
    }
  })

  it('never puts a value in a problem message', () => {
    // Startup errors are read in terminals, pasted into tickets and captured by
    // process supervisors. A connection string in one has escaped.
    const result = readServerConfig({
      DATABASE_URL,
      SYNC_ENROLLMENT_SECRET: ENROLMENT,
      REPORTING_ADMIN_SECRET: ENROLMENT, // the one remaining configuration error
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problem).not.toContain(DATABASE_URL)
      expect(result.problem).not.toContain(ENROLMENT)
    }
  })

  it('refuses a reporting secret that is the enrolment code', () => {
    const shared = randomBytes(32).toString('hex')
    const result = readServerConfig({
      DATABASE_URL,
      SYNC_ENROLLMENT_SECRET: shared,
      REPORTING_ADMIN_SECRET: shared,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problem).toContain('SYNC_ENROLLMENT_SECRET')
      expect(result.problem).not.toContain(shared)
    }
  })

  it('rejects a port that is not a port', () => {
    const result = readServerConfig({
      DATABASE_URL,
      SYNC_ENROLLMENT_SECRET: ENROLMENT,
      PORT: 'eight thousand',
    })

    expect(result.ok).toBe(false)
  })
})

/*
 * The secret contract, stated as the four cases an operator can actually
 * produce. Deliberately spelled out with tiny values: the whole point of this
 * change is that short, memorable, hand-typed values are legitimate.
 *
 * These literals are examples in a test file. They are not, and must never
 * become, real deployment values.
 */
describe('the secret contract', () => {
  it('accepts two different short secrets', () => {
    const result = readServerConfig({
      DATABASE_URL,
      SYNC_ENROLLMENT_SECRET: 'abc',
      REPORTING_ADMIN_SECRET: 'xyz',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.enrollmentSecret).toBe('abc')
      expect(result.config.reportingSecret).toBe('xyz')
    }
  })

  it('rejects the two secrets being the same value', () => {
    // The security boundary this whole design rests on. Length never protected
    // against this, and removing the length rule does not weaken it.
    const result = readServerConfig({
      DATABASE_URL,
      SYNC_ENROLLMENT_SECRET: 'abc',
      REPORTING_ADMIN_SECRET: 'abc',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problem).toContain('REPORTING_ADMIN_SECRET')
      expect(result.problem).toContain('SYNC_ENROLLMENT_SECRET')
      expect(result.problem).not.toContain('abc')
    }
  })

  it('rejects a missing enrolment code even when reporting is set', () => {
    for (const enrolment of ['', undefined]) {
      const result = readServerConfig({
        DATABASE_URL,
        ...(enrolment === undefined ? {} : { SYNC_ENROLLMENT_SECRET: enrolment }),
        REPORTING_ADMIN_SECRET: 'xyz',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.problem).toContain('SYNC_ENROLLMENT_SECRET')
      }
    }
  })

  it('starts with reporting switched off when its secret is empty', () => {
    const result = readServerConfig({
      DATABASE_URL,
      SYNC_ENROLLMENT_SECRET: 'abc',
      REPORTING_ADMIN_SECRET: '',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.reportingSecret).toBeUndefined()
    }
    // And "off" means no reporting request succeeds, not that it is public.
    expect(authorizeReporting('Bearer anything', undefined)).toEqual({
      ok: false,
      reason: 'not_configured',
    })
  })
})

describe('resolveMigrationDatabaseUrl', () => {
  const MIGRATION = 'postgres://direct.example/app'
  const UNPOOLED = 'postgres://unpooled.example/app'
  const POOLED = 'postgres://pooled.example/app'

  it('prefers the operator’s explicit choice', () => {
    const resolved = resolveMigrationDatabaseUrl({
      MIGRATION_DATABASE_URL: MIGRATION,
      DATABASE_URL_UNPOOLED: UNPOOLED,
      DATABASE_URL: POOLED,
    })

    expect(resolved.url).toBe(MIGRATION)
    expect(resolved.source).toBe('MIGRATION_DATABASE_URL')
  })

  it('falls back to the unpooled URL Neon exports', () => {
    const resolved = resolveMigrationDatabaseUrl({
      DATABASE_URL_UNPOOLED: UNPOOLED,
      DATABASE_URL: POOLED,
    })

    expect(resolved.url).toBe(UNPOOLED)
    expect(resolved.source).toBe('DATABASE_URL_UNPOOLED')
  })

  it('falls back to DATABASE_URL for a single local database', () => {
    const resolved = resolveMigrationDatabaseUrl({ DATABASE_URL: POOLED })

    expect(resolved.url).toBe(POOLED)
    expect(resolved.source).toBe('DATABASE_URL')
  })

  it('ignores a variable that is set but empty', () => {
    const resolved = resolveMigrationDatabaseUrl({
      MIGRATION_DATABASE_URL: '',
      DATABASE_URL: POOLED,
    })

    expect(resolved.source).toBe('DATABASE_URL')
  })

  it('reports nothing found, naming the variables and no values', () => {
    const resolved = resolveMigrationDatabaseUrl({})

    expect(resolved.url).toBeNull()
    expect(resolved.source).toBeNull()
    expect(MISSING_MIGRATION_URL_MESSAGE).toContain('MIGRATION_DATABASE_URL')
    expect(MISSING_MIGRATION_URL_MESSAGE).toContain('DATABASE_URL_UNPOOLED')
    expect(MISSING_MIGRATION_URL_MESSAGE).toContain('DATABASE_URL')
  })
})
