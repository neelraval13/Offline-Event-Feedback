import { deriveIssuerCode } from '../identity/issuerCode'
import { newParticipantId } from '../identity/uuid'
import type {
  CampaignFieldCorrections,
  FlyingFleaRegistrationFields,
} from '../../types/campaign'
import type {
  ParticipantId,
  PublicParticipantCode,
  RecordContext,
  RecordId,
  RegistrationRecord,
  SyncStatus,
} from '../../types'
import type { OfflineEventDb } from './db'
import { newRecordMetadata, now } from './metadata'
import { allocatePublicCode } from './sequences'

/*
 * Registration persistence.
 *
 * There is no registration UI in this phase. What exists here is the write path
 * the UI will call, because invariant 1 — no sticker before a durable local
 * save — is a property of this function, not of a form. `createRegistration`
 * resolves only after IndexedDB has committed; a caller that awaits it and then
 * prints is correct by construction, and one that does not await it is not.
 */

export type NewRegistrationInput = RecordContext &
  CampaignFieldCorrections & {
    readonly name: string
    readonly phone: string
    readonly email: string
  }

/**
 * Fields a correction may legitimately change after a sticker has been printed.
 *
 * Identity is absent from this list and always will be: `participantId`,
 * `publicCode`, `recordId` and `deviceId` are what the printed sticker in the
 * rider's hand refers to, and a correction that changed any of them would
 * silently detach the record from the physical thing pointing at it.
 *
 * Everything a human can mistype — contact details and campaign answers — is
 * correctable, because the alternative is staff registering the same rider
 * twice to fix a digit. See docs/flying-flea-campaign.md.
 */
export type RegistrationPatch = CampaignFieldCorrections & {
  readonly name?: string
  readonly phone?: string
  readonly email?: string
  readonly syncStatus?: SyncStatus
}

/** The campaign fields, in one place, so a new one cannot be half-wired. */
const CAMPAIGN_FIELDS = [
  'vehicle',
  'interestedColour',
  'location',
  'gender',
  'testRideAt',
  'drivingLicence',
  'pincode',
] as const

/** Copies only the campaign fields a new registration actually carries. */
function campaignFields(
  source: CampaignFieldCorrections,
): FlyingFleaRegistrationFields {
  const copied: Record<string, string> = {}

  for (const field of CAMPAIGN_FIELDS) {
    const value = source[field]
    if (value !== undefined && value !== null) {
      copied[field] = value
    }
  }

  return copied as FlyingFleaRegistrationFields
}

/**
 * Applies a correction's campaign fields to a stored record.
 *
 * Returns the campaign portion of the updated record, and it is a *replacement*
 * for that portion rather than an overlay: a cleared field is left out of the
 * result, so spreading it over the existing record is not enough — the caller
 * deletes the key. See {@link CampaignFieldCorrections} for the three states.
 */
function applyCampaignCorrections(
  existing: RegistrationRecord,
  patch: CampaignFieldCorrections,
): { readonly fields: FlyingFleaRegistrationFields; readonly changed: boolean } {
  const fields: Record<string, string> = {}
  let changed = false

  for (const field of CAMPAIGN_FIELDS) {
    const correction = patch[field]
    const current = existing[field]

    if (correction === undefined) {
      // Not part of this correction. Whatever is stored survives.
      if (current !== undefined) {
        fields[field] = current
      }
      continue
    }

    if (correction === null) {
      // Cleared. The key is simply not written back.
      changed = changed || current !== undefined
      continue
    }

    changed = changed || current !== correction
    fields[field] = correction
  }

  return { fields: fields as FlyingFleaRegistrationFields, changed }
}

/**
 * Creates a participant identity and persists the registration.
 *
 * Sequence allocation and the record insert share one readwrite transaction:
 * if the insert fails, the counter rolls back with it, so a failed attempt
 * cannot leave a code issued to nobody or — worse — hand the same code to the
 * next participant.
 *
 * The issuer code is derived from `deviceId`, which the caller already supplies
 * as part of the record context. Nothing extra to pass, nothing extra to store,
 * and no way to accidentally issue codes under another device's namespace.
 *
 * @returns the committed record, including its participant ID and public code
 */
