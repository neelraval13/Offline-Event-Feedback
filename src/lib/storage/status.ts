import { DB_NAME, DB_VERSION, type OfflineEventDb } from './db'

export type DatabaseState = 'ready' | 'unavailable'

export interface DatabaseStatus {
  readonly name: string
  /** Schema version the code expects. */
  readonly expectedVersion: number
  /** Schema version actually open, once the database has opened. */
  readonly openVersion: number | null
  readonly state: DatabaseState
  /** Why the database is unavailable, when it is. */
  readonly message?: string
}

/**
 * Opens the database and reports whether local storage is usable.
 *
 * Worth surfacing to staff rather than logging: a browser in private mode, one
 * with site data blocked, or one that has hit a storage quota will fail here —
 * and a registration desk that cannot persist must not start taking
 * participants (invariant 1).
 */
export async function getDatabaseStatus(
  database: OfflineEventDb,
): Promise<DatabaseStatus> {
  try {
    await database.open()
    return {
      name: database.name,
      expectedVersion: DB_VERSION,
      openVersion: database.verno,
      state: 'ready',
    }
  } catch (error) {
    return {
      name: database.name || DB_NAME,
      expectedVersion: DB_VERSION,
      openVersion: null,
      state: 'unavailable',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
