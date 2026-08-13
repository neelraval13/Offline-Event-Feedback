import type { Sql } from 'postgres'
import type {
  CentralFeedback,
  CentralRegistration,
  EnrolledDevice,
  SyncStore,
} from '../sync/store'

/*
 * The Postgres implementation.
 *
 * Concurrency is handled by the database, not by application logic. Every write
 * is a single statement — `INSERT ... ON CONFLICT DO NOTHING` and updates
 * conditional on the revision that was read — so two devices uploading the same
 * record at the same instant produce one row and two deterministic answers.
 *
 * A read-then-write in application code would be a race with no lock behind it.
 *
 * `postgres` (porsager) is used as a plain tagged-template SQL client. Its
 * templates parameterise automatically, so values never reach the server as
 * concatenated SQL. No ORM: the interesting logic here is conditional upserts
 * expressed exactly as written, and an ORM would obscure the very statements
 * the correctness depends on.
 */

type Row = Record<string, unknown>

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

/** Postgres `DATE` comes back as a Date; the wire format is `YYYY-MM-DD`. */
function toDay(value: unknown): string {
  return value instanceof Date
    ? (value.toISOString().slice(0, 10) as string)
    : String(value).slice(0, 10)
}

function mapRegistration(row: Row): CentralRegistration {
  return {
    kind: 'registration',
    recordId: String(row['record_id']),
    participantId: String(row['participant_id']),
    publicCode: String(row['public_code']),
    eventId: String(row['event_id']),
    eventDay: toDay(row['event_day']),
    stationId: String(row['station_id']),
    deviceId: String(row['source_device_id']),
    name: String(row['name']),
    phone: String(row['phone']),
    email: String(row['email']),
    createdAt: toIso(row['created_at']),
    updatedAt: toIso(row['updated_at']),
    revision: Number(row['revision']),
    firstReceivedAt: toIso(row['first_received_at']),
    lastReceivedAt: toIso(row['last_received_at']),
    lastUploaderDeviceId: String(row['last_uploader_device_id']),
  }
}

function mapFeedback(row: Row): CentralFeedback {
  const participantId = row['participant_id']

  return {
    kind: 'feedback',
    recordId: String(row['record_id']),
    ...(participantId === null || participantId === undefined
      ? {}
      : { participantId: String(participantId) }),
    publicCode: String(row['public_code']),
    captureMethod: String(row['capture_method']) as 'qr' | 'manual',
    eventId: String(row['event_id']),
    eventDay: toDay(row['event_day']),
    stationId: String(row['station_id']),
    deviceId: String(row['source_device_id']),
    formVersion: 'feedback-v1',
    answers: row['answers'] as CentralFeedback['answers'],
    createdAt: toIso(row['created_at']),
    updatedAt: toIso(row['updated_at']),
    revision: Number(row['revision']),
    firstReceivedAt: toIso(row['first_received_at']),
    lastReceivedAt: toIso(row['last_received_at']),
    lastUploaderDeviceId: String(row['last_uploader_device_id']),
  }
}

