# `lib/storage` — local persistence (not implemented in Phase 0)

This directory is the single future home of on-device durable storage
(IndexedDB, most likely via Dexie). It is empty of code on purpose: Phase 0
does not persist anything, and defining repository interfaces before the first
real write would be guesswork.

What will live here:

- the IndexedDB schema and its migrations
- repositories for registration and feedback records
- durable-write confirmation used by Point A before a sticker may be printed
- export/backup of local records for the admin surface

Constraints that already hold:

- a write must be **confirmed durable** before the UI advances; a sticker is
  never printed on an optimistic write (invariant 1)
- every stored record carries the `OfflineRecordMetadata` fields, including the
  client-generated `recordId` that later makes sync idempotent (invariant 3)
- Point A and Point B databases are independent; neither reads the other's
