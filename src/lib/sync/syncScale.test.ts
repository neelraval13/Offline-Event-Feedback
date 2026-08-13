import { describe, expect, it } from 'vitest'
import { chunkRecords } from './syncWorker'
import { toFeedbackWire, toRegistrationWire } from './wire'
import {
  MAX_BATCH_RECORDS,
  SYNC_PROTOCOL_VERSION,
  syncBatchSchema,
} from '../../../shared/sync/protocol'
import {
  makeFeedback,
  makeRegistration,
  SOURCE_DEVICE,
} from '../backup/testFixtures'
import { newRecordId } from '../identity/uuid'
import { EVENT_CONFIG } from '../../config/event'

/*
 * A full event through the batching logic.
 *
 * Structural: no requests are made. Nineteen thousand real round trips would
 * prove nothing that nineteen thousand real records through the batcher does
 * not, and would take minutes.
 */

const REGISTRATIONS = 10_000
const FEEDBACK = 9_000

describe(`a full event of ${REGISTRATIONS.toLocaleString()} registrations`, () => {
  it('batches every record exactly once, within the limit', () => {
    const registrations = Array.from({ length: REGISTRATIONS }, (_, i) =>
      toRegistrationWire(makeRegistration(i + 1)),
    )
    const feedback = Array.from({ length: FEEDBACK }, (_, i) =>
      toFeedbackWire(makeFeedback(makeRegistration(i + 1))),
    )
    const all = [...registrations, ...feedback]

    const batches = chunkRecords(all)

    // Nothing dropped, nothing sent twice.
    const sent = batches.flatMap((batch) => batch.map((record) => record.recordId))
    expect(sent).toHaveLength(all.length)
    expect(new Set(sent).size).toBe(all.length)

    // Every batch is one the server will accept.
    expect(batches.every((batch) => batch.length <= MAX_BATCH_RECORDS)).toBe(true)
    expect(batches).toHaveLength(Math.ceil(all.length / MAX_BATCH_RECORDS))

    const serialised = JSON.stringify({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      batchId: newRecordId(),
      eventId: EVENT_CONFIG.eventId,
      uploaderDeviceId: SOURCE_DEVICE,
      records: batches[0],
    })

    console.info(
      [
        '',
        `  scale: ${all.length.toLocaleString()} records`,
        `  batches          ${batches.length} (limit ${MAX_BATCH_RECORDS}/batch)`,
        `  largest batch    ${Math.max(...batches.map((b) => b.length))} records`,
        `  request payload  ${(serialised.length / 1024).toFixed(0)} KiB per batch`,
        `  total uploaded   ${((serialised.length * batches.length) / (1024 * 1024)).toFixed(1)} MB`,
        '',
      ].join('\n'),
    )

    // A single request stays small enough for a venue's uplink.
    expect(serialised.length).toBeLessThan(256 * 1024)
  })

  it('produces batches the shared schema accepts', () => {
    // The client and the server validate against the same definition, so a
    // batch that fails here would fail at the server too.
    const records = Array.from({ length: MAX_BATCH_RECORDS }, (_, i) =>
      toRegistrationWire(makeRegistration(i + 1)),
    )

    const parsed = syncBatchSchema.safeParse({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      batchId: newRecordId(),
      eventId: EVENT_CONFIG.eventId,
      uploaderDeviceId: SOURCE_DEVICE,
      records,
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects a batch one record over the limit', () => {
    const records = Array.from({ length: MAX_BATCH_RECORDS + 1 }, (_, i) =>
      toRegistrationWire(makeRegistration(i + 1)),
    )

    const parsed = syncBatchSchema.safeParse({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      batchId: newRecordId(),
      eventId: EVENT_CONFIG.eventId,
      uploaderDeviceId: SOURCE_DEVICE,
      records,
    })

    expect(parsed.success).toBe(false)
  })
})
