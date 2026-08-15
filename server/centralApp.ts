import type { Hono } from 'hono'
import type { Sql } from 'postgres'
import { createApp } from './app.js'
import { createDatabaseClient } from './db/client.js'
import { createPostgresStore } from './db/postgresStore.js'
import type { ServerConfig, ServerRuntime } from './config.js'

/*
 * The central API, assembled once.
 *
 * `createApp` in `app.ts` is deliberately about routes and knows nothing about
 * environments or connection strings. This module is the other half: it turns a
 * validated {@link ServerConfig} into a running application, and it is what both
 * runtimes call.
 *
 * The point of it existing is that the local server and the Vercel function
 * cannot drift. Two hand-written `createApp({...})` call sites is how a
 * deployment ends up with reporting enabled in one runtime and not the other,
 * or with a health check that answers differently depending on where it runs,
 * and the one that is wrong is always the one nobody tests locally.
 *
 * Listening is not here. A Node server binds a port; a function is handed a
 * request. That difference belongs to each runtime.
 */

export interface CentralApp {
  readonly app: Hono
  /**
   * The client this app is using.
   *
   * Exposed so the local runtime can close it on shutdown. The serverless
   * runtime deliberately does not: closing between invocations would throw away
   * the connection a warm instance is meant to reuse.
   */
  readonly sql: Sql
}

export interface CreateCentralAppOptions {
  readonly config: ServerConfig
  readonly runtime: ServerRuntime
  readonly log?: (line: string) => void
}

export function createCentralApp({
  config,
  runtime,
  log,
}: CreateCentralAppOptions): CentralApp {
  const sql = createDatabaseClient({ url: config.databaseUrl, runtime })

  const app = createApp({
    store: createPostgresStore(sql),
    enrollmentSecret: config.enrollmentSecret,
    allowedOrigins: config.allowedOrigins,
    sql,
    ...(config.reportingSecret === undefined
      ? {}
      : { reportingSecret: config.reportingSecret }),
    ...(log === undefined ? {} : { log }),
    checkDatabase: async () => {
      await sql`SELECT 1`
      return true
    },
  })

  return { app, sql }
}

/** One line an operator can read at startup. Names and states, never values. */
export function describeConfiguration(
  config: ServerConfig,
  runtime: ServerRuntime,
): string {
  const origins =
    config.allowedOrigins.length === 0
      ? 'same-origin only'
      : config.allowedOrigins.join(', ')

  return (
    `runtime: ${runtime}; cross-origin: ${origins}; ` +
    `reporting: ${config.reportingSecret === undefined ? 'disabled' : 'enabled'}`
  )
}
