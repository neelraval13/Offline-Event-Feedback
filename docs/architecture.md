# Architecture

Status: **Phase 2 — Point A registration and QR sticker printing.** This document
describes the architecture the code is being built towards, and marks clearly
what exists today versus what is deferred.

## V1 scope

Single Event → Single Day → Point A (station `A1`) → Point B (station `B1`).

- one event, one day, approximately 10,000 participants
- one registration station and one feedback station
- more than one device may work a station: public codes are namespaced per
  device so parallel desks cannot collide
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
connectivity. This is why the public code is self-validating — a typo in a
manually entered code is caught by its check character locally, with no lookup.
It is also why the code must be unique across every issuing device without
coordination, which is what the issuer segment provides.

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
A1-B8EFD9-00001-X
^^ ^^^^^^ ^^^^^ ^
|  |      |     check character
|  |      device-local registration sequence, zero-padded to at least 5 digits
|  issuing device (see below)
issuing station
```

Case-insensitive on entry and normalised to one canonical stored form.
Separator style is forgiven (`a1 b8efd9 00001 x`, `A1--B8EFD9--00001--X` and
`A1.B8EFD9.00001.X` all parse), and so is under-padding: the check character is
computed over the padded payload, so `A1-B8EFD9-1-X` validates and normalises to
`A1-B8EFD9-00001-X`. The code contains a station, a device namespace and a
counter — no PII (invariant E).

### The issuer segment, and why it exists

IndexedDB is device-local and there is no coordination between devices during
the event. Without the issuer segment, two installations working station A1
would each start their counter at 1 and print `A1-00001-O` for two different
participants. Because the public code is the *manual fallback identity*, that
collision is silent and unrecoverable: Point B cannot tell the two apart, and
neither can the server afterwards.

The issuer is six uppercase hex characters derived deterministically from the
installation's persisted `deviceId` (`src/lib/identity/issuerCode.ts`):

- **Deterministic**, so it is a pure function of identity the device already
  has. Nothing new to persist, nothing to keep in sync, and a device that
  reloads keeps its issuer forever.
- **Hexadecimal**, not base36. `0-9A-F` contains neither `O` nor `I`, so adding
  six characters to a hand-typed code introduces no new glyph ambiguity — which
  matters given `O`/`0` and `I`/`1` are already a known concern for the check
  character.
- **24 bits** (~16.7 million values). For the ~10 devices an event of this size
  runs, the probability that any two share an issuer is about 3 in a million;
  at 100 devices it is still under 1 in 3,000. Measured dispersion over 200,000
  random device IDs matched the uniform birthday expectation almost exactly
  (1,194 collisions against 1,192 predicted).
- **No PII**: the input is a random UUIDv4 that encodes nothing about a person,
  and the output is a truncated hash of it.

The hash is FNV-1a (32-bit) followed by MurmurHash3's `fmix32` finalizer, both
standard published algorithms, both synchronous. A cryptographic digest would be
the reflex choice, but `crypto.subtle` is restricted to secure contexts — the
same trap that rules out `crypto.randomUUID()` here — and this needs dispersion,
not preimage resistance. Nothing about the issuer code is a security control; it
is a namespace.

The issuer is **inside the checksum payload**, so a mistyped issuer segment
fails the check character rather than silently pointing at another device's
namespace. Parsing deliberately offers no `expectedIssuer` option: Point B
receives stickers from every registration device, so constraining the issuer
would reject legitimate codes.

### Check character: ISO 7064 MOD 37-2

Computed over the alphabet `0-9A-Z`, on the payload
`station + issuer + padded sequence` (e.g. `A1B8EFD900001`):

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
  station and issuer characters, so they do not apply without mangling the
  format.
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
(`publicCode:<eventId>:<eventDay>:<stationId>:<issuerCode>`), so a second day, a
second desk, or a second device at the same desk each start their own run rather
than colliding with this one. The counter is device-local and always was —
IndexedDB has no other kind. Including the issuer in both the key and the
printed code is what makes parallel device-local counters safe.

Two devices working the same station therefore issue very nearly the same
*sequence numbers* and entirely disjoint *codes*. The test suite asserts exactly
that: over 2,000 allocations each, more than 90% of sequence numbers are shared
while not one code is.

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
  "code": "A1-B8EFD9-00001-X"
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

## Point A: the registration terminal

`#/a` is the working registration desk. The screen orchestrates; it does not
own identity or storage.

