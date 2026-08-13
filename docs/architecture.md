# Architecture

Status: **Phase 1 — local persistence and participant identity.** This document
describes the architecture the code is being built towards, and marks clearly
what exists today versus what is deferred.

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

`eventId`, `eventDay` and `stationId` are constants held in
`src/config/event.ts`, and the UI never lets an operator change them.
`deviceId` is discovered at runtime from local storage. All four are stored per
record anyway. That is the whole point: adding a second day, a second
registration desk, a third device or an entirely separate event later becomes a
matter of supplying different configuration and filtering data — not of
redesigning participant identity or migrating already-collected records.

Identifiers are nominally typed (`EventId`, `StationId`, `DeviceId`,
`ParticipantId`, …) so they cannot be silently interchanged.

`src/lib/sync` remains an empty named seam holding a README that states the
contract its eventual implementation must satisfy. `src/lib/identity` and
`src/lib/storage` are now implemented; their placeholder READMEs are gone.

## Local persistence

**IndexedDB via Dexie 4** (`src/lib/storage/db.ts`). IndexedDB is the only
browser store that is durable, transactional and large enough for ~10,000
registrations with room to spare. Dexie is a thin wrapper over it, chosen
because raw IndexedDB's request/event API makes transaction boundaries easy to
get subtly wrong — and transaction correctness is precisely what the public
code sequence depends on.

Database `offline-event-feedback`, schema version **1**:

| Store | Primary key | Indexes | Holds |
| --- | --- | --- | --- |
| `registrations` | `recordId` | `&participantId`, `&publicCode`, `syncStatus`, `createdAt` | Point A records, including PII |
| `feedback` | `recordId` | `publicCode`, `participantId` (sparse), `syncStatus`, `createdAt` | Point B records |
| `deviceConfig` | `key` | — | values belonging to this browser install |
| `sequences` | `key` | — | one monotonic counter per issuing scope |

`&` marks a unique index. A duplicate participant ID or public code is refused
by the database itself rather than by application code that might not run.
`feedback.publicCode` is deliberately *not* unique: nothing offline can rule out
a participant being recorded twice, and silently dropping the second record
would destroy evidence the server needs to reconcile. `feedback.participantId`
is sparse — manual-entry records omit the field entirely rather than storing
null, so "we do not know it" stays distinct from "it is empty".

**Schema evolution.** Every future change ships as a new `version(n).stores({})`
block appended below the existing ones, which are never edited. Dexie replays
them in order, so an installed device upgrades in place. Data is never dropped;
migrations that must rewrite rows attach an `.upgrade()` to their version.

**Record metadata.** Every stored record carries `recordId`, `eventId`,
`eventDay`, `stationId`, `deviceId`, `createdAt`, `updatedAt`, `revision` and
`syncStatus`. Records are created with `revision: 1` and
`syncStatus: 'pending'`; local mutations bump `revision` and `updatedAt`.
`SyncStatus` is `'pending' | 'syncing' | 'synced' | 'error'`. No sync engine
exists, so in this phase nothing ever leaves `pending` on its own.

### Invariant 1 in code

`createRegistration` resolves only after IndexedDB has committed. A caller that
awaits it and then prints is correct by construction. Sequence allocation and
the record insert share one readwrite transaction, so a failure after allocation
rolls the counter back rather than burning a code — or, worse, handing the same
code to the next participant.

## Device identity

```text
first use  ->  no stored deviceId  ->  generate  ->  persist
later use  ->  load the same stored deviceId
```

A `deviceId` (UUIDv4) identifies a **physical browser installation**. It is not
a station: `A1` and `B1` are operational posts named in configuration, and one
browser can visit both routes during development while remaining one device.
Conflating the two would make every record's provenance a guess.

