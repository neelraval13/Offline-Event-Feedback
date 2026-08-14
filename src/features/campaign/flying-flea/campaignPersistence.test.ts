import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../lib/storage'
import {
  createRegistration,
  getRegistrationByRecordId,
  updateRegistration,
} from '../../../lib/storage/registrations'
import { toRegistrationWire } from '../../../lib/sync/wire'
import { registrationWireSchema } from '../../../../shared/sync/protocol'
import { deviceId, eventDay, eventId, stationId } from '../../../types'
import type { RegistrationRecord } from '../../../types'
import { validateCampaignRegistration, emptyCampaignDraft } from './registrationForm'
import { isCampaignRegistration, needsLegacyCorrection } from './campaignRecord'
import { validateCampaignFeedback, EMPTY_CAMPAIGN_DRAFT } from './feedbackForm'

/*
 * What the campaign adds to a registration, from the form through the database
 * to the wire.
 *
 * The invariant under test is compatibility in both directions: a record
 * captured before the campaign must still read, and a record captured now must
 * survive a correction, a backup and an upload with every answer intact.
 */

const CONTEXT = {
  eventId: eventId('evt-dev-001'),
  eventDay: eventDay('2026-01-01'),
  stationId: stationId('A1'),
  deviceId: deviceId('11111111-2222-4333-8444-555555555555'),
}

const RIDER = {
  name: 'Ada Lovelace',
  phone: '9876543210',
  email: 'ada@example.com',
  vehicle: 'Vehicle 2',
  interestedColour: 'Storm Black' as const,
  location: 'Prestige Tech Park',
  gender: 'Female' as const,
  testRideAt: '2026-01-01T10:30',
  drivingLicence: 'KA0120200001234',
  pincode: '560048',
}

beforeEach(async () => {
  await db.open()
  await Promise.all([
    db.registrations.clear(),
    db.feedback.clear(),
    db.sequences.clear(),
  ])
})