```
staff types name / phone / email
        |
        v
validate  ------ invalid ------> errors beside the fields, nothing written
        |
        v
createRegistration()  ---- throws ----> "could not save", NO sticker, nothing written
        |
        v
IndexedDB transaction committed
        |
        v
QR rendered from the SAVED record  ---- throws ----> "saved, do NOT re-register",
        |                                            retry the sticker
        v
sticker on screen -> Print -> Reprint as often as needed
```

The ordering is the whole point. `useRegistrationTerminal` is the only place it
lives, and a sticker is unreachable before the commit because the record
returned by `createRegistration` is the sole input to the QR payload — there is
no other path to a `Sticker` component. A failed save produces no sticker state
at all, so there is nothing to print.

The screen never generates a participant ID, never formats a public code and
never touches the sequence counter. It passes contact details plus provenance to
storage and treats what comes back as fact.

### Keyboard-first

Name is focused on arrival, tab order runs down the fields to the button, and
Enter submits from any field. Once the sticker is ready focus moves to **Print
sticker**, so a full participant is `type, tab, type, tab, type, Enter, Enter`.
**Next participant** clears the form and returns focus to Name.

Submissions are guarded by a ref rather than by render state, because two fast
Enter presses can both land before React re-renders.

## The sticker

**50 mm × 40 mm**, containing a QR code and the public code beneath it. Nothing
else.

```
+---------------------------+
|      +-------------+      |
|      |             |      |
|      |   QR 26mm   |      |   50mm x 40mm label
|      |             |      |   2mm padding
|      +-------------+      |
|     A1-B8EFD9-00001-X     |   3.2mm, monospace, no wrap
+---------------------------+
```

No name, no phone number, no email — no participant PII of any kind. This is
enforced by the component's shape: `Sticker` takes a public code and
pre-rendered QR markup, **not** a registration record, so there is nothing in
scope that could leak onto a label.

The public code is set in a monospaced face with `font-feature-settings: "zero"
1, "tnum" 1` (slashed zero, tabular figures) and `white-space: nowrap`. The
issuer segment is hexadecimal and so can never contain `O` or `I`; the check
character still can, which is why the typography matters. A wrapped code is a
misread waiting to happen at Point B.

Sizes are declared in millimetres, so the on-screen preview is the printed
artefact at 1:1 rather than an approximation of it.

## QR rendering

The `qrcode` package does the **encoding** — matrix generation, versioning, mask
selection. This codebase turns the resulting matrix into SVG itself
(`src/lib/qr/qrCode.ts`), and does not use `QRCode.toString(..., {type:'svg'})`.

### Why we build the SVG ourselves

Physical QA found a symbol that printed as thin horizontal lines. The package's
SVG draws every dark module as part of one **stroked** path:

```svg
<path stroke="#000000" d="M4 4.5h7m5 0h1m1 0h6..."/>
```

Horizontal segments on half-module y-coordinates, with **no `stroke-width`
attribute at all** — each module's thickness is the SVG default of one user
unit, centred on the line. The symbol carries a viewBox and no intrinsic size,
so one user unit maps to a different number of device pixels depending on the
matrix size. Chrome's print pipeline rasterised that hairline differently for a
45x45 symbol than for a 41x41 one and rounded it to near-nothing. The result
stayed technically scannable, which is worse than failing outright.

