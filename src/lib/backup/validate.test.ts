import { describe, expect, it } from 'vitest'
import { validateEnvelope, validatePayload } from './validate'
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from './format'
import { KDF_ITERATIONS } from './crypto'
import { bytesToBase64 } from './base64'
import {
  makeFeedback,
  makePayload,
  makeRegistration,
  SOURCE_DEVICE,
} from './testFixtures'
import { EVENT_CONFIG } from '../../config/event'
import { DB_VERSION } from '../storage'

/*
 * A restore file is untrusted input from a USB stick, an email attachment or a
 * shared drive. `JSON.parse` succeeding says nothing about whether it is safe
 * to merge into a database holding an event's records — so every field is
 * checked, and nothing is imported when anything fails.
 */

function validEnvelope() {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    kdf: {
      algorithm: 'PBKDF2',
      hash: 'SHA-256',
      iterations: KDF_ITERATIONS,
      salt: bytesToBase64(new Uint8Array(16).fill(1)),
    },
    cipher: {
      algorithm: 'AES-GCM',
      iv: bytesToBase64(new Uint8Array(12).fill(2)),
    },
    ciphertext: bytesToBase64(new Uint8Array(64).fill(3)),
  }
}

describe('envelope validation', () => {
  it('accepts a well-formed envelope', () => {
    expect(validateEnvelope(validEnvelope()).ok).toBe(true)
  })

  it('rejects anything that is not a backup file', () => {
    for (const input of [null, 42, 'text', [], {}, { format: 'other' }]) {
      expect(validateEnvelope(input).ok).toBe(false)
    }
  })

  it('rejects a future format version', () => {
    const result = validateEnvelope({ ...validEnvelope(), version: 2 })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.issues[0]).toContain('different version')
  })

  it('rejects unsupported algorithms', () => {
    const envelope = validEnvelope()

    expect(
      validateEnvelope({ ...envelope, kdf: { ...envelope.kdf, algorithm: 'scrypt' } })
        .ok,
    ).toBe(false)
    expect(
      validateEnvelope({ ...envelope, kdf: { ...envelope.kdf, hash: 'SHA-1' } }).ok,
    ).toBe(false)
    expect(
      validateEnvelope({
        ...envelope,
        cipher: { ...envelope.cipher, algorithm: 'AES-CBC' },
      }).ok,
    ).toBe(false)
  })

  it('rejects an attacker-supplied iteration count that would hang the browser', () => {
    const envelope = validEnvelope()

    for (const iterations of [0, 1, -5, 1e9, 2.5]) {
      expect(
        validateEnvelope({ ...envelope, kdf: { ...envelope.kdf, iterations } }).ok,
      ).toBe(false)
    }
  })

  it('rejects wrong-length salt or IV', () => {
    const envelope = validEnvelope()

    expect(
      validateEnvelope({
        ...envelope,
        kdf: { ...envelope.kdf, salt: bytesToBase64(new Uint8Array(8)) },
      }).ok,
    ).toBe(false)
    expect(
      validateEnvelope({
        ...envelope,
        cipher: { ...envelope.cipher, iv: bytesToBase64(new Uint8Array(16)) },
      }).ok,
    ).toBe(false)
  })

  it('rejects malformed Base64', () => {
    expect(validateEnvelope({ ...validEnvelope(), ciphertext: 'not!base64' }).ok).toBe(
      false,
    )
  })

  it('rejects a missing ciphertext', () => {
    const { ciphertext: _dropped, ...withoutCiphertext } = validEnvelope()
    expect(validateEnvelope(withoutCiphertext).ok).toBe(false)
  })
})