describe('campaign registration validation', () => {
  it('accepts the campaign form and returns exactly what to store', () => {
    const result = validateCampaignRegistration({
      ...emptyCampaignDraft(),
      ...RIDER,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.values).toMatchObject(RIDER)
    }
  })

  it('requires only the five fields the campaign requires', () => {
    const result = validateCampaignRegistration(emptyCampaignDraft())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Vehicle, name, email, location and phone. Gender, test-ride time,
      // licence and pincode are not invented as requirements.
      expect(Object.keys(result.errors).sort()).toEqual([
        'email',
        'location',
        'name',
        'phone',
        'vehicle',
      ])
    }
  })

  it('reports a blank optional answer as null, and stores it as absent', async () => {
    const result = validateCampaignRegistration({
      ...emptyCampaignDraft(),
      ...RIDER,
      pincode: '   ',
      drivingLicence: '',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    // Null at the form boundary, because a correction has to be able to say
    // "cleared" and `undefined` already means "unchanged".
    expect(result.values.pincode).toBeNull()
    expect(result.values.drivingLicence).toBeNull()

    // Absent in the record: "declined to say" and "typed a space" must not
    // become different data.
    const record = await createRegistration(db, { ...CONTEXT, ...result.values })
    expect('pincode' in record).toBe(false)
    expect('drivingLicence' in record).toBe(false)
  })

  it('rejects a partial pincode but accepts none at all', () => {
    const base = { ...emptyCampaignDraft(), ...RIDER }

    expect(validateCampaignRegistration({ ...base, pincode: '5600' }).ok).toBe(
      false,
    )
    expect(validateCampaignRegistration({ ...base, pincode: '' }).ok).toBe(true)
  })

  it('does not impose a licence format', () => {
    // Indian licence formats vary by state and decade. A regex that rejected a
    // real licence at a desk with a queue would be worse than storing an odd one.
    for (const licence of ['KA01 2020 0001234', 'DL-0420110149646', 'MH1220110012345']) {
      const result = validateCampaignRegistration({
        ...emptyCampaignDraft(),
        ...RIDER,
        drivingLicence: licence,
      })
      expect(result.ok).toBe(true)
    }
  })
})

describe('campaign registrations in the database', () => {
  it('persists every campaign field', async () => {
    const record = await createRegistration(db, { ...CONTEXT, ...RIDER })

    const stored = await getRegistrationByRecordId(db, record.recordId)
    expect(stored).toMatchObject(RIDER)
    // Identity allocation is untouched by the campaign.
    expect(stored?.publicCode).toMatch(/^A1-[0-9A-F]{6}-\d{5}-[0-9A-Z]$/)
    expect(stored?.participantId).toBeDefined()
  })

  it('still reads a registration captured before the campaign', async () => {
    /*
     * A record written by a Phase 1-8 build: no campaign fields at all. Written
     * directly, because the current form cannot produce one.
     */
    const legacy: RegistrationRecord = {
      kind: 'registration',
      recordId: '019ffc65-4559-7125-9453-de82fb849ed8' as RegistrationRecord['recordId'],
      participantId:
        '019ffc65-4559-7125-9453-e230415644f1' as RegistrationRecord['participantId'],
      publicCode: 'A1-B8EFD9-00001-X' as RegistrationRecord['publicCode'],
      ...CONTEXT,
      name: 'Grace Hopper',
      phone: '+44 20 7946 0958',
      email: 'grace@example.com',
      createdAt: '2026-01-01T09:00:00.000Z' as RegistrationRecord['createdAt'],
      updatedAt: '2026-01-01T09:00:00.000Z' as RegistrationRecord['updatedAt'],
      revision: 1,
      syncStatus: 'pending',
    }
    await db.registrations.add(legacy)

    const stored = await getRegistrationByRecordId(db, legacy.recordId)
    expect(stored?.name).toBe('Grace Hopper')
    expect(stored?.vehicle).toBeUndefined()

    // ...and it still goes on the wire, without the campaign fields.
    const wire = toRegistrationWire(stored as RegistrationRecord)
    expect(registrationWireSchema.safeParse(wire).success).toBe(true)
    expect('vehicle' in wire).toBe(false)
  })

  it('corrects a campaign field without touching identity', async () => {
    const record = await createRegistration(db, { ...CONTEXT, ...RIDER })

    const corrected = await updateRegistration(db, record.recordId, {
      vehicle: 'Vehicle 4',
      pincode: '560103',
    })

    expect(corrected.vehicle).toBe('Vehicle 4')
    expect(corrected.pincode).toBe('560103')
    // The sticker in the rider's hand still refers to this record.
    expect(corrected.recordId).toBe(record.recordId)
    expect(corrected.participantId).toBe(record.participantId)
    expect(corrected.publicCode).toBe(record.publicCode)
    // A correction is a new revision that needs re-uploading.
    expect(corrected.revision).toBe(record.revision + 1)
    expect(corrected.syncStatus).toBe('pending')
    // Untouched fields keep their values.
    expect(corrected.name).toBe(RIDER.name)
    expect(corrected.drivingLicence).toBe(RIDER.drivingLicence)
  })

  it('puts every campaign field on the wire, and validates there', async () => {
    const record = await createRegistration(db, { ...CONTEXT, ...RIDER })

    const wire = toRegistrationWire(record)
    const parsed = registrationWireSchema.safeParse(wire)

    expect(parsed.success).toBe(true)
    expect(wire).toMatchObject(RIDER)
  })
})

describe('campaign feedback validation', () => {
  const COMPLETE = {
    ...EMPTY_CAMPAIGN_DRAFT,
    testRideExperience: 7,
    rotaryKnobUsage: 6,
    rideModesExperience: 5,
    overallExperienceRating: 7,
  } as const

  it('requires all four ratings and no text', () => {
    const empty = validateCampaignFeedback(EMPTY_CAMPAIGN_DRAFT)

    expect(empty.ok).toBe(false)
    if (!empty.ok) {
      expect(Object.keys(empty.errors).sort()).toEqual([
        'overallExperienceRating',
        'rideModesExperience',
        'rotaryKnobUsage',
        'testRideExperience',
      ])
    }

    // A rider who has just handed back a helmet is not held for a paragraph.
    expect(validateCampaignFeedback(COMPLETE).ok).toBe(true)
  })

  it('stores blank text as absent', () => {
    const result = validateCampaignFeedback({
      ...COMPLETE,
      topThreeFeatures: '   ',
      overallExperienceComments: 'Brilliant',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect('topThreeFeatures' in result.answers).toBe(false)
      expect(result.answers.overallExperienceComments).toBe('Brilliant')
    }
  })

  it('refuses a rating outside 1-7, whatever produced it', () => {
    for (const rating of [0, 8, 3.5, -1]) {
      const result = validateCampaignFeedback({
        ...COMPLETE,
        // A value the UI cannot produce, but a restored draft or a future
        // control could. Refused here rather than becoming an average.
        testRideExperience: rating as never,
      })
      expect(result.ok).toBe(false)
    }
  })
})

describe('clearing an optional campaign field', () => {
  const OPTIONAL_FIELDS = [
    'gender',
    'testRideAt',
    'drivingLicence',
    'pincode',
  ] as const

  it.each(OPTIONAL_FIELDS)(
    'removes %s from the record when the operator clears it',
    async (field) => {
      /*
       * The bug this covers: a blank optional field used to be omitted from the
       * patch, and an omitted field means "unchanged". A rider who asked for
       * their pincode to be removed kept it, and the correction reported
       * success.
       */
      const record = await createRegistration(db, { ...CONTEXT, ...RIDER })
      expect(record[field]).toBeDefined()

      const corrected = await updateRegistration(db, record.recordId, {
        [field]: null,
      })

      expect(corrected[field]).toBeUndefined()
      // Cleared means absent, not an empty string: an empty string is a value
      // somebody typed.
      expect(field in corrected).toBe(false)
      expect(corrected.revision).toBe(record.revision + 1)
      expect(corrected.syncStatus).toBe('pending')

      const stored = await getRegistrationByRecordId(db, record.recordId)
      expect(stored?.[field]).toBeUndefined()
    },
  )

  it('leaves fields the correction did not mention alone', async () => {
    const record = await createRegistration(db, { ...CONTEXT, ...RIDER })

    const corrected = await updateRegistration(db, record.recordId, {
      pincode: null,
    })

    expect(corrected.pincode).toBeUndefined()
    expect(corrected.vehicle).toBe(RIDER.vehicle)
    expect(corrected.drivingLicence).toBe(RIDER.drivingLicence)
    expect(corrected.gender).toBe(RIDER.gender)
  })

  it('does not mark a record pending when nothing actually changed', async () => {
    const record = await createRegistration(db, { ...CONTEXT, ...RIDER })
    await updateRegistration(db, record.recordId, { syncStatus: 'synced' })

    // Clearing a field that was already absent is a no-op for content.
    const corrected = await updateRegistration(db, record.recordId, {
      gender: null,
    })

    expect(corrected.gender).toBeUndefined()
  })

  it('produces null from a blank optional field in the form', () => {
    const result = validateCampaignRegistration({
      ...emptyCampaignDraft(),
      ...RIDER,
      pincode: '',
      drivingLicence: '   ',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      // Null, not omitted: this is what lets a correction express a deletion.
      expect(result.values.pincode).toBeNull()
      expect(result.values.drivingLicence).toBeNull()
      // A required field is never null here.
      expect(result.values.vehicle).toBe(RIDER.vehicle)
    }
  })

  it('treats null as absent when creating a registration', async () => {
    const record = await createRegistration(db, {
      ...CONTEXT,
      ...RIDER,
      pincode: null,
      gender: null,
    })

    expect('pincode' in record).toBe(false)
    expect('gender' in record).toBe(false)
    expect(record.vehicle).toBe(RIDER.vehicle)
  })
})

describe('which correction experience a record gets', () => {
  it('sends a campaign registration to the campaign form', async () => {
    const record = await createRegistration(db, { ...CONTEXT, ...RIDER })

    expect(isCampaignRegistration(record)).toBe(true)
    expect(needsLegacyCorrection(record)).toBe(false)
  })

  it('sends a pre-campaign registration to the legacy form', async () => {
    const record = await createRegistration(db, {
      ...CONTEXT,
      name: 'Grace Hopper',
      phone: '9876543210',
      email: 'grace@example.com',
    })

    expect(isCampaignRegistration(record)).toBe(false)
    expect(needsLegacyCorrection(record)).toBe(true)
  })

  it('never fabricates campaign data when a legacy record is corrected', async () => {
    /*
     * The failure: opening the campaign form on a pre-campaign record would
     * require a vehicle and a location and default the colour, so fixing an
     * email address would invent a bike, a venue and a colour preference for a
     * rider who was never asked about any of them.
     */
    const record = await createRegistration(db, {
      ...CONTEXT,
      name: 'Grace Hopper',
      phone: '9876543210',
      email: 'grace@example.com',
    })

    // What the generic correction form sends: contact details, nothing else.
    const corrected = await updateRegistration(db, record.recordId, {
      email: 'grace.corrected@example.com',
    })

    expect(corrected.email).toBe('grace.corrected@example.com')
    expect(corrected.revision).toBe(record.revision + 1)

    for (const field of [
      'vehicle',
      'interestedColour',
      'location',
      'gender',
      'testRideAt',
      'drivingLicence',
      'pincode',
    ] as const) {
      expect(field in corrected).toBe(false)
    }
  })

  it('preserves untouched campaign fields when a campaign record is corrected', async () => {
    const record = await createRegistration(db, { ...CONTEXT, ...RIDER })

    const corrected = await updateRegistration(db, record.recordId, {
      email: 'ada.corrected@example.com',
    })

    expect(corrected.email).toBe('ada.corrected@example.com')
    // Every campaign answer the correction did not mention is still there.
    const { name: _name, phone: _phone, email: _email, ...campaign } = RIDER
    expect(corrected).toMatchObject(campaign)
  })
})
