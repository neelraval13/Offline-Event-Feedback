import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  MISSING_MIGRATION_URL_MESSAGE,
  readServerConfig,
  resolveMigrationDatabaseUrl,
} from './config.js'
import { REPORTING_SECRET_MIN_LENGTH } from './reporting/auth.js'

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

  it('refuses a reporting secret that is too short to be one', () => {
    /*
     * Asserted here and not only against `describeSecretWeakness`, because the
     * rule only protects anything if `readServerConfig` refuses to start on it.
     * A weak reporting secret is the whole event's contact details behind a
     * guessable string, so this fails startup rather than warning.
     */
    const result = readServerConfig({
      DATABASE_URL,
      SYNC_ENROLLMENT_SECRET: ENROLMENT,
      REPORTING_ADMIN_SECRET: 'a'.repeat(REPORTING_SECRET_MIN_LENGTH - 1),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problem).toContain('REPORTING_ADMIN_SECRET')
      expect(result.problem).toContain(String(REPORTING_SECRET_MIN_LENGTH))
    }
  })

  it('accepts a reporting secret of exactly the minimum length', () => {
    // The boundary belongs to the valid side; `<` is the rule, not `<=`.
    const result = readServerConfig({
      DATABASE_URL,
      SYNC_ENROLLMENT_SECRET: ENROLMENT,
      REPORTING_ADMIN_SECRET: 'b'.repeat(REPORTING_SECRET_MIN_LENGTH),
    })

    expect(result.ok).toBe(true)
  })

  it('never puts a value in a problem message', () => {
    // Startup errors are read in terminals, pasted into tickets and captured by
    // process supervisors. A connection string in one has escaped.
    const result = readServerConfig({
      DATABASE_URL,
      SYNC_ENROLLMENT_SECRET: ENROLMENT,
      REPORTING_ADMIN_SECRET: 'short',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problem).not.toContain(DATABASE_URL)
      expect(result.problem).not.toContain(ENROLMENT)
      expect(result.problem).not.toContain('short')
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
