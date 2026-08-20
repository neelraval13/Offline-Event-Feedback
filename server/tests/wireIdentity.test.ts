import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  SYNC_PROTOCOL_VERSION,
  feedbackWireSchema,
  syncBatchSchema,
} from '../../shared/sync/protocol.js'
import { EVENT_ID, feedback, registration } from './fixtures.js'

/*
 * The feedback identity rule on the wire.
 *
 * The three capture methods share one object shape with every identity field
 * optional, which is how three shapes fit in one schema. Optionality there is
 * not permission to omit things: `checkCaptureIdentity` requires exactly the
 * set each method can have and forbids the rest, and this suite is what proves
 * the second half.
 *
 * The forbidding is the half worth testing hardest. A record missing a field is
 * obviously broken and would fail somewhere downstream. A **hybrid** record
 * looks complete: a contact response carrying a public code would be accepted,
 * stored, and then joined to whichever registration holds that code, silently,
 * by a query with every right to trust the column.
 */

const CONTACT = {
  respondentName: 'Grace Hopper',
  respondentPhone: '9876543210',
  respondentEmail: 'grace@example.com',
} as const

/** A well-formed contact response, as the client produces one. */
function contactFeedback(overrides: Record<string, unknown> = {}) {
  const { participantId: _dropped, publicCode: _code, ...base } = feedback()

  return {
    ...base,
    captureMethod: 'contact',
    ...CONTACT,
    ...overrides,
  }
}

function issuesOf(record: unknown): string {
  const parsed = feedbackWireSchema.safeParse(record)
  return parsed.success
    ? ''
    : parsed.error.issues.map((issue) => issue.message).join(' | ')
}

describe('a contact capture on the wire', () => {
  it('is accepted with a name, a phone and an email and nothing else', () => {
    expect(feedbackWireSchema.safeParse(contactFeedback()).success).toBe(true)
  })

  it('is rejected when it also carries a public code', () => {
    /*
     * The dangerous hybrid. This record claims a sticker nobody scanned, and
     * every reader downstream would treat that code as this rider's.
     */
    expect(
      issuesOf(contactFeedback({ publicCode: 'A1-B8EFD9-00001-X' })),
    ).toContain('must not carry a participantId or a publicCode')
  })

  it('is rejected when it also carries a participant ID', () => {
    expect(issuesOf(contactFeedback({ participantId: randomUUID() }))).toContain(
      'must not carry a participantId or a publicCode',
    )
  })

  it.each(['respondentName', 'respondentPhone', 'respondentEmail'])(
    'is rejected without %s',
    (field) => {
      const record = contactFeedback() as Record<string, unknown>
      delete record[field]

      expect(issuesOf(record)).toContain(
        'must carry a respondent name, phone and email',
      )
    },
  )

  it('is rejected when a respondent field is present but empty', () => {
    // An empty string is a value somebody supplied. A response identified by
    // nothing is unmatchable by reconciliation and unreachable by a human.
    expect(
      feedbackWireSchema.safeParse(contactFeedback({ respondentEmail: '' }))
        .success,
    ).toBe(false)
  })

  it('is rejected when a respondent field is longer than storage allows', () => {
    expect(
      feedbackWireSchema.safeParse(
        contactFeedback({ respondentName: 'a'.repeat(201) }),
      ).success,
    ).toBe(false)
  })
})

describe('the sticker captures are unchanged', () => {
  it('accepts a qr capture with both identifiers', () => {
    expect(feedbackWireSchema.safeParse(feedback()).success).toBe(true)
  })

  it('rejects a qr capture with no participant ID', () => {
    const record = feedback() as Record<string, unknown>
    delete record['participantId']

    expect(issuesOf(record)).toContain(
      'must carry both a participantId and a publicCode',
    )
  })

  it('rejects a qr capture with no public code', () => {
    const record = feedback() as Record<string, unknown>
    delete record['publicCode']

    expect(issuesOf(record)).toContain(
      'must carry both a participantId and a publicCode',
    )
  })

  it('rejects a qr capture carrying respondent contact details', () => {
    /*
     * A scanned sticker has no reason to hold a name, and a build that started
     * attaching one would be putting PII on the one path that has never needed
     * it. Refused on the wire rather than noticed in an export.
     */
    expect(issuesOf({ ...feedback(), ...CONTACT })).toContain(
      'must not carry respondent contact details',
    )
  })

  it('accepts a manual capture with a public code alone', () => {
    expect(
      feedbackWireSchema.safeParse(feedback({ captureMethod: 'manual' })).success,
    ).toBe(true)
  })

  it('rejects a manual capture with no public code', () => {
    const record = feedback({ captureMethod: 'manual' }) as Record<string, unknown>
    delete record['publicCode']

    expect(issuesOf(record)).toContain('must carry a publicCode')
  })

  it('rejects a manual capture with a participant ID', () => {
    expect(
      issuesOf({ ...feedback({ captureMethod: 'manual' }), participantId: randomUUID() }),
    ).toContain('must not carry a participantId')
  })

  it('rejects a manual capture carrying respondent contact details', () => {
    expect(
      issuesOf({ ...feedback({ captureMethod: 'manual' }), ...CONTACT }),
    ).toContain('must not carry respondent contact details')
  })

  it('rejects a capture method this build has never heard of', () => {
    expect(
      feedbackWireSchema.safeParse({ ...feedback(), captureMethod: 'telepathy' })
        .success,
    ).toBe(false)
  })
})

describe('protocol compatibility', () => {
  it('still accepts a batch from a device that predates the contact path', () => {
    /*
     * The compatibility question that decided the version number.
     *
     * A tablet that has been offline all day, running the previous build, has
     * unsynced qr and manual responses on it. This is the batch it sends: no
     * respondent fields anywhere, protocol version 1. It must upload to the new
     * server unchanged, because the alternative is requiring somebody to find
     * every tablet and update it before any of them can sync, which is the one
     * thing an offline-first system must never need.
     */
    const parsed = syncBatchSchema.safeParse({
      protocolVersion: 1,
      batchId: randomUUID(),
      eventId: EVENT_ID,
      uploaderDeviceId: randomUUID(),
      records: [
        registration(),
        feedback(),
        feedback({ captureMethod: 'manual' }),
      ],
    })

    expect(parsed.success).toBe(true)
  })

  it('carries the contact path at the same protocol version', () => {
    // Additive, so the version did not move. If this ever needs to change, the
    // test above is the reason it is a decision rather than a detail.
    expect(SYNC_PROTOCOL_VERSION).toBe(1)

    const parsed = syncBatchSchema.safeParse({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      batchId: randomUUID(),
      eventId: EVENT_ID,
      uploaderDeviceId: randomUUID(),
      records: [contactFeedback()],
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects a hybrid record inside an otherwise valid batch', () => {
    // The batch schema runs the same identity check, so a bad record cannot
    // slip through by travelling with good ones.
    const parsed = syncBatchSchema.safeParse({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      batchId: randomUUID(),
      eventId: EVENT_ID,
      uploaderDeviceId: randomUUID(),
      records: [
        feedback(),
        contactFeedback({ publicCode: 'A1-B8EFD9-00002-X' }),
      ],
    })

    expect(parsed.success).toBe(false)
  })
})
