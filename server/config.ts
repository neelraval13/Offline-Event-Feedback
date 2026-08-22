import { describeReportingConfigProblem } from './reporting/auth.js'

/*
 * Server configuration, read once and validated once.
 *
 * Two runtimes consume this: the long-lived local Node server
 * (`server/index.ts`) and the Vercel function (`api/[...path].ts`). They differ
 * in how they listen and how they talk to Postgres, and in nothing else, so
 * every rule about what a valid configuration *is* lives here, and neither
 * runtime restates it.
 *
 * Nothing in this module logs a value. Messages name the variable that is wrong
 * and stop there: a startup error is read in a terminal, copied into a ticket
 * and captured by a process supervisor, and a connection string or a secret
 * pasted into any of those has escaped.
 */

export type ServerRuntime = 'local' | 'serverless'

export interface ServerConfig {
  readonly databaseUrl: string
  readonly enrollmentSecret: string
  /** Absent means reporting fails closed; sync is unaffected. */
  readonly reportingSecret: string | undefined
  /**
   * Browser origins permitted to call the API cross-origin.
   *
   * Legitimately empty in production, where the app and the API are served from
   * one origin and CORS never enters the picture. Required only for the local
   * split-origin setup, a Vite dev server on :5173 calling an API on :8788,
   * and for any deliberately separate API host.
   */
  readonly allowedOrigins: readonly string[]
  readonly port: number
}

export type ServerConfigResult =
  | { readonly ok: true; readonly config: ServerConfig }
  | { readonly ok: false; readonly problem: string }

/** The environment, narrowed to what this reads. Injected so it is testable. */
export type Environment = Record<string, string | undefined>

function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}

/**
 * Validates the environment and produces the configuration both runtimes use.
 *
 * Returns a problem rather than exiting: a function cannot call `process.exit`
 * usefully, and a runtime that wants to exit can do so with the message.
 */
export function readServerConfig(env: Environment): ServerConfigResult {
  const databaseUrl = env['DATABASE_URL']
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    return { ok: false, problem: 'Missing required environment variable: DATABASE_URL' }
  }

  const enrollmentSecret = env['SYNC_ENROLLMENT_SECRET']
  if (enrollmentSecret === undefined || enrollmentSecret.length === 0) {
    return {
      ok: false,
      problem: 'Missing required environment variable: SYNC_ENROLLMENT_SECRET',
    }
  }

  /*
   * Reporting is optional, and when configured it must be genuinely separate
   * from the enrolment code. Checked before anything listens, because the
   * alternative is discovering it from the data.
   *
   * Length is deliberately not checked. These values are set by hand by the
   * people running the event, and a memorable password they can actually use is
   * worth more than a generated one that ends up written on the venue desk.
   */
  const reportingSecret = env['REPORTING_ADMIN_SECRET']
  const reportingProblem = describeReportingConfigProblem(
    reportingSecret,
    enrollmentSecret,
  )
  if (reportingProblem !== null) {
    return { ok: false, problem: reportingProblem }
  }

  const port = Number(env['PORT'] ?? 8788)
  if (!Number.isFinite(port) || port <= 0) {
    return { ok: false, problem: 'PORT is not a valid port number' }
  }

  return {
    ok: true,
    config: {
      databaseUrl,
      enrollmentSecret,
      reportingSecret:
        reportingSecret === undefined || reportingSecret.length === 0
          ? undefined
          : reportingSecret,
      allowedOrigins: parseOrigins(env['SYNC_ALLOWED_ORIGINS']),
      port,
    },
  }
}

/**
 * Which connection string migrations should use.
 *
 * Migrations want a **direct** connection, not a pooled one. Neon's pooled
 * endpoint runs PgBouncer in transaction mode, which cannot hold the
 * session-scoped state that `CREATE INDEX` and friends rely on, and which
 * silently changes how a long DDL statement behaves. The application wants the
 * pooled endpoint for exactly the opposite reason.
 *
 * The order lets one machine hold both without ambiguity, and lets a developer
 * with a single local Postgres keep setting only `DATABASE_URL`:
 *
 *   MIGRATION_DATABASE_URL   an operator's deliberate choice; always wins
 *   DATABASE_URL_UNPOOLED    the name Neon's own integration exports
 *   DATABASE_URL             local development, where there is only one
 */
export function resolveMigrationDatabaseUrl(env: Environment): {
  readonly url: string | null
  /** Which variable it came from, for an operator-facing log line. */
  readonly source: string | null
} {
  for (const name of [
    'MIGRATION_DATABASE_URL',
    'DATABASE_URL_UNPOOLED',
    'DATABASE_URL',
  ]) {
    const value = env[name]
    if (value !== undefined && value.length > 0) {
      return { url: value, source: name }
    }
  }

  return { url: null, source: null }
}

/** What to tell an operator who has set none of them. Names only, no values. */
export const MISSING_MIGRATION_URL_MESSAGE =
  'No migration connection string found. Set MIGRATION_DATABASE_URL (preferred: ' +
  'the direct, unpooled connection), or DATABASE_URL_UNPOOLED, or DATABASE_URL.'
