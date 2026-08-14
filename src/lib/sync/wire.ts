import type {
  FeedbackWireRecord,
  RegistrationWireRecord,
} from '../../../shared/sync/protocol'
import type { FeedbackRecord, RegistrationRecord } from '../../types'

/*
 * Local records to wire records.
 *
 * Fields are copied one at a time, never spread. Transport state
 * (`syncStatus`, `lastSyncedAt`, `syncErrorCode`) is this device's private
 * bookkeeping about delivery, and has no meaning to the server. A spread would
 * ship it the moment a new transport field is added, and the server would
 * reject the batch for an unrecognised field.
 *
 * `deviceId` is the device that *captured* the record. After a Phase 5 recovery
 * that is not the device uploading it, and preserving the distinction is the
 * whole point.
 */

export function toRegistrationWire(
  record: RegistrationRecord,
): RegistrationWireRecord {
  return {
    kind: 'registration',
    recordId: record.recordId,
    participantId: record.participantId,
    publicCode: record.publicCode,
    eventId: record.eventId,
    eventDay: record.eventDay,
    stationId: record.stationId,
    deviceId: record.deviceId,
    name: record.name,
    phone: record.phone,
    email: record.email,
    /*
     * Campaign fields, copied only when present. Spreading `undefined` into the
     * object would put the key on the wire with a null value, and the schema
     * rejects a present-but-empty optional: a record captured before the
     * campaign would stop uploading.
     */
    ...(record.vehicle === undefined ? {} : { vehicle: record.vehicle }),
    ...(record.interestedColour === undefined
      ? {}
      : { interestedColour: record.interestedColour }),
    ...(record.location === undefined ? {} : { location: record.location }),
    ...(record.gender === undefined ? {} : { gender: record.gender }),
    ...(record.testRideAt === undefined ? {} : { testRideAt: record.testRideAt }),
    ...(record.drivingLicence === undefined
      ? {}
      : { drivingLicence: record.drivingLicence }),
    ...(record.pincode === undefined ? {} : { pincode: record.pincode }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revision: record.revision,
  }
}

export function toFeedbackWire(record: FeedbackRecord): FeedbackWireRecord {
  return {
    kind: 'feedback',
    recordId: record.recordId,
    // Absent for a manual capture, and the server enforces that.
    ...(record.participantId === undefined
      ? {}
      : { participantId: record.participantId }),
    publicCode: record.publicCode,
    captureMethod: record.captureMethod,
    eventId: record.eventId,
    eventDay: record.eventDay,
    stationId: record.stationId,
    deviceId: record.deviceId,
    formVersion: record.formVersion,
    answers: record.answers,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revision: record.revision,
  }
}