Stored in IndexedDB under `deviceConfig['deviceId']` rather than in
localStorage, so device identity shares the lifetime of the records stamped
with it: if a browser evicts the database, the records go with it and a fresh
identity is the correct outcome. It survives page refresh and browser restart,
and is expected **not** to survive a deliberate "clear site data".

Get-or-create runs inside a single readwrite transaction, so two tabs racing on
first launch cannot both observe an empty store and mint competing identities.

## Participant identity

**`participantId` — UUIDv7**, generated offline with no central sequence
(`src/lib/identity/uuid.ts`). Two reasons for the `uuid` package over
`crypto.randomUUID()`:

1. `crypto.randomUUID()` is restricted to **secure contexts**. This app may well
   be served at a venue from a laptop over plain HTTP on a LAN address, where it
   is simply `undefined`. `crypto.getRandomValues` — which the package uses —
   carries no such restriction. Discovering that at the event would be
   unrecoverable.
2. UUIDv7 is time-ordered, so ~10,000 inserts stay local in IndexedDB's B-tree
   instead of scattering across the keyspace, records sort chronologically for
   free, and future sync batches upload in creation order.

`recordId` is also UUIDv7. `deviceId` is UUIDv4: it gains nothing from being
sortable, and there is no reason to embed when a device was provisioned.

## Public participant code

```text
A1-00001-O
^^ ^^^^^ ^
|  |     check character
|  local registration sequence, zero-padded to at least 5 digits
issuing station
```

Case-insensitive on entry and normalised to one canonical stored form.
Separator style is forgiven (`a1 00001 o`, `A1--00001--O` and `A1.00001.O` all
parse), and so is under-padding: the check character is computed over the padded
payload, so `A1-1-O` validates and normalises to `A1-00001-O`. The code contains
an issuer and a counter and nothing else — no PII (invariant E).

### Check character: ISO 7064 MOD 37-2

Computed over the alphabet `0-9A-Z`, on the payload `prefix + padded sequence`
(e.g. `A100001`):

```text
P = 0
for each character with value a:
    P = ((P + a) mod 37) * 2 mod 37
check = (38 - P) mod 37
```

Detection properties, all pinned by exhaustive tests rather than taken on trust:
**every** single-character substitution, **every** adjacent transposition and
**every** jump transposition is caught.

Why this and not the alternatives:

- Damm and Verhoeff are defined for decimal input; our payload contains the
  station letters, so they do not apply without mangling the format.
- ISO 7064 MOD 37,36 (the hybrid system) needs no skipping, but measurement
  showed it misses a small class of adjacent transpositions — those where the
  two characters differ by exactly 1 in value. In a zero-padded numeric sequence
  that class is dominated by `0`↔`1` swaps, which is precisely the typo manual
  entry is most likely to produce, so the trade was not worth taking.
- A prime modulus buys total detection instead. The price: 1 payload in 37
  yields check value 36, which has no character in a 36-symbol alphabet. Those
  sequence numbers are **skipped at issue time** (~2.8% of the counter), which
  costs nothing — the sequence is a ticket dispenser, not a census.

The check character detects transcription mistakes. It is **not** a signature,
authenticates nothing, and anyone can compute one.

### Local sequence and transaction semantics

Counters live in the `sequences` store, keyed per issuing scope
(`publicCode:<eventId>:<eventDay>:<stationId>`), so a second day or a second
desk later starts its own run rather than colliding with this one.

A read-modify-write on a counter is the textbook way to hand out duplicates, so
the increment never happens outside a readwrite transaction:

- IndexedDB runs readwrite transactions with overlapping scopes strictly one at
  a time, so two allocations cannot interleave their read and their write —
  whether from two rapid clicks in one tab or from two tabs on one device.
- Dexie's transaction callback must only await Dexie operations; awaiting
  anything else lets the IndexedDB transaction auto-commit mid-flight and the
  guarantee evaporates. Everything inside these callbacks is a Dexie call or
  synchronous arithmetic, deliberately.