That the two sizes both occur is not an edge case. The participant ID is a
random UUIDv7, and the encoder packs digit-heavy UUIDs into numeric segments
while letter-heavy ones fall back to byte mode. Measured over 3,000 real
payloads: **~14% land on 41x41 and ~86% on 45x45**. Consecutive participants get
different matrix sizes at random, which is exactly why one sticker printed
correctly and the next did not.

### What it emits now

No strokes anywhere. Dark modules are **filled rectangles**, with consecutive
dark modules in a row merged into a single rectangle:

```svg
<svg viewBox="0 0 53 53" shape-rendering="crispEdges" role="img">
  <rect x="0" y="0" width="53" height="53" fill="#ffffff"/>
  <rect x="4" y="4" width="7" height="1" fill="#000000"/>
  ...
</svg>
```

- every coordinate is an integer module index — nothing lands on a half pixel
- a filled rectangle covers the area it declares at any scale, in any
  rasteriser, on screen or through a PDF; there is no implicit width to lose
- the viewBox is a fixed square derived from matrix size plus quiet zone, so the
  aspect ratio cannot drift
- no `width`/`height` attributes, so CSS still sizes the symbol to 26 mm
- output stays vector, and is deterministic: the same payload gives byte-identical
  markup, which is what makes a reprint the same sticker

The QR payload contract is untouched.

**Error correction level M** (~15%). Measured against the real payload at 26 mm:

| Level | Version | Modules | Module size |
| --- | --- | --- | --- |
| L | 5 | 37 | 0.58 mm |
| **M** | **6-7** | **41-45** | **0.53-0.48 mm** |
| Q | 8 | 49 | 0.46 mm |
| H | 10 | 57 | 0.40 mm |

Higher correction packs more modules into the same 26 mm, so each module gets
smaller and the symbol gets *harder* to scan — at 203 dpi, H would give barely 3
printer dots per module against M's 4.2. The usual reason to accept that trade
is damage tolerance, but this system already has a designed answer for an
unreadable QR: the public code printed underneath, which staff types instead.

The standard four-module quiet zone is kept. No logo, no tint.

## Printing

Generic browser printing — `window.print()` behind a one-function module. No
vendor SDK, because the printer model is not chosen yet and nothing here needs
one.

### One invocation, one page, one sticker

Physical QA produced **six identical pages** per print. Two causes, both real,
both needed fixing:

1. The application was hidden with `visibility: hidden`. That keeps elements in
   layout — the document stayed as tall as the registration screen, and at a
   40 mm page height it paginated into six pages.
2. The sticker was anchored with `position: fixed`. Fixed-position elements
   **repeat on every page** of paged media, so each of those six pages got its
   own copy of the label.

Hiding the extra pages would not have fixed anything; the print layout itself
had to become one page. The structure now is:

```html
<body>
  <div id="root">…the whole application…</div>
  <div id="print-root">…the sticker, portalled here…</div>
</body>
```

The printable sticker is rendered through a React portal into `#print-root`, a
**sibling** of the application root rather than a node buried inside it. Print
then switches the application off wholesale:

```css
@page { size: 50mm 40mm; margin: 0; }
html, body { width: 50mm; height: 40mm; overflow: hidden; margin: 0; }
#root       { display: none !important; }
#print-root { display: block; }
```

`display: none` removes the app from layout entirely, so the document collapses
to a single 50 mm x 40 mm box in normal flow: one page, one sticker, nothing
positioned fixed. `break-after: avoid` and `overflow: hidden` stop a stray
overflow from generating a trailing blank page.

The on-screen preview is a second instance of the same `Sticker` component with
the same props, so preview and printed copy cannot disagree.

Printing is **not** invoked automatically after a save. The QR must be rendered
and in the DOM before the dialog opens, and a dialog that appears by itself is a
poor thing to put in front of someone working at speed. Instead the print button
takes focus, so Enter prints.

### Printing cannot be confirmed

