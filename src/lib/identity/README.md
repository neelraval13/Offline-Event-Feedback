# `lib/identity` — participant identity (not implemented in Phase 0)

This directory is the single future home of participant identity generation.
It is empty of code on purpose: Phase 0 fixes the seam, not the algorithm.

What will live here:

- generation of `ParticipantId` — offline-safe (no server round-trip, no
  central sequence), collision-resistant across devices
- derivation and formatting of the `PublicParticipantCode` printed under the QR
- the checksum/validation rule that makes manually typed fallback codes
  self-checking at Point B
- encoding/decoding of the QR payload

Constraints that already hold, and that any implementation here must respect:

- the QR payload and the public code carry **no PII**
- Point B must be able to validate a typed code using only the code itself —
  no lookup against Point A, no network (invariant 2)
- identifiers must be stable and unique across events, days, stations and
  devices, so `eventId` / `stationId` / `deviceId` context stays additive
