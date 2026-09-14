import { describe, expect, it } from 'vitest'
import { validatePayload } from './validate'
import {
  makeContactFeedback,
  makeFeedback,
  makePayload,
  makeRegistration,
} from './testFixtures'
import { MAX_LOCATION_LENGTH } from '../../../shared/campaign/flyingFlea'

/*
 * Backups, across the change that added a capture location.
 *
 * A backup is an archive of what a device held. Two things follow, and they
 * pull in opposite directions unless the rule is stated carefully:
 *
 *   - a backup taken BEFORE this change must still restore, because the devices
 *     that produced them are the very devices this build replaces
 *   - a backup taken AFTER it must carry the location, because that is part of
 *     what the device held
 *
 * The rule that satisfies both is: optional, and bounded when present. It is
 * deliberately NOT "one of this event's two cities". An August archive
 * legitimately holds `Richardson & Cruddas`, and a validator enforcing today's
 * list would turn a valid archive into an invalid one every time the campaign
 * moved, which is precisely when somebody is most likely to need it.
 */

const REGISTRATION = makeRegistration(1)

/**
 * Strips keys a record must not carry.
 *
 * A manual capture has no participant ID, and the fixture builder starts from a
 * scanned one, so the key has to be removed rather than set to undefined:
 * `undefined` present and the key absent are different things to a validator
 * whose whole job is telling them apart.
 */
function withoutKeys<T extends object>(record: T, ...keys: string[]): unknown {
  const remaining = { ...record } as Record<string, unknown>
  for (const key of keys) {
    delete remaining[key]
  }
  return remaining
}

const MANUAL = () =>
  withoutKeys(
    makeFeedback(REGISTRATION, { captureMethod: 'manual' }),
    'participantId',
  )

function archive(feedback: readonly unknown[]) {
  return makePayload({
    registrations: [REGISTRATION],
    feedback: feedback as never,
  })
}

describe('restoring a backup that predates the location field', () => {
  it('accepts a response with no location', () => {
    /*
     * The compatibility case. A device holding unsynced August responses is
     * backed up, the tablet fails, and the replacement runs this build.
     * Refusing the archive would lose real data at the worst possible moment.
     */
    const result = validatePayload(archive([makeFeedback(REGISTRATION)]))

    expect(result.ok).toBe(true)
  })

  it('accepts a whole archive of them, on every capture method', () => {
    const result = validatePayload(
      archive([
        makeFeedback(REGISTRATION),
        MANUAL(),
        makeContactFeedback(),
      ]),
    )

    expect(result.ok).toBe(true)
  })

  it('accepts a venue this build would no longer offer', () => {
    /*
     * An archive records what happened, not what is currently configured.
     * August ran at Richardson & Cruddas and always will have, and a restore
     * that refused to read that back would be refusing the truth.
     */
    const result = validatePayload(
      archive([makeFeedback(REGISTRATION, { location: 'Richardson & Cruddas' })]),
    )

    expect(result.ok).toBe(true)
  })
})

describe('restoring a backup taken after the change', () => {
  it('accepts a response carrying a city, and preserves it', () => {
    const result = validatePayload(
      archive([makeFeedback(REGISTRATION, { location: 'Hyderabad' })]),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.feedback[0]?.location).toBe('Hyderabad')
    }
  })

  it('preserves it on a direct response, which has nothing else', () => {
    // The case the field exists for: nothing else in the archive says where
    // this rider gave their feedback.
    const result = validatePayload(
      archive([makeContactFeedback({ location: 'Bengaluru' })]),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.feedback[0]?.location).toBe('Bengaluru')
    }
  })

  it('accepts an archive mixing located and unlocated responses', () => {
    /*
     * What a device that ran both events actually holds, and what a September
     * device holds after restoring an older backup onto it.
     */
    const result = validatePayload(
      archive([
        makeFeedback(REGISTRATION, { location: 'Bengaluru' }),
        MANUAL(),
      ]),
    )

    expect(result.ok).toBe(true)
  })
})

describe('a location that could not have been captured', () => {
  it('refuses an over-long one', () => {
    const result = validatePayload(
      archive([
        makeFeedback(REGISTRATION, {
          location: 'x'.repeat(MAX_LOCATION_LENGTH + 1),
        }),
      ]),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.join(' ')).toContain('location')
    }
  })

  it('refuses an empty one, which is not the same as an absent one', () => {
    /*
     * Absent means "never captured" and is valid forever. Empty would be a
     * device that recorded a city and stored nothing, which no path produces,
     * and it would read downstream as a blank cell indistinguishable from the
     * honest one.
     */
    const result = validatePayload(
      archive([makeFeedback(REGISTRATION, { location: '' })]),
    )

    expect(result.ok).toBe(false)
  })

  it('refuses one that is not a string', () => {
    const result = validatePayload(
      archive([makeFeedback(REGISTRATION, { location: 42 as never })]),
    )

    expect(result.ok).toBe(false)
  })
})