export function createPostgresStore(sql: Sql): SyncStore {
  return {
    async findDevice(eventId, uploaderDeviceId) {
      const rows = await sql<Row[]>`
        SELECT event_id, uploader_device_id, token_hash, revoked_at
        FROM sync_devices
        WHERE event_id = ${eventId}
          AND uploader_device_id = ${uploaderDeviceId}
      `

      const row = rows[0]
      if (row === undefined) {
        return null
      }

      const device: EnrolledDevice = {
        eventId: String(row['event_id']),
        uploaderDeviceId: String(row['uploader_device_id']),
        tokenHash: String(row['token_hash']),
        revokedAt:
          row['revoked_at'] === null || row['revoked_at'] === undefined
            ? null
            : toIso(row['revoked_at']),
      }
      return device
    },

    async enrollDevice({ eventId, uploaderDeviceId, tokenHash }) {
      // Re-enrolling replaces the token and clears any revocation.
      await sql`
        INSERT INTO sync_devices (event_id, uploader_device_id, token_hash)
        VALUES (${eventId}, ${uploaderDeviceId}, ${tokenHash})
        ON CONFLICT (event_id, uploader_device_id)
        DO UPDATE SET token_hash = EXCLUDED.token_hash,
                      created_at = now(),
                      revoked_at = NULL
      `
    },

    async touchDevice(eventId, uploaderDeviceId) {
      await sql`
        UPDATE sync_devices SET last_seen_at = now()
        WHERE event_id = ${eventId} AND uploader_device_id = ${uploaderDeviceId}
      `
    },

    async getRegistration(recordId) {
      const rows = await sql<Row[]>`
        SELECT * FROM registrations WHERE record_id = ${recordId}
      `
      const row = rows[0]
      return row === undefined ? null : mapRegistration(row)
    },

    async insertRegistration(record, receivedAt, uploaderDeviceId) {
      /*
       * One statement. If a concurrent request inserted first, this returns no
       * rows rather than raising, and the caller re-reads and compares.
       */
      const inserted = await sql<Row[]>`
        INSERT INTO registrations (
          record_id, participant_id, public_code,
          event_id, event_day, station_id, source_device_id,
          name, phone, email,
          created_at, updated_at, revision,
          first_received_at, last_received_at, last_uploader_device_id
        ) VALUES (
          ${record.recordId}, ${record.participantId}, ${record.publicCode},
          ${record.eventId}, ${record.eventDay}, ${record.stationId}, ${record.deviceId},
          ${record.name}, ${record.phone}, ${record.email},
          ${record.createdAt}, ${record.updatedAt}, ${record.revision},
          ${receivedAt}, ${receivedAt}, ${uploaderDeviceId}
        )
        ON CONFLICT DO NOTHING
        RETURNING record_id
      `

      if (inserted.length > 0) {
        return { outcome: 'inserted' }
      }

      // Nothing inserted: either this record already exists, or a *different*
      // record already claims its participant ID or public code.
      const existing = await sql<Row[]>`
        SELECT record_id FROM registrations WHERE record_id = ${record.recordId}
      `
      if (existing.length > 0) {
        return { outcome: 'exists' }
      }

      const claimedByParticipant = await sql<Row[]>`
        SELECT record_id FROM registrations
        WHERE event_id = ${record.eventId} AND participant_id = ${record.participantId}
      `
      if (claimedByParticipant.length > 0) {
        return { outcome: 'claimed', by: 'participant_id' }
      }

      return { outcome: 'claimed', by: 'public_code' }
    },

    async updateRegistration(record, expectedRevision, receivedAt, uploaderDeviceId) {
      // Conditional on the revision that was read: a concurrent update that
      // moved it first leaves this a no-op.
      const updated = await sql<Row[]>`
        UPDATE registrations SET
          name = ${record.name},
          phone = ${record.phone},
          email = ${record.email},
          updated_at = ${record.updatedAt},
          revision = ${record.revision},
          last_received_at = ${receivedAt},
          last_uploader_device_id = ${uploaderDeviceId}
        WHERE record_id = ${record.recordId}
          AND revision = ${expectedRevision}
        RETURNING record_id
      `

      return updated.length > 0
    },

    async touchRegistration(recordId, receivedAt, uploaderDeviceId) {
      await sql`
        UPDATE registrations
        SET last_received_at = ${receivedAt},
            last_uploader_device_id = ${uploaderDeviceId}
        WHERE record_id = ${recordId}
      `
    },

    async getFeedback(recordId) {
      const rows = await sql<Row[]>`
        SELECT * FROM feedback WHERE record_id = ${recordId}
      `
      const row = rows[0]
      return row === undefined ? null : mapFeedback(row)
    },

    async insertFeedback(record, receivedAt, uploaderDeviceId) {
      const inserted = await sql<Row[]>`
        INSERT INTO feedback (
          record_id, participant_id, public_code, capture_method,
          event_id, event_day, station_id, source_device_id,
          form_version, answers,
          created_at, updated_at, revision,
          first_received_at, last_received_at, last_uploader_device_id
        ) VALUES (
          ${record.recordId}, ${record.participantId ?? null}, ${record.publicCode},
          ${record.captureMethod},
          ${record.eventId}, ${record.eventDay}, ${record.stationId}, ${record.deviceId},
          ${record.formVersion}, ${sql.json(record.answers)},
          ${record.createdAt}, ${record.updatedAt}, ${record.revision},
          ${receivedAt}, ${receivedAt}, ${uploaderDeviceId}
        )
        ON CONFLICT (record_id) DO NOTHING
        RETURNING record_id
      `

      return inserted.length > 0 ? { outcome: 'inserted' } : { outcome: 'exists' }
    },

    async updateFeedback(record, expectedRevision, receivedAt, uploaderDeviceId) {
      const updated = await sql<Row[]>`
        UPDATE feedback SET
          form_version = ${record.formVersion},
          answers = ${sql.json(record.answers)},
          updated_at = ${record.updatedAt},
          revision = ${record.revision},
          last_received_at = ${receivedAt},
          last_uploader_device_id = ${uploaderDeviceId}
        WHERE record_id = ${record.recordId}
          AND revision = ${expectedRevision}
        RETURNING record_id
      `

      return updated.length > 0
    },

    async touchFeedback(recordId, receivedAt, uploaderDeviceId) {
      await sql`
        UPDATE feedback
        SET last_received_at = ${receivedAt},
            last_uploader_device_id = ${uploaderDeviceId}
        WHERE record_id = ${recordId}
      `
    },

    async recordBatch(audit) {
      // Counts only — never a record, never a participant.
      await sql`
        INSERT INTO sync_batches (
          batch_id, event_id, uploader_device_id, received_at,
          accepted_count, already_current_count, server_newer_count,
          conflict_count, invalid_count
        ) VALUES (
          ${audit.batchId}, ${audit.eventId}, ${audit.uploaderDeviceId},
          ${audit.receivedAt}, ${audit.accepted}, ${audit.alreadyCurrent},
          ${audit.serverNewer}, ${audit.conflict}, ${audit.invalid}
        )
        ON CONFLICT (batch_id) DO NOTHING
      `
    },
  }
}
