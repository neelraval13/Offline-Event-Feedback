# Architecture

Status: **Phase 0 — foundation and scaffolding.** This document describes the
architecture the code is being built towards, and marks clearly what exists
today versus what is deferred.

## V1 scope

Single Event → Single Day → Point A (station `A1`) → Point B (station `B1`).

- one event, one day, approximately 10,000 participants
- one registration station and one feedback station, one device each
- **no internet connectivity is required during event operations**

Multi-event, multi-day and multi-station operation are foreseeable, and the
data model is shaped to accommodate them, but none of that is built or exposed
in V1. There is no event management UI and no configuration dashboard.

## Participant journey

1. At **Point A**, staff captures name, phone number and email address.
2. The system creates a participant identity: an internal participant ID and a
   short public code.
3. The registration is **durably saved on the Point A device**.
4. Only then is a QR sticker printed and placed on the participant. The QR
   carries no PII; the human-readable public code is printed below it.
5. The participant completes the physical activity.
6. At **Point B**, staff scans the QR. If scanning fails — damaged sticker, bad
   light, broken camera — staff types the printed public code instead.
7. Feedback is collected and durably saved on the Point B device.
8. Later, at any time, both devices synchronise their records to a central
   server.

## The three invariants

These constrain every subsequent design decision.

### 1. No sticker before a durable local save

A participant must never carry a sticker whose registration is not persisted.
The print action is therefore downstream of a confirmed write — never optimistic
and never fire-and-forget. If the write fails, the flow stops and no sticker is
produced. A participant walking around with an identity the system has no record
of is unrecoverable; a retried registration is not.

### 2. Point B needs nothing but the sticker

Everything Point B requires to attribute feedback is physically present on the
participant: the QR payload and the printed public code. Point B does not query
Point A, does not hold a copy of the participant list, and does not need
connectivity. This is why the public code must be self-validating (a checksum,
designed in a later phase) — a typo in a manually entered code has to be
detectable locally, without a lookup.

### 3. Synchronisation is idempotent and order-independent

Sync may run at any time, in any order, repeatedly, from either device, without
creating duplicates. Each record is created with a client-generated `recordId`
that acts as the idempotency key; the server upserts on it. Feedback may reach
the server before the corresponding registration does — the server must accept
that ordering and reconcile, not reject it.

## Privacy boundary

| | holds | never holds |
| --- | --- | --- |
| **Point A** | PII (name, phone, email) + participant identity | — |
| **Point B** | participant identity + feedback | participant PII |

PII enters the system at Point A and stays there. The QR payload and the public
code are opaque identifiers, so a lost or photographed sticker discloses
nothing. Point B never receives a copy of the participant database, which is
both a privacy property and the reason invariant 2 is achievable: there is no
PII at Point B to keep in sync.

Re-joining feedback to a participant is a **central-server** concern, performed
after synchronisation — never a field concern.

## Offline architecture

Point A and Point B are **independent offline clients**. They are two surfaces
of one deployed application, but at runtime they share no state:

```
Point A device                 Point B device
+------------------+           +------------------+
| registration UI  |           | scan / feedback  |
| local store (PII |           | local store      |
| + identity)      |           | (identity +      |
|                  |           |  feedback)       |
+--------+---------+           +---------+--------+
         |                               |
         |  the QR sticker on the        |
         +-- participant is the only ----+
         |   link between them           |
         v                               v
                central server (later, any time)
```

- there is **no runtime A ↔ B dependency**: no shared database, no local
  network, no discovery, no message passing
- either device can be restarted, replaced or run alone without blocking the
  other
- the only channel between them is physical: the sticker the participant wears
- both devices write locally first and treat synchronisation as an entirely
  separate, later, best-effort activity

The consequence for the UI is that no field screen may ever show a spinner
waiting on a network call.

## Future-compatible seams

Every record captured in the field is stamped with:

- `eventId`
- `eventDay`
- `stationId`
- `deviceId`
- `createdAt`
- `syncStatus`
- `recordId` (client-generated idempotency key)

In V1 the first four are constants held in `src/config/event.ts`, and the UI
never lets an operator change them. They are stored per record anyway. That is
the whole point: adding a second day, a second registration desk, a third
device or an entirely separate event later becomes a matter of supplying
different configuration and filtering data — not of redesigning participant
identity or migrating already-collected records.

Identifiers are nominally typed (`EventId`, `StationId`, `DeviceId`,
`ParticipantId`, …) so they cannot be silently interchanged.

`src/lib/identity`, `src/lib/storage` and `src/lib/sync` exist as named seams.
They contain no code yet — each holds a README stating the contract the eventual
implementation must satisfy.

## What exists in Phase 0

- Vite + React + TypeScript project with strict compiler settings
- hash-based client-only routing (`#/a`, `#/b`, `#/admin`), chosen so the built
  app runs from any static host or local file server with no rewrite rules and
  no internet
- typed V1 event/station/device configuration
- foundational domain types
- minimal placeholder screens for Point A, Point B and Admin
- unit tests for routing and configuration, plus a routing render test

## Explicitly deferred

None of the following is part of Phase 0:

- IndexedDB / Dexie and any local persistence
- participant ID generation
- public-code and checksum algorithm
- QR generation
- printer integration
- QR camera scanning
- manual-code validation
- feedback questionnaire
- backup / export
- synchronisation API
- central database
- reconciliation and dashboards
- authentication

One further item, not listed in the Phase 0 brief but required before the event
and worth tracking: an **offline application shell** (service worker or
equivalent packaging) so the app loads on a device with no connectivity. Phase 0
only guarantees the *build output* has no server-side dependency.
