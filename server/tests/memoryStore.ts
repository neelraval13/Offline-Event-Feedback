import type {
  FeedbackWireRecord,
  RegistrationWireRecord,
} from '../../shared/sync/protocol'
import type {
  CentralFeedback,
  CentralRegistration,
  EnrolledDevice,
  InsertOutcome,
  SyncStore,
} from '../sync/store'

/*
 * An in-memory store with the same atomicity contract as the SQL one.
 *
 * Every write here is synchronous and therefore indivisible, which is exactly
 * what `INSERT ... ON CONFLICT DO NOTHING` and a revision-conditional `UPDATE`
 * give in Postgres. That lets the merge semantics — including two devices
 * uploading the same record at once — be exercised exhaustively without a
 * database.
 *
 * What it cannot prove is that the SQL is written correctly. That is what the
 * real-Postgres pass in docs/sync-test.md is for, and the limitation is stated
 * there rather than papered over.
 */

export interface MemoryStore extends SyncStore {
  readonly registrations: Map<string, CentralRegistration>
  readonly feedback: Map<string, CentralFeedback>
  readonly devices: Map<string, EnrolledDevice>
  readonly batches: { batchId: string; accepted: number }[]
  revoke(eventId: string, uploaderDeviceId: string): void
}

const deviceKey = (eventId: string, deviceId: string) => `${eventId}::${deviceId}`

export function createMemoryStore(): MemoryStore {
  const registrations = new Map<string, CentralRegistration>()
  const feedback = new Map<string, CentralFeedback>()
  const devices = new Map<string, EnrolledDevice>()
  const batches: { batchId: string; accepted: number }[] = []

  return {
    registrations,
    feedback,
    devices,
    batches,

    revoke(eventId, uploaderDeviceId) {
      const key = deviceKey(eventId, uploaderDeviceId)
      const device = devices.get(key)
      if (device !== undefined) {
        devices.set(key, { ...device, revokedAt: new Date().toISOString() })
      }
    },

    async findDevice(eventId, uploaderDeviceId) {
      return devices.get(deviceKey(eventId, uploaderDeviceId)) ?? null
    },

    async enrollDevice({ eventId, uploaderDeviceId, tokenHash }) {
      devices.set(deviceKey(eventId, uploaderDeviceId), {
        eventId,
        uploaderDeviceId,
        tokenHash,
        revokedAt: null,
      })
    },

    async touchDevice() {
      /* last_seen_at is not asserted on in tests. */
    },

    async getRegistration(recordId) {
      return registrations.get(recordId) ?? null
    },

    async insertRegistration(
      record: RegistrationWireRecord,
      receivedAt,
      uploaderDeviceId,
    ): Promise<InsertOutcome> {
      if (registrations.has(record.recordId)) {
        return { outcome: 'exists' }
      }

      // The unique indexes, enforced here as they are in Postgres.
      for (const existing of registrations.values()) {
        if (existing.eventId !== record.eventId) {
          continue
        }
        if (existing.participantId === record.participantId) {
          return { outcome: 'claimed', by: 'participant_id' }
        }
        if (existing.publicCode === record.publicCode) {
          return { outcome: 'claimed', by: 'public_code' }
        }
      }

      registrations.set(record.recordId, {
        ...record,
        firstReceivedAt: receivedAt,
        lastReceivedAt: receivedAt,
        lastUploaderDeviceId: uploaderDeviceId,
      })
      return { outcome: 'inserted' }
    },

    async updateRegistration(record, expectedRevision, receivedAt, uploaderDeviceId) {
      const existing = registrations.get(record.recordId)
      if (existing === undefined || existing.revision !== expectedRevision) {
        return false
      }

      registrations.set(record.recordId, {
        ...existing,
        name: record.name,
        phone: record.phone,
        email: record.email,
        updatedAt: record.updatedAt,
        revision: record.revision,
        lastReceivedAt: receivedAt,
        lastUploaderDeviceId: uploaderDeviceId,
      })
      return true
    },

    async touchRegistration(recordId, receivedAt, uploaderDeviceId) {
      const existing = registrations.get(recordId)
      if (existing !== undefined) {
        registrations.set(recordId, {
          ...existing,
          lastReceivedAt: receivedAt,
          lastUploaderDeviceId: uploaderDeviceId,
        })
      }
    },

    async getFeedback(recordId) {
      return feedback.get(recordId) ?? null
    },

    async insertFeedback(
      record: FeedbackWireRecord,
      receivedAt,
      uploaderDeviceId,
    ): Promise<InsertOutcome> {
      if (feedback.has(record.recordId)) {
        return { outcome: 'exists' }
      }

      // No uniqueness on publicCode: two terminals may each hold a response
      // for one participant, and both must survive.
      feedback.set(record.recordId, {
        ...record,
        firstReceivedAt: receivedAt,
        lastReceivedAt: receivedAt,
        lastUploaderDeviceId: uploaderDeviceId,
      })
      return { outcome: 'inserted' }
    },

    async updateFeedback(record, expectedRevision, receivedAt, uploaderDeviceId) {
      const existing = feedback.get(record.recordId)
      if (existing === undefined || existing.revision !== expectedRevision) {
        return false
      }

      feedback.set(record.recordId, {
        ...existing,
        formVersion: record.formVersion,
        answers: record.answers,
        updatedAt: record.updatedAt,
        revision: record.revision,
        lastReceivedAt: receivedAt,
        lastUploaderDeviceId: uploaderDeviceId,
      })
      return true
    },

    async touchFeedback(recordId, receivedAt, uploaderDeviceId) {
      const existing = feedback.get(recordId)
      if (existing !== undefined) {
        feedback.set(recordId, {
          ...existing,
          lastReceivedAt: receivedAt,
          lastUploaderDeviceId: uploaderDeviceId,
        })
      }
    },

    async recordBatch(audit) {
      batches.push({ batchId: audit.batchId, accepted: audit.accepted })
    },
  }
}
