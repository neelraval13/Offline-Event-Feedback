# `lib/sync` — synchronisation (not implemented in Phase 0)

This directory is the single future home of upload to the central server. It is
empty of code on purpose: there is no server, no API contract, and nothing
persisted locally to send yet.

What will live here:

- the outbox: selecting `pending` records and advancing their `syncStatus`
- batching, retry and backoff
- the client half of the upload contract

Constraints that already hold:

- sync may run at any time, in any order, and repeatedly, without producing
  duplicates (invariant 3) — the client-generated `recordId` is the
  idempotency key, and the server must upsert on it
- registration and feedback may arrive in either order, and feedback may arrive
  for a participant whose registration has not been uploaded yet; the server
  must tolerate that rather than reject it
- nothing in the field workflow may block on sync succeeding
