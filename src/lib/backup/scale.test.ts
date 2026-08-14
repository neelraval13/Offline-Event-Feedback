import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, destroyTestDb } from '../../test/db'
import type { OfflineEventDb } from '../storage'
import { createSnapshot, validateSnapshot } from './snapshot'
import { restoreBackup } from './restore'
import { encryptText, decryptText } from './crypto'
import { makeFeedback, makeRegistration, SOURCE_DEVICE } from './testFixtures'
import { EVENT_CONFIG } from '../../config/event'
import { deriveIssuerCode } from '../identity/issuerCode'

/*
 * The design target: roughly 10,000 participants.
 *
 * The expensive part of a real backup is PBKDF2, and that cost is fixed, one
 * derivation regardless of dataset size, so it is measured once in
 * crypto.test.ts rather than repeated here. What scales with the data is
 * snapshotting, validating, serialising and merging, and that is what this
 * measures.
 */

const PARTICIPANTS = 10_000
const FEEDBACK = 9_000

let database: OfflineEventDb

beforeEach(() => {
  database = createTestDb()
})

afterEach(async () => {
  await destroyTestDb(database)
})

async function seedAtScale(): Promise<void> {
  const registrations = Array.from({ length: PARTICIPANTS }, (_, i) =>
    makeRegistration(i + 1),
  )
  const feedback = registrations
    .slice(0, FEEDBACK)
    .map((registration) => makeFeedback(registration))

  await database.registrations.bulkAdd(registrations)
  await database.feedback.bulkAdd(feedback)
  await database.deviceConfig.put({
    key: 'deviceId',
    value: SOURCE_DEVICE,
    updatedAt: '2026-01-01T08:00:00.000Z',
  })
  await database.sequences.put({
    key: `publicCode:${EVENT_CONFIG.eventId}:${EVENT_CONFIG.eventDay}:A1:${deriveIssuerCode(SOURCE_DEVICE)}`,
    value: PARTICIPANTS,
  })
}

describe(`a full event of ${PARTICIPANTS.toLocaleString()} participants`, () => {
  it('snapshots, validates, serialises and restores within sensible time', async () => {
    await seedAtScale()

    const snapshotStart = performance.now()
    const snapshot = await createSnapshot(database)
    const snapshotMs = performance.now() - snapshotStart

    expect(snapshot.registrations).toHaveLength(PARTICIPANTS)
    expect(snapshot.feedback).toHaveLength(FEEDBACK)

    const validateStart = performance.now()
    const validation = validateSnapshot(snapshot)
    const validateMs = performance.now() - validateStart
    expect(validation.ok).toBe(true)

    const serialiseStart = performance.now()
    const json = JSON.stringify(snapshot)
    const serialiseMs = performance.now() - serialiseStart

    // One encryption at a low cost: AES-GCM throughput, without paying for the
    // fixed KDF cost that is measured elsewhere.
    const encryptStart = performance.now()
    const encrypted = await encryptText(json, 'a passphrase of sufficient length', 1_000)
    const encryptMs = performance.now() - encryptStart

    const decryptStart = performance.now()
    const decrypted = await decryptText(encrypted, 'a passphrase of sufficient length')
    const decryptMs = performance.now() - decryptStart
    expect(decrypted.ok).toBe(true)

    const replacement = createTestDb()
    let restoreMs = 0
    let secondRestoreMs = 0
    try {
      const restoreStart = performance.now()
      const restored = await restoreBackup(replacement, snapshot)
      restoreMs = performance.now() - restoreStart

      expect(restored.ok && restored.counts.registrationsAdded).toBe(PARTICIPANTS)
      expect(restored.ok && restored.counts.feedbackAdded).toBe(FEEDBACK)

      // The second restore is the idempotent path: every record compared, none
      // written. It is the slower of the two in practice.
      const secondStart = performance.now()
      const again = await restoreBackup(replacement, snapshot)
      secondRestoreMs = performance.now() - secondStart

      expect(again.ok && again.counts.registrationsUnchanged).toBe(PARTICIPANTS)
      expect(await replacement.registrations.count()).toBe(PARTICIPANTS)
    } finally {
      await destroyTestDb(replacement)
    }

    const megabytes = json.length / (1024 * 1024)
    const base64Megabytes = encrypted.ciphertext.length / (1024 * 1024)

    console.info(
      [
        '',
        `  scale: ${PARTICIPANTS.toLocaleString()} registrations + ${FEEDBACK.toLocaleString()} feedback`,
        `  plaintext        ${megabytes.toFixed(1)} MB`,
        `  encrypted (b64)  ${base64Megabytes.toFixed(1)} MB`,
        `  snapshot         ${snapshotMs.toFixed(0)} ms`,
        `  validate         ${validateMs.toFixed(0)} ms`,
        `  serialise        ${serialiseMs.toFixed(0)} ms`,
        `  encrypt          ${encryptMs.toFixed(0)} ms (excludes fixed KDF cost)`,
        `  decrypt          ${decryptMs.toFixed(0)} ms (excludes fixed KDF cost)`,
        `  restore (empty)  ${restoreMs.toFixed(0)} ms`,
        `  restore (repeat) ${secondRestoreMs.toFixed(0)} ms`,
        '',
      ].join('\n'),
    )

    /*
     * Generous ceilings. These are a guard against an accidental quadratic,
     * the kind that passes on ten records and takes minutes on ten thousand,
     * not a performance budget to optimise against.
     */
    expect(snapshotMs).toBeLessThan(15_000)
    expect(validateMs).toBeLessThan(15_000)
    expect(restoreMs).toBeLessThan(30_000)
    expect(secondRestoreMs).toBeLessThan(30_000)

    // Comfortably inside the accepted file size limit.
    expect(base64Megabytes).toBeLessThan(32)
  })
})