- The caller's whole unit of work joins the same transaction, so a failure after
  allocation rolls the counter back.

Gaps are expected and harmless. Sequence numbers are not capped at 10,000: the
format grows past five digits rather than truncating, up to 999,999,999,999.

## QR payload contract

Defined and validated in `src/lib/identity/qrPayload.ts`. **Nothing renders or
scans a QR code in this phase** — the boundary is locked now so Point A and
Point B share one versioned identity contract instead of two implicit ones.

```json
{
  "v": 1,
  "event": "evt-dev-001",
  "participant": "0199f5c2-...-7a1b",
  "code": "A1-00001-O"
}
```

The parser treats a scanned string as **untrusted input**. It may come from
another event, another system, a future version of this app, a damaged scan, or
a sticker someone printed themselves. Parsing as JSON means nothing on its own,
so `parseQrPayload` rejects: invalid JSON, non-objects, unsupported or missing
versions, missing or wrongly-typed fields, participant IDs that are not UUIDs,
a mismatched event when one is expected, and public codes that fail their own
check character. Unknown extra keys are ignored rather than carried through.

`qrPayloadForRegistration` is the only bridge from a PII-bearing registration to
a payload, and it copies the three identity fields explicitly — never by
spreading, which would silently start leaking PII into stickers the moment the
registration record grows a field.

## Why Point B works without Point A

Point B needs three things to record attributable feedback, and has all three
without a lookup:

1. **The identifiers** — both are on the sticker. A QR scan yields
   `participantId` and `publicCode`; a typed fallback yields `publicCode` alone.
2. **Validation** — the check character is deterministic arithmetic over the
   code itself, so a typo is caught locally with no participant list to consult.
3. **Somewhere to put it** — Point B's own IndexedDB, which never contains a
   copy of Point A's data.

Point B therefore holds no participant PII, needs no connectivity, and cannot be
blocked by Point A being restarted, replaced or absent. Re-joining a
manual-entry record to a participant ID is the central server's job after
synchronisation.

## What exists after Phase 1

- Vite + React + TypeScript project with strict compiler settings
- hash-based client-only routing (`#/a`, `#/b`, `#/admin`)
- typed V1 event/station configuration, with device identity resolved at runtime
- IndexedDB persistence for registrations, feedback and device configuration
- participant ID generation, public code issuing and validation
- the QR payload contract: serialiser, parser and validation
- minimal placeholder screens for Point A and Point B, and device diagnostics on
  Admin
- unit and integration tests for all of the above, against a real IndexedDB
  implementation

## Explicitly deferred

None of the following exists yet:

- QR rendering and printer integration
- QR camera scanning
- the registration form workflow
- the feedback questionnaire and its workflow
- backup / export
- synchronisation API
- central database
- reconciliation and dashboards
- authentication

One further item, still unscheduled and required before the event: an **offline
application shell** (service worker or equivalent packaging) so the app loads on
a device with no connectivity. What exists today guarantees only that the *build
output* has no server-side dependency.

## Known concerns carried into later phases

- **Ambiguous glyphs in printed codes.** The check character is drawn from the
  full `0-9A-Z` alphabet, so a code can end in `O` or `I` — `A1-00001-O` is the
  very first code issued. Normalisation deliberately does not fold `O`/`0` or
  `I`/`1`, because folding would corrupt legitimate codes. The failure mode is
  benign — a misread character fails its checksum and staff retries, rather than
  attributing feedback to the wrong participant — but sticker typography should
  use a font that disambiguates. This is a Phase 2 concern.
- **Device clock drift.** `createdAt` comes from the device clock, and offline
  devices are never corrected. Timestamps order events within one device
  reliably and across devices only approximately. Sync and reconciliation must
  not assume a global ordering.
- **Storage eviction.** A browser that evicts the database takes the device
  identity with it, which is the intended behaviour, but it also takes
  unsynchronised records. Backup/export exists partly to bound that risk.