`window.print()` returns when the dialog closes. The browser does not report
whether the operator pressed Print or Cancel, whether the printer had stock, or
whether the label came out legible. Treating that return as proof of a printed
sticker would be a lie the UI then tells staff.

So the system tracks two separate facts:

| Fact | Knowable? | Consequence |
| --- | --- | --- |
| Registration persisted | Yes — the transaction committed | Invariant 1 turns on this |
| Sticker physically printed | **No** | Operator's judgement; reprint always available |

### Reprint

Reprint re-renders the QR from the stored record and prints again. It creates no
record, moves no counter, and mints no identity — the symbol is identical
because the input is the same committed row. It is available for the current
registration and for any of the recent ones.

## Recovery after a refresh

A refresh throws away screen state, never the record. **Recent registrations on
this device** lists the latest few local registrations, newest first, and each
can be reprinted. It shows public codes and times only — a list of participant
names on a desk-facing screen would be a privacy leak that buys nothing.

This is deliberately not a management dashboard. It is the path back to a
sticker that failed to come out.

## Correcting contact details

Staff can correct name, phone and email on a saved registration.
`updateRegistration` bumps `revision`, refreshes `updatedAt`, and returns the
record to `pending` so an already-uploaded copy gets re-sent. Everything that
identifies the participant — `recordId`, `participantId`, `publicCode`,
`eventId`, `stationId`, `deviceId`, `createdAt` — is immutable: the first three
are printed on a sticker the participant is physically wearing, and the rest
record what happened.

A correction therefore never requires a reprint, because none of it was ever on
the label.

## Failure states at Point A

| Situation | What is written | What staff sees |
| --- | --- | --- |
| Validation fails | Nothing | Errors beside the fields; other values kept |
| IndexedDB write fails | Nothing | "Could not save… nothing was written"; no sticker; print impossible |
| Saved, QR rendering fails | The registration | "Saved — do **not** register again"; public code shown; Retry sticker |
| Saved, printing cancelled or jams | The registration | Sticker stays; Reprint |
| Local storage unavailable at open | Nothing | Banner warning not to register until resolved |

The shape of these matters more than the wording: every state makes it obvious
whether a retry would create a second participant, because that is the mistake a
busy operator is most likely to make.

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

## What exists after Phase 2

- Vite + React + TypeScript project with strict compiler settings
- hash-based client-only routing (`#/a`, `#/b`, `#/admin`)
- typed V1 event/station configuration, with device identity resolved at runtime
- IndexedDB persistence for registrations, feedback and device configuration
- participant ID generation, per-device issuer codes, public code issuing and
  validation
- the QR payload contract: serialiser, parser and validation
- **Point A**: the working registration terminal — validation, durable save, QR
  sticker rendering, printing, reprint, refresh recovery and PII correction
- placeholder screens for Point B, and device diagnostics on Admin
- unit and integration tests for all of the above, against a real IndexedDB
  implementation

## Explicitly deferred

None of the following exists yet:

- QR camera scanning
- Point B manual code entry
- the feedback questionnaire and its workflow
- printer-vendor SDKs and any automatic paper-out/jam detection
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
  full `0-9A-Z` alphabet, so a code can still end in `O` or `I`. Normalisation
  deliberately does not fold `O`/`0` or `I`/`1`, because folding would corrupt
  legitimate codes. The issuer segment is hexadecimal specifically so that it
  cannot add to this problem, which leaves exactly one exposed character per
  code. The failure mode is benign — a misread character fails its checksum and
  staff retries, rather than attributing feedback to the wrong participant — but
  sticker typography should use a font that disambiguates. This is a Phase 2
  concern.
- **Device clock drift.** `createdAt` comes from the device clock, and offline
  devices are never corrected. Timestamps order events within one device
  reliably and across devices only approximately. Sync and reconciliation must
  not assume a global ordering.
- **Storage eviction.** A browser that evicts the database takes the device
  identity with it, which is the intended behaviour, but it also takes
  unsynchronised records. Backup/export exists partly to bound that risk.