describe('payload validation', () => {
  it('accepts a well-formed payload', () => {
    const registration = makeRegistration(1)
    const payload = makePayload({
      registrations: [registration],
      feedback: [makeFeedback(registration)],
      sequences: [{ key: 'publicCode:evt:day:A1:ABCDEF', value: 1 }],
    })

    const result = validatePayload(payload)
    expect(result.ok).toBe(true)
  })

  it('rejects a future backup format version', () => {
    const result = validatePayload({
      ...makePayload(),
      backupFormatVersion: 2,
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.issues[0]).toContain('newer version')
  })

  it('rejects a newer database schema', () => {
    const payload = makePayload()
    const result = validatePayload({
      ...payload,
      database: { ...payload.database, schemaVersion: DB_VERSION + 1 },
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.issues.join(' ')).toContain('newer database format')
  })

  it('rejects another event', () => {
    const payload = makePayload()
    const result = validatePayload({
      ...payload,
      event: { ...payload.event, eventId: 'evt-other' },
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.issues[0]).toContain('another event')
  })

  it('rejects another event day', () => {
    const payload = makePayload()
    const result = validatePayload({
      ...payload,
      event: { ...payload.event, eventDay: '2030-12-25' },
    })

    expect(!result.ok && result.issues[0]).toContain('another event')
  })

  it('rejects a record belonging to another event', () => {
    const registration = makeRegistration(1)
    const result = validatePayload(
      makePayload({
        registrations: [{ ...registration, eventDay: '2030-12-25' as never }],
      }),
    )

    expect(result.ok).toBe(false)
  })

  it('rejects an invalid source device', () => {
    const result = validatePayload({
      ...makePayload(),
      sourceDeviceId: 'not-a-uuid',
    })

    expect(result.ok).toBe(false)
  })

  describe('registration records', () => {
    it('rejects an invalid participant UUID', () => {
      const registration = makeRegistration(1)
      const result = validatePayload(
        makePayload({
          registrations: [{ ...registration, participantId: 'participant-7' as never }],
        }),
      )

      expect(!result.ok && result.issues.join(' ')).toContain('invalid participantId')
    })

    it('rejects an invalid record ID', () => {
      const registration = makeRegistration(1)
      const result = validatePayload(
        makePayload({ registrations: [{ ...registration, recordId: '42' as never }] }),
      )

      expect(!result.ok && result.issues.join(' ')).toContain('invalid recordId')
    })

    it('rejects a public code whose check character does not hold', () => {
      const registration = makeRegistration(1)
      const broken = registration.publicCode.slice(0, -1) + 'Z'
      const result = validatePayload(
        makePayload({ registrations: [{ ...registration, publicCode: broken as never }] }),
      )

      expect(!result.ok && result.issues.join(' ')).toContain('invalid public code')
    })

    it('rejects a duplicate participant ID', () => {
      const first = makeRegistration(1)
      const second = makeRegistration(2)
      const result = validatePayload(
        makePayload({
          registrations: [first, { ...second, participantId: first.participantId }],
        }),
      )

      expect(!result.ok && result.issues.join(' ')).toContain(
        'duplicate registration participantId',
      )
    })

    it('rejects a duplicate public code', () => {
      const first = makeRegistration(1)
      const second = makeRegistration(2)
      const result = validatePayload(
        makePayload({
          registrations: [first, { ...second, publicCode: first.publicCode }],
        }),
      )

      expect(!result.ok && result.issues.join(' ')).toContain(
        'duplicate registration public code',
      )
    })

    it('rejects an invalid sync status', () => {
      const registration = makeRegistration(1)
      const result = validatePayload(
        makePayload({
          registrations: [{ ...registration, syncStatus: 'uploaded' as never }],
        }),
      )

      expect(!result.ok && result.issues.join(' ')).toContain('invalid syncStatus')
    })

    it('rejects an invalid timestamp', () => {
      const registration = makeRegistration(1)
      const result = validatePayload(
        makePayload({
          registrations: [{ ...registration, createdAt: 'yesterday' as never }],
        }),
      )

      expect(!result.ok && result.issues.join(' ')).toContain('invalid createdAt')
    })
  })

  describe('feedback records', () => {
    it('rejects an invalid capture method', () => {
      const registration = makeRegistration(1)
      const feedback = makeFeedback(registration)
      const result = validatePayload(
        makePayload({
          registrations: [registration],
          feedback: [{ ...feedback, captureMethod: 'telepathy' as never }],
        }),
      )

      expect(!result.ok && result.issues.join(' ')).toContain('invalid captureMethod')
    })

    it('rejects a manual capture claiming a participant ID', () => {
      // The Phase 3 identity rule: a typed code cannot yield a participant ID.
      const registration = makeRegistration(1)
      const feedback = makeFeedback(registration, { captureMethod: 'manual' })
      const result = validatePayload(
        makePayload({ registrations: [registration], feedback: [feedback] }),
      )

      expect(!result.ok && result.issues.join(' ')).toContain(
        'must not carry a participantId',
      )
    })

    it('accepts a manual capture without a participant ID', () => {
      const registration = makeRegistration(1)
      const { participantId: _dropped, ...manual } = makeFeedback(registration, {
        captureMethod: 'manual',
      })

      const result = validatePayload(
        makePayload({
          registrations: [registration],
          feedback: [manual as never],
        }),
      )

      expect(result.ok).toBe(true)
    })

    it('rejects an unsupported questionnaire version', () => {
      const registration = makeRegistration(1)
      const feedback = makeFeedback(registration, {
        formVersion: 'feedback-v2' as never,
      })
      const result = validatePayload(
        makePayload({ registrations: [registration], feedback: [feedback] }),
      )

      expect(!result.ok && result.issues.join(' ')).toContain(
        'unsupported questionnaire version',
      )
    })

    it('rejects invalid answers', () => {
      const registration = makeRegistration(1)

      for (const answers of [
        { overall_rating: 9, experience: 'good', recommend: true },
        { overall_rating: 3, experience: 'amazing', recommend: true },
        { overall_rating: 3, experience: 'good', recommend: 'yes' },
        { overall_rating: 3, experience: 'good', recommend: true, comments: 42 },
        { overall_rating: 3, experience: 'good' },
      ]) {
        const result = validatePayload(
          makePayload({
            registrations: [registration],
            feedback: [makeFeedback(registration, { answers: answers as never })],
          }),
        )
        expect(result.ok).toBe(false)
      }
    })

    it('allows two feedback records sharing one public code', () => {
      // Cross-device duplicates must stay representable.
      const registration = makeRegistration(1)
      const first = makeFeedback(registration)
      const second = makeFeedback(registration)

      const result = validatePayload(
        makePayload({ registrations: [registration], feedback: [first, second] }),
      )

      expect(result.ok).toBe(true)
    })

    it('rejects a duplicate feedback record ID', () => {
      const registration = makeRegistration(1)
      const first = makeFeedback(registration)
      const result = validatePayload(
        makePayload({
          registrations: [registration],
          feedback: [first, { ...makeFeedback(registration), recordId: first.recordId }],
        }),
      )

      expect(!result.ok && result.issues.join(' ')).toContain(
        'duplicate feedback recordId',
      )
    })
  })

  describe('sequences', () => {
    it('rejects a negative sequence value', () => {
      const result = validatePayload(
        makePayload({ sequences: [{ key: 'publicCode:a', value: -1 }] }),
      )

      expect(!result.ok && result.issues.join(' ')).toContain(
        'invalid sequence value',
      )
    })

    it('rejects a duplicate sequence key', () => {
      const result = validatePayload(
        makePayload({
          sequences: [
            { key: 'publicCode:a', value: 1 },
            { key: 'publicCode:a', value: 2 },
          ],
        }),
      )

      expect(!result.ok && result.issues.join(' ')).toContain('duplicate sequence key')
    })
  })

  describe('declared counts', () => {
    it('rejects counts that disagree with the records', () => {
      const registration = makeRegistration(1)
      const result = validatePayload(
        makePayload({
          registrations: [registration],
          counts: { registrations: 99, feedback: 0, sequences: 0 },
        }),
      )

      expect(!result.ok && result.issues.join(' ')).toContain(
        'registration count does not match',
      )
    })
  })

  it('never puts a value into an error message', () => {
    // Messages carry field names and indices only, so a validation failure can
    // never print a participant's name or email.
    const registration = makeRegistration(1)
    const result = validatePayload(
      makePayload({
        registrations: [
          {
            ...registration,
            participantId: 'nope' as never,
            name: 'Ada Lovelace',
            email: 'ada@example.com',
          },
        ],
      }),
    )

    expect(result.ok).toBe(false)
    const joined = !result.ok ? result.issues.join(' ') : ''
    expect(joined).not.toContain('Ada')
    expect(joined).not.toContain('example.com')
    expect(joined).not.toContain('nope')
  })

  it('reports every problem in one pass', () => {
    const result = validatePayload(
      makePayload({
        registrations: [
          { ...makeRegistration(1), participantId: 'x' as never },
          { ...makeRegistration(2), recordId: 'y' as never },
        ],
      }),
    )

    expect(!result.ok && result.issues.length).toBeGreaterThan(1)
  })

  it('rejects payloads that are not objects at all', () => {
    for (const input of [null, 'text', 42, []]) {
      expect(validatePayload(input).ok).toBe(false)
    }
  })

  it('uses the configured event by default', () => {
    const result = validatePayload(makePayload())
    expect(result.ok).toBe(true)
    expect(EVENT_CONFIG.eventId).toBeDefined()
  })

  it('keeps the source device for provenance', () => {
    const result = validatePayload(makePayload())
    expect(result.ok && result.value.sourceDeviceId).toBe(SOURCE_DEVICE)
  })
})

describe('campaign registration validation', () => {

  describe('campaign registration fields', () => {
    const RIDER = {
      vehicle: 'Vehicle 2',
      interestedColour: 'Storm Black',
      location: 'Prestige Tech Park',
      gender: 'Female',
      testRideAt: '2026-01-01T10:30',
      drivingLicence: 'KA0120200001234',
      pincode: '560048',
    }

    function payloadWith(overrides: Record<string, unknown>) {
      return makePayload({
        registrations: [
          { ...makeRegistration(1), ...overrides } as never,
        ],
        feedback: [],
      })
    }

    it('accepts a complete campaign registration', () => {
      expect(validatePayload(payloadWith(RIDER)).ok).toBe(true)
    })

    it('accepts a registration with none of them', () => {
      // Captured before the campaign existed. A restore that refused it would
      // refuse the device's own history.
      expect(validatePayload(payloadWith({})).ok).toBe(true)
    })

    it('rejects a wrong type in any campaign field', () => {
      for (const field of Object.keys(RIDER)) {
        const result = validatePayload(payloadWith({ ...RIDER, [field]: 42 }))

        expect(result.ok).toBe(false)
        expect(!result.ok && result.issues.join(' ')).toContain(
          `invalid ${field}`,
        )
      }
    })

    it('rejects a colour the campaign does not offer', () => {
      const result = validatePayload(
        payloadWith({ ...RIDER, interestedColour: 'Racing Red' }),
      )

      expect(result.ok).toBe(false)
      expect(!result.ok && result.issues.join(' ')).toContain(
        'invalid interestedColour',
      )
    })

    it('rejects a gender the campaign does not offer', () => {
      const result = validatePayload(
        payloadWith({ ...RIDER, gender: 'Unspecified' }),
      )

      expect(result.ok).toBe(false)
      expect(!result.ok && result.issues.join(' ')).toContain('invalid gender')
    })

    it('rejects a malformed or impossible test-ride time', () => {
      for (const value of [
        '2026-01-01',
        '2026-01-01T10:30:00.000Z',
        '2026-02-31T10:30',
        '2026-01-01T25:00',
      ]) {
        const result = validatePayload(
          payloadWith({ ...RIDER, testRideAt: value }),
        )
        expect(result.ok).toBe(false)
      }
    })

    it('rejects an overlong licence, and never prints it', () => {
      const licence = 'K'.repeat(200)
      const result = validatePayload(
        payloadWith({ ...RIDER, drivingLicence: licence }),
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        const message = result.issues.join(' ')
        expect(message).toContain('invalid drivingLicence')
        // A validation message is read on screen and pasted into support notes.
        expect(message).not.toContain(licence)
      }
    })

    it('rejects a malformed pincode', () => {
      for (const value of ['5600', '5600481', 'ABC123', '']) {
        expect(validatePayload(payloadWith({ ...RIDER, pincode: value })).ok).toBe(
          false,
        )
      }
    })

    it('names the field and the index, never the value', () => {
      const result = validatePayload(
        payloadWith({ ...RIDER, vehicle: '', pincode: '560' }),
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.issues).toContain('registrations[0]: invalid vehicle')
        expect(result.issues.join(' ')).not.toContain('560')
      }
    })
  })
})
