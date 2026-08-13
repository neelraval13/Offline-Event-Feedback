# `lib/sync` — synchronisation (not implemented)

This directory is the single future home of upload to the central server. It is
empty of code on purpose: there is no server and no API contract yet.

What already exists for it to build on, as of Phase 1:

- every stored record carries `recordId` (a client-generated UUIDv7), full
  `eventId` / `eventDay` / `stationId` / `deviceId` provenance, `createdAt`,
  `updatedAt` and `revision`
- `syncStatus` is `'pending' | 'syncing' | 'synced' | 'error'`, and every record
  is created `pending`
- `listRegistrationsBySyncStatus` and `listFeedbackBySyncStatus` already read
  the outbox; `updateRegistration` already advances a record's status

What will live here:

- the outbox worker: claiming `pending` records, advancing them through
  `syncing` to `synced` or `error`
- batching, retry and backoff
- the client half of the upload contract

Constraints that already hold:

- sync may run at any time, in any order, and repeatedly, without producing
  duplicates (invariant 3) — `recordId` is the idempotency key, and the server
  must upsert on it
- registration and feedback may arrive in either order, and feedback may arrive
  for a participant whose registration has not been uploaded yet; the server
  must tolerate that rather than reject it
- a manual-entry feedback record carries no `participantId` at all. Re-joining
  it to a participant via its `publicCode` is server-side work, and the server
  must handle a code that matches no known registration
- device clocks are never corrected while offline, so `createdAt` orders records
  within a device but only approximately across devices
- nothing in the field workflow may block on sync succeeding