export async function createRegistration(
  database: OfflineEventDb,
  input: NewRegistrationInput,
): Promise<RegistrationRecord> {
  return database.transaction(
    'rw',
    database.sequences,
    database.registrations,
    async () => {
      const { publicCode } = await allocatePublicCode(database, {
        eventId: input.eventId,
        eventDay: input.eventDay,
        stationId: input.stationId,
        issuerCode: deriveIssuerCode(input.deviceId),
      })

      const record: RegistrationRecord = {
        ...newRecordMetadata(input),
        kind: 'registration',
        participantId: newParticipantId(),
        publicCode,
        name: input.name,
        phone: input.phone,
        email: input.email,
        ...campaignFields(input),
      }

      await database.registrations.add(record)
      return record
    },
  )
}

export async function getRegistrationByRecordId(
  database: OfflineEventDb,
  id: RecordId,
): Promise<RegistrationRecord | undefined> {
  return database.registrations.get(id)
}

export async function getRegistrationByParticipantId(
  database: OfflineEventDb,
  id: ParticipantId,
): Promise<RegistrationRecord | undefined> {
  return database.registrations.where('participantId').equals(id).first()
}

export async function getRegistrationByPublicCode(
  database: OfflineEventDb,
  code: PublicParticipantCode,
): Promise<RegistrationRecord | undefined> {
  return database.registrations.where('publicCode').equals(code).first()
}

/**
 * Applies a correction to a stored registration.
 *
 * Every mutation bumps `revision` and `updatedAt`. Identity fields are not
 * patchable: a participant's ID and public code are printed on a sticker they
 * are physically wearing, so changing them locally would silently break the
 * link the whole system rests on. Provenance (`eventId`, `stationId`,
 * `deviceId`, `createdAt`) is equally fixed — it records what happened, not
 * what someone would prefer.
 *
 * Correcting contact details returns the record to `pending`, because a record
 * already uploaded now differs from the server's copy and has to go again. A
 * patch that sets `syncStatus` explicitly — which is what the sync engine will
 * do — is taken at its word instead.
 */
export async function updateRegistration(
  database: OfflineEventDb,
  id: RecordId,
  patch: RegistrationPatch,
): Promise<RegistrationRecord> {
  return database.transaction('rw', database.registrations, async () => {
    const existing = await database.registrations.get(id)
    if (existing === undefined) {
      throw new Error(`No registration with recordId ${id}`)
    }

    const campaign = applyCampaignCorrections(existing, patch)

    const touchesContactDetails =
      patch.name !== undefined ||
      patch.phone !== undefined ||
      patch.email !== undefined ||
      campaign.changed

    /*
     * The campaign fields are stripped and reapplied rather than spread over the
     * existing record. Spreading cannot express a deletion: a key the operator
     * cleared would still be there underneath, and the correction would appear
     * to succeed while changing nothing.
     */
    const withoutCampaignFields = { ...existing }
    for (const field of CAMPAIGN_FIELDS) {
      delete (withoutCampaignFields as Record<string, unknown>)[field]
    }

    const updated: RegistrationRecord = {
      ...withoutCampaignFields,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.phone === undefined ? {} : { phone: patch.phone }),
      ...(patch.email === undefined ? {} : { email: patch.email }),
      ...campaign.fields,
      syncStatus:
        patch.syncStatus ??
        (touchesContactDetails ? 'pending' : existing.syncStatus),
      revision: existing.revision + 1,
      updatedAt: now(),
    }

    await database.registrations.put(updated)
    return updated
  })
}

/**
 * The most recently created registrations on this device, newest first.
 *
 * Exists for reprint and recovery after a refresh, not for browsing: Point A
 * staff need to reach the sticker they just failed to print, and nothing more.
 * Ordered by the indexed `createdAt`, so it does not scan the store.
 */
export async function listRecentRegistrations(
  database: OfflineEventDb,
  limit: number,
): Promise<RegistrationRecord[]> {
  if (limit <= 0) {
    return []
  }

  return database.registrations
    .orderBy('createdAt')
    .reverse()
    .limit(limit)
    .toArray()
}

export async function countRegistrations(
  database: OfflineEventDb,
): Promise<number> {
  return database.registrations.count()
}

export async function listRegistrationsBySyncStatus(
  database: OfflineEventDb,
  status: SyncStatus,
): Promise<RegistrationRecord[]> {
  return database.registrations.where('syncStatus').equals(status).toArray()
}
