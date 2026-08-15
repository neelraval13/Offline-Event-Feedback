import postgres, { type Sql } from 'postgres'
import type { ServerRuntime } from '../config.js'

/*
 * The Postgres client, with the two runtimes' settings written down rather than
 * inherited by accident.
 *
 * The difference is not cosmetic. A long-lived Node server is one process
 * holding one pool for as long as the event lasts; a Vercel function is many
 * short-lived instances, each of which can open its own connections, and a
 * database has a finite number of them.
 */

export interface DatabaseClientOptions {
  readonly url: string
  readonly runtime: ServerRuntime
}

export function createDatabaseClient({ url, runtime }: DatabaseClientOptions): Sql {
  if (runtime === 'local') {
    /*
     * One process, one pool, open for the whole event. Ten connections is
     * generous for a handful of tablets and leaves headroom for the reporting
     * screen running alongside them.
     */
    return postgres(url, { max: 10, onnotice: () => {} })
  }

  /*
   * Serverless.
   *
   * `max: 1` caps each warm function instance at one Postgres connection.
   *
   * It is deliberately NOT an assumption that one request means one instance.
   * Vercel's Fluid Compute model lets a single warm instance serve several
   * requests at once, so concurrent database work inside an instance queues
   * behind this one connection rather than opening more. That trade is chosen on
   * purpose: bounded connection usage is the property worth guaranteeing, and
   * Neon's pooler already multiplexes between application clients and Postgres,
   * so the pooling that matters happens there rather than here.
   *
   * If production load testing shows requests queueing on the connection rather
   * than on the database, this is the number to raise, with the pooler's own
   * limits in view, not in isolation.
   *
   * `idle_timeout` returns a connection Neon's pooler can hand to someone else
   * while this instance sits warm but idle between requests. `connect_timeout`
   * fails a request rather than letting it hang until the platform kills it,
   * which produces a diagnosable error instead of a timeout.
   *
   * `prepare: false` is a conservative choice, not a compatibility requirement.
   * Neon's pooled endpoint does support protocol-level prepared statements, so
   * this could be left on, but nothing in this application depends on
   * prepared-statement reuse: the queries are per-request and short, and the
   * saving would be invisible next to a network round trip to the database.
   * Turning it off removes a class of pooled-connection surprise for no
   * measurable cost. It can be revisited if a real workload asks for it.
   */
  return postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
  })
}
