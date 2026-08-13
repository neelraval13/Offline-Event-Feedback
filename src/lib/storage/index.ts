export {
  db,
  DB_NAME,
  DB_VERSION,
  OfflineEventDb,
  type DeviceConfigRow,
  type SequenceRow,
} from './db'
export { DEVICE_ID_KEY, getOrCreateDeviceId, peekDeviceId } from './deviceIdentity'
export { newRecordMetadata, now } from './metadata'
export {
  allocatePublicCode,
  readSequence,
  sequenceKeyFor,
  type AllocatedPublicCode,
  type SequenceScope,
} from './sequences'
export {
  countRegistrations,
  createRegistration,
  getRegistrationByParticipantId,
  getRegistrationByPublicCode,
  getRegistrationByRecordId,
  listRecentRegistrations,
  listRegistrationsBySyncStatus,
  updateRegistration,
  type NewRegistrationInput,
  type RegistrationPatch,
} from './registrations'
export {
  countFeedback,
  createFeedback,
  getFeedbackByRecordId,
  hasFeedbackForPublicCode,
  listFeedbackByPublicCode,
  listFeedbackBySyncStatus,
  type NewFeedbackInput,
} from './feedback'
export {
  markFeedbackSyncError,
  markFeedbackSynced,
  markRegistrationSyncError,
  markRegistrationSynced,
  type SyncErrorCode,
} from './transport'
export {
  getLocalCounts,
  type LocalCounts,
  type StoreCounts,
} from './counts'
export {
  getDatabaseStatus,
  type DatabaseState,
  type DatabaseStatus,
} from './status'
