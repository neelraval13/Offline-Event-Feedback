# Architecture

Status: **Phase 7, central reconciliation.** This document
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
6. At **Point B**, staff scans the QR. If scanning fails because of a damaged
   sticker, bad light or a broken camera, staff types the printed public code
   instead.
7. Feedback is collected and durably saved on the Point B device.
8. Later, at any time, both devices synchronise their records to a central
   server.

## The three invariants

These constrain every subsequent design decision.

### 1. No sticker before a durable local save

A participant must never carry a sticker whose registration is not persisted.
The print action is therefore downstream of a confirmed write, never optimistic
and never fire-and-forget. If the write fails, the flow stops and no sticker is
produced. A participant walking around with an identity the system has no record
of is unrecoverable; a retried registration is not.

### 2. Point B needs nothing but the sticker

Everything Point B requires to attribute feedback is physically present on the
participant: the QR payload and the printed public code. Point B does not query
Point A, does not hold a copy of the participant list, and does not need
connectivity. This is why the public code is self-validating: a typo in a
manually entered code is caught by its check character locally, with no lookup.
It is also why the code must be unique across every issuing device without
coordination, which is what the issuer segment provides.

### 3. Synchronisation is idempotent and order-independent

Sync may run at any time, in any order, repeatedly, from either device, without
creating duplicates. Each record is created with a client-generated `recordId`
that acts as the idempotency key; the server upserts on it. Feedback may reach
the server before the corresponding registration does: the server must accept
that ordering and reconcile, not reject it.

## Privacy boundary

| | holds | never holds |
| --- | --- | --- |
| **Point A** | PII (name, phone, email) + participant identity | none |
| **Point B**, sticker paths | participant identity + feedback | participant PII |
| **Point B**, contact path | the rider's own name, phone and email + feedback | any copy of Point A's data |

The QR payload and the public code are opaque identifiers, so a lost or
photographed sticker discloses nothing.

The property that actually matters is not "Point B has no PII"; it is **Point B
never reads Point A**. Those were the same statement for two phases, and then a
rider turned up at Point B with no sticker. They can now give their name, phone
number and email address, and Point B holds them, because for that response
they *are* its identity, not a lookup result. The invariant is unchanged:
nothing at Point B consults, mirrors or requires the participant database, and
whether a rider's details happen to match a registration is a question nobody
at the desk asks or could answer.

So the contact path holds PII, and only for the responses that carry it. A
scanned or typed response has no name, phone or email anywhere on it, and the
database refuses one that does: `feedback_identity_shape` (migration 008)
permits exactly three identity shapes and no combination of them. A build that
started attaching contact details to a scanned response would fail on insert
rather than quietly widening the boundary.

Re-joining feedback to a participant is a **central-server** concern, performed
after synchronisation, never a field concern. That is true of a manually typed
code and equally true of contact details: reconciliation matches a contact
response to a registration only when the normalised phone *and* the normalised
email both match, and exactly one registration in the event has that pair.
Never a name, never one half of the pair alone. When nothing matches, the
response is `standalone`, which means a rider who did not register, and is a
valid outcome rather than a failure to look anything up.

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
matter of supplying different configuration and filtering data, not of
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
get subtly wrong, and transaction correctness is precisely what the public
code sequence depends on.

Database `offline-event-feedback`, schema version **1**:

| Store | Primary key | Indexes | Holds |
| --- | --- | --- | --- |
| `registrations` | `recordId` | `&participantId`, `&publicCode`, `syncStatus`, `createdAt` | Point A records, including PII |
| `feedback` | `recordId` | `publicCode`, `participantId` (sparse), `syncStatus`, `createdAt` | Point B records |
| `deviceConfig` | `key` | none | values belonging to this browser install |
| `sequences` | `key` | none | one monotonic counter per issuing scope |

`&` marks a unique index. A duplicate participant ID or public code is refused
by the database itself rather than by application code that might not run.
`feedback.publicCode` is deliberately *not* unique: nothing offline can rule out
a participant being recorded twice, and silently dropping the second record
would destroy evidence the server needs to reconcile. `feedback.participantId`
is sparse, manual-entry records omit the field entirely rather than storing
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
rolls the counter back rather than burning a code, or, worse, handing the same
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

**`participantId`: UUIDv7**, generated offline with no central sequence
(`src/lib/identity/uuid.ts`). Two reasons for the `uuid` package over
`crypto.randomUUID()`:

1. `crypto.randomUUID()` is restricted to **secure contexts**. This app may well
   be served at a venue from a laptop over plain HTTP on a LAN address, where it
   is simply `undefined`. `crypto.getRandomValues`, which the package uses,
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
counter: no PII (invariant E).

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
  six characters to a hand-typed code introduces no new glyph ambiguity, which
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
the reflex choice, but `crypto.subtle` is restricted to secure contexts, the
same trap that rules out `crypto.randomUUID()` here, and this needs dispersion,
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
  showed it misses a small class of adjacent transpositions; those where the
  two characters differ by exactly 1 in value. In a zero-padded numeric sequence
  that class is dominated by `0`↔`1` swaps, which is precisely the typo manual
  entry is most likely to produce, so the trade was not worth taking.
- A prime modulus buys total detection instead. The price: 1 payload in 37
  yields check value 36, which has no character in a 36-symbol alphabet. Those
  sequence numbers are **skipped at issue time** (~2.8% of the counter), which
  costs nothing: the sequence is a ticket dispenser, not a census.

The check character detects transcription mistakes. It is **not** a signature,
authenticates nothing, and anyone can compute one.

### Local sequence and transaction semantics

Counters live in the `sequences` store, keyed per issuing scope
(`publicCode:<eventId>:<eventDay>:<stationId>:<issuerCode>`), so a second day, a
second desk, or a second device at the same desk each start their own run rather
than colliding with this one. The counter is device-local and always was.
IndexedDB has no other kind. Including the issuer in both the key and the
printed code is what makes parallel device-local counters safe.

Two devices working the same station therefore issue very nearly the same
*sequence numbers* and entirely disjoint *codes*. The test suite asserts exactly
that: over 2,000 allocations each, more than 90% of sequence numbers are shared
while not one code is.

A read-modify-write on a counter is the textbook way to hand out duplicates, so
the increment never happens outside a readwrite transaction:

- IndexedDB runs readwrite transactions with overlapping scopes strictly one at
  a time, so two allocations cannot interleave their read and their write,
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
scans a QR code in this phase**: the boundary is locked now so Point A and
Point B share one versioned identity contract instead of two implicit ones.

```json
{
  "v": 1,
  "event": "ff-rc-2026-08-23",
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
a payload, and it copies the three identity fields explicitly, never by
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
returned by `createRegistration` is the sole input to the QR payload; there is
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

No name, no phone number, no email: no participant PII of any kind. This is
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

The `qrcode` package does the **encoding**: matrix generation, versioning, mask
selection. This codebase turns the resulting matrix into SVG itself
(`src/lib/qr/qrCode.ts`), and does not use `QRCode.toString(..., {type:'svg'})`.

### Why we build the SVG ourselves

Physical QA found a symbol that printed as thin horizontal lines. The package's
SVG draws every dark module as part of one **stroked** path:

```svg
<path stroke="#000000" d="M4 4.5h7m5 0h1m1 0h6..."/>
```

Horizontal segments on half-module y-coordinates, with **no `stroke-width`
attribute at all**; each module's thickness is the SVG default of one user
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

- every coordinate is an integer module index; nothing lands on a half pixel
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
smaller and the symbol gets *harder* to scan, at 203 dpi, H would give barely 3
printer dots per module against M's 4.2. The usual reason to accept that trade
is damage tolerance, but this system already has a designed answer for an
unreadable QR: the public code printed underneath, which staff types instead.

The standard four-module quiet zone is kept. No logo, no tint.

## Printing

Generic browser printing, `window.print()` behind a one-function module. No
vendor SDK, because the printer model is not chosen yet and nothing here needs
one.

### One invocation, one page, one sticker

Physical QA produced **six identical pages** per print. Two causes, both real,
both needed fixing:

1. The application was hidden with `visibility: hidden`. That keeps elements in
   layout: the document stayed as tall as the registration screen, and at a
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
| Registration persisted | Yes: the transaction committed | Invariant 1 turns on this |
| Sticker physically printed | **No** | Operator's judgement; reprint always available |

### Reprint

Reprint re-renders the QR from the stored record and prints again. It creates no
record, moves no counter, and mints no identity: the symbol is identical
because the input is the same committed row. It is available for the current
registration and for any of the recent ones.

## Recovery after a refresh

A refresh throws away screen state, never the record. **Recent registrations on
this device** lists the latest few local registrations, newest first, and each
can be reprinted. It shows public codes and times only: a list of participant
names on a desk-facing screen would be a privacy leak that buys nothing.

This is deliberately not a management dashboard. It is the path back to a
sticker that failed to come out.

## Correcting contact details

Staff can correct name, phone and email on a saved registration.
`updateRegistration` bumps `revision`, refreshes `updatedAt`, and returns the
record to `pending` so an already-uploaded copy gets re-sent. Everything that
identifies the participant, `recordId`, `participantId`, `publicCode`,
`eventId`, `stationId`, `deviceId`, `createdAt`, is immutable: the first three
are printed on a sticker the participant is physically wearing, and the rest
record what happened.

A correction therefore never requires a reprint, because none of it was ever on
the label.

## Failure states at Point A

| Situation | What is written | What staff sees |
| --- | --- | --- |
| Validation fails | Nothing | Errors beside the fields; other values kept |
| IndexedDB write fails | Nothing | "Could not save… nothing was written"; no sticker; print impossible |
| Saved, QR rendering fails | The registration | "Saved, do **not** register again"; public code shown; Retry sticker |
| Saved, printing cancelled or jams | The registration | Sticker stays; Reprint |
| Local storage unavailable at open | Nothing | Banner warning not to register until resolved |

The shape of these matters more than the wording: every state makes it obvious
whether a retry would create a second participant, because that is the mistake a
busy operator is most likely to make.

## Point B: the feedback terminal

`#/b` is the working feedback station. Two ways in, one way through:

```
   Start scanner                     Enter code manually
        |                                    |
        v                                    v
   camera decodes QR                 staff types the printed code
        |                                    |
        v                                    v
   parseQrPayload                     parsePublicCode
   (event + station + checksum)       (station + checksum)
        |                                    |
        +----------------+-------------------+
                         v
              this device already has
              feedback for this code?  --yes--> already-recorded
                         | no
                         v
                  feedback-v1 form
                         v
                      saving
                         v
              IndexedDB commit --fails--> back to the form, answers intact
                         v
                     success --> next participant --> scanner resumes
```

Neither path touches Point A. There is no registration data on this device and
the code never asks for any.

### One explicit state machine

`usePointBTerminal` holds a single discriminated union, `idle`,
`starting-camera`, `scanning`, `camera-error`, `manual-entry`, `feedback`,
`saving`, `already-recorded`, `success`, rather than a handful of booleans.
With flags, "saving" and "already recorded" and "camera error" can all be true
at once and the screen has to guess which to believe; here they cannot be.

The in-progress answers live in the hook rather than inside the form, which is
what makes "a save failed, keep every answer" true by construction instead of by
careful component choreography.

## Scanner boundary

`src/lib/scanner` is the seam. React components talk to a `QrScanner`
interface, `start` / `pause` / `resume` / `dispose`, and never to ZXing.

**`@zxing/browser`**, bundled locally. `BrowserQRCodeReader` decodes QR only;
the multi-format readers try every barcode symbology on every frame, which costs
CPU on a tablet and can only produce results this app would reject. Decoding
happens on frames in this process: no image ever leaves the device, and there is
no remote decoding service anywhere in the path.

The interface exists for two reasons. The lifecycle is genuinely awkward, a
live `MediaStream` that must be released or the camera light stays on after
navigation, and tests must drive decode callbacks without a camera. The suite
uses a `FakeScanner` implementing the same interface.

### Camera lifecycle

- **Nothing starts on its own.** The camera is requested when staff press
  *Start scanner*, never on page load.
- **Rear camera preferred** via `facingMode: 'environment'`, as a hint rather
  than an `exact` constraint, so a laptop with only a front camera still works.
  There is no device-picker UI in V1.
- **`pause` is not `dispose`.** Accepting an identity pauses decoding while the
  camera stays authorised and running, so moving to the next participant does
  not re-prompt for permission or pay the warm-up cost again. Only `dispose`
  releases hardware.
- **Unmount releases everything.** Leaving `#/b` stops the reader and every
  media track. Without that the capture light stays on after navigating away.

### Decoding once, not forty times

A stationary sticker decodes on every video frame, dozens of callbacks for one
participant. Acceptance is gated on a **ref that flips synchronously**, before
any await:

```ts
if (!acceptingRef.current) return
// ...validate...
acceptingRef.current = false   // latch first
scannerRef.current?.pause()    // then stop decoding
```

React state cannot do this job: it updates on the next render, by which time
more frames have arrived. Frames already in flight when `pause()` is called
still arrive, and the ref is what turns them away. The test suite fires forty
raw decodes through the pause to prove it.

Rejected payloads do not latch, scanning continues, but a repeated identical
rejection is silent, so one wrong sticker held in view does not re-render
forever.

### Camera failures

`permission-denied`, `no-camera`, `camera-busy`, `insecure-context`,
`unsupported` and `failed` are classified from the browser's DOMException names
and turned into plain wording. The raw message is never shown: *"NotReadableError:
Could not start video source"* tells an operator nothing they can use.

`insecure-context` deserves its own name. `navigator.mediaDevices` is undefined
outside a secure context, so a venue laptop serving over plain HTTP on a LAN
address can never start a camera, and without saying so, that is
indistinguishable from a broken one. Manual entry works on any origin, which is
the point of having it.

**Every** camera failure leaves manual entry available. Point B is fully
operational on a device with no working camera at all.

## QR validation at Point B

Every decoded string is untrusted. The camera will happily read a conference
badge, a Wi-Fi QR, a poster URL, or a sticker from last year's event.

`captureIdentityFromQr` requires, through the existing parser:

- a supported payload version
- `event` equal to this event
- `code` issued by the registration station, `A1`
- `participant` a valid UUID
- the public code re-validated against its own check character, rather than
  trusted for having arrived inside a payload

A rejection shows one short sentence, opens no form, persists nothing, and
leaves the scanner running.

## Manual fallback

Staff types the code printed under the QR. Normalisation and checksum validation
belong to the identity layer and are **not** repeated in React: the tolerance
already built in (case, separator style, under-padded sequences) applies exactly
as it does everywhere else. Re-implementing any of it in a component is how two
different notions of "the same code" start to exist.

A manual capture deliberately has **no `participantId`**. The printed code does
not contain one and Point B cannot look one up, so inferring one would be
fabricating data. The field is absent, not null.

| Capture | `captureMethod` | `participantId` | `publicCode` |
| --- | --- | --- | --- |
| QR scan | `qr` | from the payload | from the payload |
| Manual entry | `manual` | **absent** | normalised from what was typed |

Re-joining a manual record to a participant is central reconciliation's job
after synchronisation.

## The `feedback-v1` questionnaire

Four questions, locked:

| ID | Prompt | Stored |
| --- | --- | --- |
| `overall_rating` | Overall rating | `1`–`5`, required |
| `experience` | How was your experience? | `very_poor` \| `poor` \| `okay` \| `good` \| `excellent`, required |
| `recommend` | Would you recommend this experience? | boolean, required |
| `comments` | Any comments? | string, optional, ≤2000 chars |

Visible labels ("Very Poor") live with the form; stored values (`very_poor`)
live in `src/types/feedback.ts`. Keeping them apart lets the wording change, or
be translated, without touching a recorded answer's meaning.

A blank or whitespace-only comment is stored as **absent**, not as an empty
string, so "said nothing" and "typed three spaces" do not become different data.

Every record carries `formVersion: 'feedback-v1'`. A second questionnaire adds a
member to the answers union and a value to `FeedbackFormVersion`; `formVersion`
is what tells a later reader which shape it is holding. Adding the field needed
**no IndexedDB migration**; it is not indexed, and IndexedDB stores are
schemaless apart from their indexes.

The choices are large buttons rather than radio inputs, carrying selection state
in `aria-pressed`. A native radio is a 13-pixel target, and this is the single
interaction the entire station exists to collect.

## Duplicate feedback on the same device

Before opening a form, Point B checks its **own** feedback store for the same
public code. If one exists it shows *Feedback already recorded on this device*,
offers only *Scan next participant*, and neither overwrites nor deletes
anything.

Scoped to this device on purpose. Point B terminals are independent offline
clients with no way to see each other's records, so this catches the mistake
that actually happens, the same operator scanning the same sticker twice, and
makes no claim about the event as a whole. The database still permits repeated
public codes, because cross-device duplicates must stay representable for the
server to reconcile. No supervisor override exists in V1.

## Failure states at Point B

| Situation | What is written | What staff sees |
| --- | --- | --- |
| Invalid or foreign QR | Nothing | One short sentence; scanning continues |
| Invalid typed code | Nothing | Error beside the field; the code stays typed |
| Camera denied/missing/busy | Nothing | *Camera unavailable*, retry, and manual entry |
| Camera dies mid-shift | Nothing | *Camera unavailable*; manual entry still works |
| Already recorded here | Nothing | *Already recorded*; the earlier record untouched |
| IndexedDB write fails | Nothing | *Feedback was not saved*; every answer kept; no success; scanner stays paused |
| Submit tapped twice | One record | One success |

## Point B holds no registration PII

Point B's database has `feedback` and `deviceConfig` rows and nothing else. It
never imports the registration repository, never queries it, and has no name,
phone or email in scope to display even accidentally. The screen shows the
public code and nothing more, for staff confidence.

The test suite proves the strong form: a Point A registration is planted in the
test database, a scan is completed against it, and the rendered output is
asserted to contain none of that participant's details. In the field the record
would not be there at all.

## The offline application shell

Everything before this phase removed the network from *operations*. This phase
removes it from *starting up*.

The distinction matters more than it sounds. Point A and Point B were tested
with the Internet disconnected while a local dev server kept serving the app,
which proved there are no API calls, no CDN, no lookups. It proved nothing about
what happens when the server itself is gone. A venue laptop that sleeps, a
process that dies, a tab reopened the next morning: any of those and the app
would simply not load.

**vite-plugin-pwa** with the **`generateSW`** strategy. What is needed here is
deterministic precaching of the built shell, which is exactly what the generated
worker does. `injectManifest` would mean owning a service-worker source file,
more surface to get wrong, and nothing gained until there is a server to sync
with. There is no background sync, no runtime API caching, no push.

### What is precached

Everything the build emits, verified rather than assumed:

| Entry | Why |
| --- | --- |
| `index.html` | the only document; every hash route resolves from it |
| `assets/index-*.js` | ~830 kB. React, Dexie, `qrcode`, the ZXing scanner |
| `assets/workbox-window.prod.es5-*.js` | the registration client |
| `assets/index-*.css` | all styling, including the print rules |
| `manifest.webmanifest` | installability |
| `icons/icon-{192,512,maskable-512}.png` | installability |

`maximumFileSizeToCacheInBytes` is raised to 8 MiB. Workbox's 2 MiB default
would silently drop the main bundle, leaving a device that reports itself ready
and then cannot scan once the network is gone, precisely the failure this
phase exists to prevent.

**The scanner is never lazily fetched.** A dynamically imported chunk needs the
network at the moment staff press *Start scanner*, which is when the device is
offline by design. Everything ships in one eagerly-loaded bundle.

`scripts/verify-pwa-build.mjs` runs as part of `pnpm build` and fails the build
if any emitted JS or CSS asset is missing from the precache manifest, if the
navigation fallback is absent, or if the worker would activate without being
asked. It is checked against a deliberately broken manifest, so it is known to
catch the case rather than merely assert it.

### Hash routes and the navigation fallback

`#/a`, `#/b` and `#/admin` are all the same document, so the worker registers a
`NavigationRoute` that serves the precached `index.html` for any navigation. The
client router then resolves the hash. This is why hash routing was chosen in
Phase 0 and why it still earns its place: no server rewrite rule exists offline
to be depended on.

### Offline readiness is a real state, not a guess

```
unsupported ── no service worker (a dev build, or an old browser)
preparing   ── registering, or precaching not yet confirmed
ready       ── the shell is precached and a worker controls this page
failed      ── registration or precaching failed; this device is not field-safe
```

`navigator.onLine` is deliberately **not** part of this model. It reports
whether a network interface believes it has a link, which answers a different
question: a device can be online and completely unprepared, or offline and
perfectly ready. Readiness means *the shell is on disk*, and only the service
worker can attest to that.

Two signals establish `ready`. Workbox's `onOfflineReady` fires once, when
precaching completes on first install. On every later visit it never fires
again, so readiness is also derived from a worker **controlling the page**,
which means the shell is being served from cache at that very moment, the
strongest evidence available.

A device never claims readiness merely because registration was *started*.

### Updates wait for an operator

`registerType: 'prompt'`, and the generated worker calls `skipWaiting()` only in
response to a message the Admin screen sends.

An event terminal must never reload itself. A half-typed participant at Point A,
or a participant mid-questionnaire at Point B, would lose their input to a
deployment that happened to land at the wrong moment. So:

- a new version downloads and **waits**
- the running version keeps working, and stays `ready`
- **Point A and Point B say nothing at all** about updates: the only control is
  on `#/admin`, where nobody is holding a queue
- applying reloads the page, deliberately, because an operator pressed a button

Updates should be applied before a shift, not during participant handling.

### Cache Storage is not IndexedDB

| | Cache Storage | IndexedDB |
| --- | --- | --- |
| Holds | application code, CSS, icons | **participant records** |
| Written by | the service worker | the application |
| Losing it costs | a re-download | **the event's data** |

Installing, updating and resetting the shell touch only the first. Nothing in
`src/lib/pwa` imports the storage layer, and no service-worker lifecycle code
opens the database. `deviceId` lives in IndexedDB and therefore survives
install, activation, update, PWA installation and offline relaunch.

The precache contains application code and static assets only. No participant
PII is ever written to Cache Storage, no URL contains a name, phone, email or
comment, and no lifecycle code logs anything about a participant.

### Resetting the app cache safely

Chrome's **Clear site data** clears Cache Storage *and* IndexedDB. On a device
holding a day of registrations that is data loss, and there is no export yet.

To reset only the application cache:

1. DevTools → Application → Service Workers → **Unregister**
2. DevTools → Application → Cache Storage → right-click the
   `workbox-precache-*` entry → **Delete**
3. Reload

IndexedDB is untouched by both steps. **Do not use Clear site data for PWA
debugging.**

`pnpm dev` runs with no service worker at all (`devOptions.enabled: false`), so
ordinary development never fights a stale cached shell. PWA behaviour is tested
against `pnpm build && pnpm preview`.

### Application version

`APP_VERSION` and `BUILD_ID` are injected at build time and shown on Admin, so
an operator can answer "what is this device running?" and compare two terminals
with no network, no server and no repository access. Deliberately just a package
version and an ISO build timestamp: no commit hash, no branch, nothing about
the machine that produced the build.

### Secure context

The service worker and the camera both require a secure context. `localhost` is
fine for development; the field deployment must be **HTTPS**. A plain-HTTP LAN
address gets neither an offline shell nor a camera, and no workaround for that
is being added; see the Point B notes.

### Icons

`public/icons/*.png` are **temporary placeholders**: a flat accent-blue tile
with an "EF" mark, generated by `scripts/generate-icons.mjs` with no
dependencies and no network. There is no final branding yet and none is being
invented. Replacing them is a matter of dropping new PNGs into `public/icons/`;
nothing in the architecture depends on what they look like.

## Encrypted backup and restore

Until this phase, unsynchronised records existed on exactly one machine. A
dropped laptop or a browser that lost its storage took an event's registrations
with it. Backup closes that gap; there is still no server, and nothing here
touches the network.

### Two layers

A `.oefbackup` file is an **envelope** wrapping a **payload**.

```json
{
  "format": "offline-event-feedback-backup",
  "version": 1,
  "kdf":    { "algorithm": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "..." },
  "cipher": { "algorithm": "AES-GCM", "iv": "..." },
  "ciphertext": "..."
}
```

That is the entire plaintext. Everything else, records, counts, event, source
device, lives inside the ciphertext. Someone holding the file without the
passphrase learns that it is a backup of this application and **nothing more**:
not the event, not how many participants, and above all not who.

The filename carries a timestamp and nothing else, because a filename is visible
in a file manager and an email client long before anyone types a passphrase.

### Encryption

PBKDF2-SHA-256, **600,000 iterations**, a random 16-byte salt, deriving a
256-bit AES-GCM key with a random 12-byte IV. Salt and IV come from
`crypto.getRandomValues`; the derived key is non-extractable.

AES-GCM rather than AES-CBC because it **authenticates**. A wrong passphrase, a
flipped byte, an altered IV and a truncated file all fail the same way, and none
of them can produce partially decoded records. The UI reports one message for
all of them: which it was helps an attacker more than an operator, and the
operator's next move (check the passphrase, check the file) is the same
regardless.

Encrypting the same snapshot twice produces two different files. Fresh salt and
IV per run is not a quirk to be normalised away: reusing an AES-GCM IV under one
key is catastrophic, and deterministic output would also reveal that two backups
hold identical data.

**The passphrase is never stored**: not in IndexedDB, not in localStorage, not
in a URL, not in a log, and the input fields are cleared after every operation.
There is no recovery mechanism and no pretence of one.

A backup declares its own iteration count, which it must, or an older file could
never be opened. That value is attacker-controlled, so it is bounded before any
work is done with it; an unbounded one would let a single click freeze the
browser.

### One coherent snapshot

All four stores are read inside a single Dexie read transaction. Reading them
one at a time would let a registration land between two reads, producing a
backup whose sequence counter had not moved: a file that looks valid and
quietly reissues a printed code on restore.

Arrays are sorted before serialisation, so two snapshots of an unchanged
database are identical and the plaintext is reviewable.

### Validated before it is encrypted

The snapshot is checked with **the same validator the restore path runs on
untrusted files**, record shapes, UUIDs, public-code check characters, event
match, uniqueness, declared counts. If the local database has drifted into a
state this application would refuse to restore, no file is produced.

A backup of corrupt data is worse than no backup: it cannot be used, and the
operator believes the device is protected.

### Restore files are untrusted input

A restore file arrives from a USB stick, an email attachment, a shared drive.
`JSON.parse` succeeding says nothing about whether it is safe to merge into a
database holding an event's records. Everything crosses the boundary as
`unknown` and becomes typed only after being checked field by field. No branded
cast is applied to unvalidated input.

Validation is hand-written rather than delegated to a schema library. The shapes
are few and stable, and the interesting checks are not shape checks at all: a
public code has to satisfy its own check character, a `qr` capture has to carry a
participant ID while a `manual` one must not, the event has to match this build.
Those rules already exist in the identity layer; a library would either duplicate
them or need bridging back into it.

Every validation message is structural, a field name and an index, so a
failure can never print a participant's name or email.

A file is refused before parsing if it exceeds **64 MiB**. A full
10,000-participant backup measures about 12 MB.

### Event compatibility

V1 is one event on one day, so a backup restores only into a build configured for
the same `eventId` and `eventDay`. Records are checked individually, not just the
header. Merging another event's records into this database would corrupt both.

### Restore is a merge, never a replace

The destination database is **never cleared**. The most likely restore is onto a
device that has already started working, and wiping it to make room for older
data would destroy exactly the records nobody else has a copy of.

`recordId` is the identity for both stores.

| Situation | Outcome |
| --- | --- |
| Not present locally | insert as captured |
| Identical | skip |
| Same identity, backup revision higher | take the backup's |
| Same identity, local revision higher | keep local |
| **Same revision, different contents** | **conflict, abort** |
| Same `recordId`, different identity or provenance | **conflict, abort** |
| Backup `participantId` or `publicCode` already belongs to another local record | **conflict, abort** |

Immutable fields, `kind`, `recordId`, `participantId`, `publicCode`, `eventId`,
`eventDay`, `stationId`, `deviceId`, `createdAt`, may never differ between two
copies of one record. A participant ID or public code is printed on a sticker
somebody is wearing; provenance records what actually happened. If two copies
disagree on any of them, they are not the same record and no merge rule can make
them one.

Equal revisions with different contents is a genuine conflict. Guessing which
side is authoritative would silently discard somebody's data, so the restore
stops instead.

Feedback merges by `recordId` only. **Feedback public codes are deliberately not
unique**: two Point B terminals may each hold a response for the same
participant, and both must survive for the server to reconcile later.

`syncStatus`, `revision` and `updatedAt` are preserved exactly. Restore does not
mark records `pending`, synchronisation semantics belong to a later phase and
inventing them here would corrupt whatever that phase decides.

### Sequences take the maximum

```
restored value = max(local, backup)
```

A counter is never lowered. An older backup restored onto a device that has kept
working would otherwise reissue public codes that are already printed and on
participants, reintroducing, through recovery, the exact collision the
per-device issuer was built to eliminate.

### Atomicity

The whole merge runs in one readwrite transaction across registrations, feedback
and sequences. Any conflict throws, the transaction aborts, and **nothing** is
committed, not the 99 good records that preceded the bad one. A half-restored
database cannot be reasoned about or safely retried.

Restoring the same file twice is idempotent: the second pass reports everything
as unchanged and writes nothing.

### Device identity is never cloned

A backup records `sourceDeviceId` for provenance. Restoring it onto another
installation does **not** make that installation the source device.

```
failed device        DEVICE-A
replacement          DEVICE-B

after restoring A's backup onto B:
  restored records   keep deviceId DEVICE-A     (provenance preserved)
  the installation   remains DEVICE-B
  new registrations  deviceId DEVICE-B, DEVICE-B issuer namespace
```

If DEVICE-A ever came back into service, a cloned identity would give two
independent offline machines the same public-code namespace: the collision
Phase 1.1 exists to eliminate, reintroduced by the recovery procedure.

**No `deviceConfig` key is imported at all.** The store is captured in the
payload for diagnostics, and restore reads none of it. The destination keeps its
`deviceId`, and the backup bookkeeping keys below keep describing the device in
front of the operator rather than one that failed last week.

| `deviceConfig` key | Restored? |
| --- | --- |
| `deviceId` | **No**: the destination keeps its own |
| `lastBackupGeneratedAt` | No, describes this installation |
| `lastBackupVerifiedAt` | No, describes this installation |
| `lastRestoreAt` | No, describes this installation |

Restored registrations keep their `participantId`, `publicCode` and `recordId`
exactly, so the stickers participants are already wearing stay valid. A new
device ID for future registrations does not invalidate old stickers.

### Generated is not stored; verified is evidence

The browser cannot report whether the operator kept a downloaded file, so the UI
says **"Backup file generated"** and never "safely stored". Two timestamps are
tracked, and they mean different things:

- `lastBackupGeneratedAt`: a file was produced. Weak evidence.
- `lastBackupVerifiedAt`: a file was **selected back off disk and successfully
  decrypted**. That is real evidence the device is protected.

Verification imports nothing. It exists so an operator can establish a file is
recoverable *before* trusting it, and before a real recovery, when the original
device may no longer exist.

### Everything works offline

Backup, verification and restore are pure local computation over IndexedDB and
Web Crypto. No network call is involved at any point, and nothing about them is
placed in Cache Storage: the precache holds application code only, never
participant data.

## Central synchronisation

The first networked component. Local capture stays authoritative for the field;
the server becomes authoritative for consolidation. **No event operation depends
on synchronisation succeeding**, with the server switched off, every earlier
phase behaves exactly as it did.

```
offline local capture  ->  Internet eventually  ->  idempotent upload  ->  Postgres
```

### At-least-once, and why that is fine

The same record may legitimately be sent once, twice or ten times. A device
cannot distinguish "the request never arrived" from "the response was lost", so
it keeps the record pending and sends it again. `recordId`, generated on the
capturing device, printed indirectly on a sticker, is the idempotency key, and
the server returns `already_current` for a record it already holds. Nothing is
duplicated and the device can finally stop.

No server-side record identity is generated. A central ID would break the link
to the sticker a participant is wearing.

### Repository shape

The Vite application is untouched. A small server sits alongside it:

```
server/     Hono on Node, Postgres, migrations, tests
shared/     The wire contract, imported by both sides
src/lib/sync/   The client outbox
```

**One protocol definition, shared.** Two independently written validators drift,
and the drift shows up as records that upload from one build and are rejected by
another, at an event, with no way to diagnose it. Zod earns its place here
because both sides consume the same schemas; the server parses every request
with them, because TypeScript types do not survive an HTTP boundary.

`postgres` (porsager) is used as a plain tagged-template SQL client, not an ORM.
The interesting logic is conditional upserts, and those need to be read exactly
as written.

### Schema

`registrations` and `feedback` keyed by `record_id`, plus `sync_devices` and a
counts-only `sync_batches` audit table. Two decisions worth stating:

- **`feedback.public_code` is not unique**, and there is **no foreign key** to
  `registrations`. Two terminals may each hold a response for one participant,
  and feedback may reach the server before the registration it refers to. Both
  are ordinary, and ingest must not resolve either.
- **`registrations` has unique indexes** on `(event_id, participant_id)` and
  `(event_id, public_code)`. Two devices uploading the same record at the same
  instant is a race, and the database is what settles it.

Migrations are applied by `pnpm server:migrate`, never on startup: a process
restart must not be able to alter a schema holding an event's data.

### Enrolment, not a shared secret

A single API key inside the PWA would not be a secret: the bundle is readable.
Instead an operator types a shared enrolment code once, on a device with
Internet, and the device receives **its own** 256-bit token. The server stores
only a SHA-256 hash, so a leaked database yields no usable upload credential.
The plaintext exists exactly once, in the enrolment response.

The enrolment code is compared in constant time and is never persisted on either
side. A wrong code always produces the same answer, so nothing leaks about how
close a guess was.

Plain SHA-256 rather than a password KDF is deliberate: the token is a 256-bit
random value with no dictionary to attack, so an expensive KDF would slow every
ingest request and buy nothing.

### Uploader is not the source device

The distinction Phase 5 makes unavoidable:

```
record.deviceId          the device that CAPTURED the record
uploaderDeviceId         the device DELIVERING it now
```

After a recovery these differ, and requiring them to match would make every
restored record permanently unsyncable. The server therefore stores
`source_device_id` from the record and `last_uploader_device_id` from the
authenticated device, and never compares them.

What it does require: the token's event matches the batch's event, the token's
device matches the claimed uploader, and every record belongs to the
authenticated event.

### Ingest semantics

For a given `recordId`:

| Incoming | Outcome |
| --- | --- |
| Not present centrally | insert → `accepted` |
| Participant or public code owned by another record | `conflict` |
| Immutable identity or provenance differs | `conflict` |
| Revision higher | update mutable fields → `accepted` |
| Revision equal, contents identical | `already_current` |
| **Revision equal, contents differ** | **`conflict`** |
| Revision lower | `server_newer`, central row untouched |

Never last-write-wins. Equal revisions with different contents means two devices
believe different things about the same record, and guessing would silently
discard somebody's capture.

Responses carry outcomes only: no name, phone, email or answers. The ingest API
is write-oriented, and nothing about a person needs to travel back to a device
that already has it.

### Batch semantics

One `POST /v1/sync/batch`, at most 100 records. A malformed **envelope** rejects
the whole request; there is no sensible per-record answer when the batch itself
cannot be parsed. Records inside a well-formed batch are processed
independently: 98 accepted, 1 already current and 1 conflicting commits the 99
and reports all 100. A single conflict must never strand real captures that are
sitting on one device.

### The client outbox

```
pending records -> wire DTOs -> batches of 100 -> POST -> per-record result
```

Wire records are built field by field, never spread, so transport bookkeeping
cannot leak onto the network and a new local field cannot silently break the
batch.

There is deliberately **no persisted `syncing` state**. A browser closed
mid-request would strand every record in it forever, and since ingest is
idempotent there is nothing to gain. Records stay `pending` until the server has
actually said something about them.

### Transport state is not a domain revision

This is the sharpest edge in the phase. `updateRegistration` increments
`revision` on every call, appropriate for a correction at Point A, catastrophic
for an acknowledgement. Marking a record synced through it would raise the
revision, the server would see a higher revision carrying identical contents,
and the two would ratchet against each other indefinitely.

So synchronisation uses dedicated functions in `src/lib/storage/transport.ts`
that touch `syncStatus`, `lastSyncedAt` and `syncErrorCode` and **nothing
else**, not `revision`, not `updatedAt`, not identity.

| Concern | Fields | Meaning |
| --- | --- | --- |
| Domain | `revision`, `updatedAt` | what a person changed |
| Transport | `syncStatus`, `lastSyncedAt`, `syncErrorCode` | whether it arrived |

A record corrected at Point A returns to `pending` with a higher revision and
uploads normally on the next sync.

### Failure behaviour

| Situation | Local records |
| --- | --- |
| Offline, timeout, 5xx, dropped connection | stay **pending**, retried later |
| `accepted` / `already_current` | **synced** |
| `conflict` / `invalid` / `server_newer` | **error** with a non-PII code, not retried |

Transient failures never mark a record permanently in error: nothing is known to
be wrong with it. Requests are abandoned after 25 seconds via `AbortController`
rather than hanging until the browser gives up.

The wording matters. A failed sync says the records are *safe and pending*,
never "failed" or "lost", because they are neither.

### Manual and opportunistic

**Sync now** is the operator control. Beyond that: one attempt when Admin opens,
and one when the browser fires `online`. No polling, no background sync,
no service-worker sync API. `navigator.onLine` is treated as a hint, it reports
a link, not a reachable server, so an opportunistic failure is silent, visible
only in Admin.

Point A and Point B display nothing about synchronisation at all.

### Interaction with earlier phases

**Backups exclude the sync credential.** A device token is not event data:
carrying it would make a backup file a reusable server credential, and restoring
it would hand a replacement machine the failed one's upload identity. A
replacement enrols itself. `deviceId` stays in the backup exactly as before;
that is provenance.

**The service worker does not cache sync.** Precaching is GET-only over built
assets; there is no runtime caching rule at all, so `POST /v1/sync/*` is always
network-only. Startup never waits on `/health`, `/enroll` or `/sync`.

**Restore compares domain contents only.** Synchronisation actively changes
`syncStatus`, so two copies of one record will routinely disagree about
delivery. Comparing transport state during a merge reported conflicts for
records that were identical in every meaningful sense; see the regression note
below.

## Central reconciliation

Phase 6 got records to the server. Phase 7 asks what they mean together: which
feedback belongs to which registration, which registrations never got a
response, and which records look like they might describe the same person.

### Derived data, not a rewrite

`registrations`, `feedback`, `sync_devices` and `sync_batches` are **evidence**:
the account of what devices actually captured. Reconciliation never edits,
merges or deletes any of them. Conclusions go into separate
`reconciliation_*` tables.

That separation is what makes a wrong conclusion survivable. Rules change;
`reconciliation-v1` is stamped on every run precisely so that changing them
later cannot silently alter the meaning of runs already recorded. If the
evidence had been rewritten to match a conclusion, there would be nothing left
to re-derive from.

### A run is a snapshot

Reconciliation describes central data at one point in time. More records sync
afterwards, and that is ordinary:

```
run 1:  feedback → without_registration     (Point A had not synced yet)
        ...Point A syncs...
run 2:  same feedback → matched
```

Both runs are correct. Run 1 is not a mistake to be fixed; it is what was true
when it ran. Runs are kept, never overwritten.

The read and the write happen inside **one `REPEATABLE READ` transaction**.
Reading registrations and feedback separately would let a sync land between them
and produce a run describing a state that never existed. A failure anywhere
rolls back the run row along with its results, so a half-written run can never
be mistaken for a finished one.

### Matching

Registration `participantId` and `publicCode` are each unique within an event,
so both resolve through a hash map. Nothing compares every feedback record
against every registration.

**QR feedback** carries two independent identifiers that the contract says
describe one person:

| Participant resolves | Code resolves | Outcome |
| --- | --- | --- |
| Registration X | Registration X | `matched`, `qr_identity` |
| Registration X | Registration Y | `identity_conflict` |
| Registration X | nothing | `identity_conflict` |
| nothing | Registration X | `identity_conflict` |
| nothing | nothing | `without_registration` |

Neither identifier is preferred when they disagree. Silently trusting
`participantId` would bury the evidence that something upstream produced an
inconsistent sticker or an inconsistent record: the disagreement *is* the
finding.

**Manual feedback** has no participant ID by design, and none is fabricated. Its
public code either resolves (`matched`, `manual_public_code`) or it does not.
The raw feedback row is never updated to add the participant ID reconciliation
discovered; the relationship lives in the derived result.

### Registration status

Counting only *valid* links, identity conflicts are not links to anything:

| Valid feedback | Status |
| --- | --- |
| 0 | `without_feedback` |
| 1 | `matched` |
| 2 or more | `multiple_feedback` |

`without_feedback` is not an error. A participant may simply not have reached
Point B, or that device may not have synced.

### Multiple feedback: reported, never resolved

When two valid responses resolve to one registration, the registration and
**both** responses are flagged. Nothing is deleted, nothing is overwritten, and
no winner is chosen.

There is no honest basis for choosing one. Device clocks are never corrected
while offline, so `createdAt` orders records within a device and only
approximately across devices. `first_received_at` records when a device found a
connection, not when a participant answered. Neither is authority, so the engine
reports the ambiguity and stops.

### Duplicate registration candidates

The same human may register twice, producing two records with entirely distinct
`recordId`, `participantId` and `publicCode`: all correct, all real captures.

Candidates come from exactly equal normalised contact values, grouped rather
than compared pairwise:

| Match | Basis |
| --- | --- |
| Same normalised phone **and** email | `phone_and_email` |
| Same normalised phone only | `phone_only` |
| Same normalised email only | `email_only` |

A pair matching on both emits **only** the stronger basis, a reviewer should
see one candidate, not three, and is stored once in canonical order, so A/B and
B/A cannot both appear.

**Normalisation is deliberately minimal:**

- **Phone:** digits only. A missing country code is *not* inferred, so
  `+91 98765 43210` and `9876543210` do not match. They may belong to different
  countries entirely, and this engine cannot know which.
- **Email:** trimmed and lower-cased. No Gmail dot-stripping, no `+tag`
  removal. Those rules hold at some providers and not others; applying them
  universally would merge people who merely look similar.
- **Names are not a matching key at all.** Too many people share one.

Every "clever" rule here is a guess about a person, and a wrong guess proposes
that two humans are one. Names may appear in a protected review UI later; they
are not evidence for a match.

**Nothing is ever merged automatically.** Families share phone numbers and
couples share email accounts. A candidate means *may be the same person*, and
Phase 7 provides no mechanism to act on it.

### Privacy

Reconciliation reads phone numbers and email addresses in order to group
duplicate candidates, which makes it the component most able to leak them. It
does not: the values exist only in memory during a run, and the derived tables
hold record IDs, statuses, counts and match bases. A schema test asserts no
`name`, `phone`, `email`, `answers` or `comments` column exists anywhere under
`reconciliation_*`. The CLI prints counts and identifiers only.

### Invoked deliberately

```bash
pnpm server:reconcile -- --event ff-rc-2026-08-23
```

Never run after a sync batch. Ingest is a hot path a device is waiting on;
reconciliation is a whole-event analysis that grows with the event, and coupling
them would make every upload pay for it. It requires an explicit event,
reconciling the wrong one silently would be worse than not reconciling at all,
and is safe to re-run at any time.

`reconciliation_latest_runs` exposes the most recent **completed** run per
event, which is the data source reporting reads. Incomplete runs are excluded by
construction.

## Central reporting, review and export

Phase 7 concluded what the records mean. Phase 8 is the first place a human sees
those conclusions, and the first API in the system that returns a participant's
name, phone number or email address. That single fact shapes every decision
below.

### A separate credential, and failing closed

Reporting requires `REPORTING_ADMIN_SECRET`. It is deliberately **not** the
enrolment secret and **not** a device token.

The threat model differs completely. A device token authorises one enrolled
tablet to upload what it captured; the enrolment code lets a device obtain such a
token. Both live on hardware sitting on a desk in a public venue all day. The
reporting credential reads the contact details of everyone at the event. Sharing
an identity between those two would mean a tablet left unattended is equivalent
to the organiser's admin session.

The secret is compared in constant time, after hashing both sides so the
comparison runs over fixed-length buffers whatever was submitted, otherwise the
length of a guess leaks through timing. Because both sides are hashed first, the
comparison is length-agnostic: a short memorable password is checked exactly as
safely as a generated one.

There is no minimum length. There used to be, and it was removed: these values
are set by hand by the people running the event, and a 64-character hex string
they cannot type gets written down somewhere worse than a chosen password would
be. The one configuration rule that remains is separation, because that is the
mistake a strong secret would not have prevented: the server refuses to start if
the reporting secret equals the enrolment code.

When it is not configured at all, reporting **fails closed**: every
`/v1/reporting/*` request answers `503 reporting_not_configured`. Ingest is
untouched: a deployment that only needs uploads never has to configure
privileged access to PII. The reverse dependency does not exist either: reporting
being switched off cannot break a device's ability to sync.

### Read-only about the event

Reporting may read registrations, feedback and reconciliation results; it may
calculate; it may generate files; and it may ask for a new reconciliation run.
That is the whole list.

It cannot update, delete or merge a record, choose a winner between two
responses, mark an anomaly resolved, or alter a device's sync state. There is no
endpoint for any of it. This is not a permissions question that a later phase
might relax: the event's records are the account of what happened at the desks,
and a reporting screen that could rewrite them would destroy the only evidence
there is.

The one write is an explicit "Run reconciliation" button, which calls the Phase 7
implementation unchanged. It is never automatic and never triggered by opening a
screen: reconciliation is a whole-event analysis, and an operator asks for it
having seen that the data has moved.

### A run contains exactly what it classified

Every browse, detail and export query is driven **from** the reconciliation
result tables and joins the raw record, never the other way around.

Starting from `registrations` and left-joining the run reads almost the same and
is wrong in a way that matters. Sync keeps running after a run completes, so a
record that arrived afterwards would show up in a historical view with no status,
and in a historical export, which is then a file describing a state of the
event that never existed. Row counts would silently stop matching the run's own
counts, which is the arithmetic an operator uses to check a report.

So a record the run never classified is absent from that run's views, and its
detail endpoint answers 404 under that run and 200 under the run that did see it.
The registrations export has exactly `registrationCount` rows and the feedback
export exactly `feedbackCount` rows, by construction.

The current canonical PII of those records is still read live, and the reports
say so: a name corrected after the run shows corrected. Freezing a copy into the
reconciliation tables would make reporting a writer of PII and give the event two
disagreeing copies of every participant.

### It consumes reconciliation; it never repeats it

Every status, count, anomaly and duplicate pair on screen comes from a run.
Nothing is reclassified in the browser and nothing is recomputed differently on
the way to a CSV. If a figure looks wrong, the answer is to reconcile again, not
to fix it in the UI: a second implementation of the matching rules would be a
second source of truth, disagreeing with the first at exactly the moments that
matter.

### Coverage and analytics are different questions

The two are reported separately and never merged into one "response rate":

- **Coverage**: how many participants gave us anything at all. Includes a
  participant with several conflicting responses: they did respond.
- **Analytics**: what the unambiguous responses said. Averages only responses a
  run classified `matched`, which is exactly one response for one participant.

A participant with two conflicting responses therefore raises coverage and
contributes to no average. Presenting a single number would hide precisely the
case a reviewer needs to see, and would let an ambiguity quietly move a mean.

A response whose `form_version` this build cannot read is counted and skipped
rather than guessed at, and the count is published: a future questionnaire might
reuse field names for a different scale, and averaging across them silently
produces a number that looks fine and means nothing.

### Where a `multiple_feedback` participant's answers are not

For a participant with several valid responses, the answer columns are blank,
on screen, in the registrations CSV, and in the workbook's Registrations sheet.
Every individual response appears in full in the feedback export and on the
participant's detail view.

Filling those columns would require picking one, and picking one would present a
guess as the participant's answer. The run refused to choose; so does the report.

### Nothing central is stored on the device

Report data exists in React state and nowhere else, never IndexedDB, never
localStorage, never sessionStorage, never CacheStorage. Every reporting response
carries `Cache-Control: no-store, private`, requests are made with
`cache: 'no-store'` and `credentials: 'omit'`, and the service worker registers
no runtime cache at all, so there is no rule that could store one. The build
verifier fails if `sw.js` so much as mentions the reporting path.

The secret is held in a React state variable, passed as a function argument, and
never written anywhere. There is no "remember me": closing the tab ends the
session, and Sign out clears it immediately for a machine about to be left
unattended.

`#/reporting` is not in the shell navigation. A device on a desk should not have
a route to every participant's phone number one mis-tap away.

### Search terms travel in request bodies

A reviewer searching for a participant frequently types a phone number. Query
strings end up in server access logs, browser history and `Referer` headers, so
the browse endpoints are `POST /registrations/query` and `POST /feedback/query`
with JSON bodies. Logs record counts, identifiers and timings; never a body,
never a search term, never a name, and never the Authorization header.

### Pagination is keyset, not offset

Pages are cursors over `(created_at, record_id)`, base64url-encoded so the client
treats them as opaque. `record_id` is the tiebreaker because two records captured
in the same millisecond on two devices are ordinary, and without a total order a
cursor can skip or repeat a row.

`OFFSET` would re-scan everything before the page on every request, and would
also shift under a concurrent insert, which, with sync still running, is not
hypothetical.

Migration 003 adds one index per table for exactly this shape. Measured at 10,000
registrations, a page taken from the middle of the list costs 0.10 ms as an index
only scan against 1.81 ms as a sequential scan plus a sort; the reason to have it
is not the millisecond but the shape, since without it the cost of every page is
proportional to the size of the whole event.

Nothing is indexed for search: `ILIKE '%term%'` cannot use a B-tree, and the
alternative is an extension plus ingest-time cost plus fuzzy behaviour this phase
deliberately does not have.

### Exports are hostile-input territory

Participant text is untrusted spreadsheet input. A comment beginning `=` or a
phone number beginning `+` is interpreted by Excel, Numbers and Google Sheets as
a **formula**, which at worst can invoke external calls when the recipient opens
the file, and at best mangles the value into `#NAME?`. Phone numbers make this
unavoidable rather than theoretical: every international number starts with `+`.

CSV values leading with `=`, `+`, `-`, `@`, tab, CR or LF are prefixed with an
apostrophe, the standard "treat as text" marker, and quoted per RFC 4180. Every
XLSX cell is written as an explicit string with a text number format; no cell is
ever a formula.

Filenames are `{event}-{kind}-{date}.{ext}` and never contain a participant: a
filename is visible in a downloads folder, a mail client and a backup log long
before anyone opens the file. The event id is sanitised so it cannot escape the
filename.

Downloads are fetched with the credential in an `Authorization` header and handed
to the browser as a blob, whose object URL is revoked immediately. A plain link
cannot carry a header, and the usual workaround, a token in the URL, would
write the credential into history and every access log on the path.

### Staleness has two halves, and neither is `last_received_at`

A run stops describing the event in exactly two ways, and they are detected
differently:

- **Something arrived that the run never saw.** Membership answers this with no
  timestamp at all: a record present now and absent from the run's results
  arrived afterwards. Immune to every clock in the system.
- **Something the run did classify was revised.** This needs a server-side
  signal, and `content_changed_at` (migration 004) is it, written on an insert
  and on an accepted revision, and deliberately *not* on the idempotent touch
  that Phase 6 performs for an `already_current` result.

The obvious signal was `last_received_at`, and it was the wrong one. Phase 6
touches it on a re-delivery because knowing when a device last spoke is genuinely
useful for diagnosing sync. The consequence was that an offline tablet
reconnecting and re-uploading a batch it had already delivered, the most ordinary
event in this system, made a perfectly current run report as stale. An operator
told the data has changed when it has not either reconciles pointlessly or stops
believing the warning by the time it is true.

`last_received_at` keeps its meaning exactly; the new column answers the other
question. Device `created_at` is used for neither: offline device clocks are never
corrected, so a tablet running slow could make a genuinely newer record look older
than the run and hide staleness completely.

### Questionnaire fields belong to their version

`overall_rating`, `experience`, `recommend` and `comments` are `feedback-v1`
fields. Every query that extracts them guards on `form_version`, so a response
captured under a later questionnaire contributes no rating to an average, no
summary to a participant row, and no answer columns to an export, even if it
happens to use identical key names for a ten-point scale.

The response is never hidden. It is listed, exported with its version, and its
detail view renders the stored answers exactly as recorded. What the system
refuses to do is assert that a v2 `overall_rating` of 9 means the same thing as a
v1 one, which is the failure that produces a number that looks right and means
nothing.

### 401 ends the session, it does not decorate a panel

A rejected credential is not a per-panel error message. Once the server has
refused it, every panel's data is unauthorised, so the client clears the secret
from memory and unmounts the whole workspace, returning to the sign-in form.
Leaving names and phone numbers on screen behind a "secret rejected" notice would
be a privileged view of an event with nothing authorising it.

This is a session-level concern by construction: every reporting request in the
app goes through one `session.call`, so there is one place that recognises a 401
rather than eight that could each forget.

### Where reporting runs

`exceljs` is a server dependency and is never imported from `src/`: it would add
megabytes to a bundle that has to be precached onto a tablet for offline use.
The workbook is built on the server and streamed.

The reporting screen is the one part of the client loaded on demand. Every other
surface must survive the network vanishing mid-shift and is therefore in the
eager bundle; reporting cannot function without the network by definition and
never runs on a station device. Its chunk is still precached like every other
emitted asset, so this is a startup-cost decision, not an availability one.

## Campaign adaptation

Phase 9 dressed the system for one campaign, Flying Flea test rides, without
changing what it is. The full account is in
[flying-flea-campaign.md](flying-flea-campaign.md); what belongs here is the
shape of the seam, because the next campaign will use it.

### Three layers, deliberately separated

    campaign presentation   src/features/campaign/flying-flea/components/
    campaign data model     src/types/campaign.ts
    campaign wording/config src/features/campaign/flying-flea/config.ts

The persisted model lives with the rest of the domain types, not in the feature
folder. A stored answer outlives the screen that captured it: the central server,
an export and a restore all read these shapes without importing a component, and
a domain layer that depended on a feature folder would have that backwards.

Presentation reads config; config holds no logic; persistence knows neither.

### A questionnaire is added, never edited

`flying-flea-feedback-v1` is a second member of the form-version union, not a
replacement for `feedback-v1`. The two answer shapes share no field name, so a
reader that forgets to branch fails to compile rather than quietly reading a 1-7
rating as if it were the old 1-5 one.

Every reader branches: the wire schema validates the pair together (a record may
not declare one questionnaire and carry another's answers), the backup validator
picks its rules by version, reporting computes two separate sets of figures, and
the exports give each questionnaire its own columns.

Reconciliation is the exception that proves the rule: it matches on identity and
has no idea what was asked, so Phase 9 changed nothing in it. A campaign response
is classified exactly as any other response is.

### Registration fields are additive, and that is what makes them safe

Every campaign field is optional in IndexedDB, on the wire and in Postgres, and
null means "not captured" rather than a default. That is what lets a device
holding records since Phase 1 keep reading its own history, lets a device on an
older build keep uploading, and lets one deployment serve an event that ran the
generic form in the morning and the campaign form in the afternoon.

The IndexedDB schema is deliberately **not** versioned up for them: adding
optional fields needs no new `version()` block and no index change, and a bump
would carry upgrade risk for installed devices in exchange for nothing.

Identity stays immutable and campaign answers are mutable, on both sides of the
network. The printed sticker refers to identity; everything a human typed at a
desk has to be correctable, or staff fix a mistyped digit by registering the same
rider twice.

### Brand assets are inlined, not fetched

The marks are React components carrying the supplied path data. The campaign's
own page inlines them for the same reason this does: a field application starts
with no network, and an asset that can fail to load will.

The campaign's bike photographs are hot-linked from a CDN in the supplied source
and were not carried over. A control whose meaning depends on which photograph is
showing would be a control with no visible options at a venue with no Wi-Fi, so
the colour selector uses labelled swatches.

### Design fidelity has a limit, and it is throughput

The supplied design renders phone and pincode as circular dial keypads. They were
not carried over: Point A is staff-operated several hundred times a day, and a
rendered keypad is ten taps where the tablet's own keyboard is one paste. The
plate and swatch motifs were kept, because those are faster than the alternative
rather than slower.

## Deployment: two runtimes, one API

The application is deployed as a single Vercel project, the PWA served
statically from `/`, and the same Hono API answering at `/api/*`, against a
Neon Postgres. Nothing about the API changed to make that work.

### The prefix belongs to the deployment

`server/app.ts` defines `/health` and `/v1/...` and knows nothing about how it is
served. The Vercel function strips `/api`, which is where Vercel routes a
function; the local Node server binds it to a port unprefixed. Rewriting every
route to `/api/v1/...` inside the app would have baked one deployment's routing
into the API, and would have meant the local server and the deployed one no
longer served the same paths.

### Routing is written down, not inferred

`vercel.json` carries one rewrite:

```json
"rewrites": [{ "source": "/api/:path*", "destination": "/api/index" }]
```

That is the only thing routing the API, and it exists because the alternative
failed in production. The function used to be `api/[...path].ts`, on the
assumption that Vercel reads that filename as a multi-segment splat. It does
not. The generated route table read:

```json
{ "src": "^/api/([^/]+)$", "dest": "/api/[...path]?...path=$1", "check": true },
{ "src": "^/api(/.*)?$",   "status": 404 }
```

`[^/]+` is one segment. `/api/health` reached the function; `/api/v1/sync/enroll`
matched the next rule and got the platform's own 404, before any application code
ran. Nothing local could see it, because every test called Hono directly.

A plain filename produces no dynamic-segment inference at all, so the rewrite is
the whole mechanism, and `pnpm verify:vercel` reads the generated table back and
asserts every public path still reaches the function.

### Node ESM does not guess file extensions

`server/`, `shared/` and `api/` are compiled by Vercel and executed by Node's ESM
loader, and the package is `"type": "module"`. TypeScript emits import specifiers
verbatim, so an extensionless `import { createCentralApp } from '../server/centralApp'`
becomes exactly that in the artifact, and Node refuses it:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/server/centralApp'
```

The file was packaged. Node will not look for it under another name. Every
relative specifier in those three directories therefore ends in `.js`, pointing
at the emitted file rather than at the TypeScript source. `tsx`, Vitest and
TypeScript's `bundler` resolution all map it back to the `.ts`, so local
development is unchanged; `src/` is untouched, because Vite bundles it and it
never runs under Node ESM.

This is checked against the built artifact, not the source. See
`scripts/verify-vercel-build.mjs`:

```bash
pnpm dlx vercel build
pnpm verify:vercel
```

It resolves every relative import in the function the way Node does, then imports
the built function and calls the public contract through it.

### One configuration, two entry points

`server/config.ts` validates the environment and `server/centralApp.ts` turns the
result into a running app. `server/index.ts` and `api/index.ts` each add only
what is genuinely theirs: binding a port and closing connections on a signal, or
exporting a request handler.

Two hand-written `createApp({...})` call sites is how a deployment ends up with
reporting enabled in one runtime and not the other, or a health check that
answers differently depending on where it runs, and the one that is wrong is
always the one nobody tests locally.

### Same origin removes a whole class of configuration

In production the app and the API share an origin, so `VITE_SYNC_API_BASE_URL` is
the path `/api`. It resolves against the page, which means it inherits the page's
HTTPS and cannot be downgraded; it also means no request is cross-origin, so
there is nothing to allow-list. Deployment hostnames change with every push, and a
configuration that required listing them would be wrong within a day.

The explicit origin allowlist stays for the local split-origin setup, a Vite dev
server on :5173 calling an API on :8788 is genuinely cross-origin, and there is
still no wildcard anywhere.

### Serverless connections are not a smaller pool, they are a different shape

A long-lived server holds one pool for the whole event. A function is many
short-lived instances, so concurrency multiplies instances rather than
connections within one: `max: 1` per instance is what scales predictably, and
`sql.end()` between invocations would discard the connection a warm instance
exists to reuse.

`prepare: false` is not tuning. The pooled endpoint is PgBouncer in transaction
mode, where named prepared statements do not survive being handed between
sessions, and the resulting error appears only under the load that makes it
hardest to reproduce.

### Migrations never ride along

Not on build, not on cold start, not on first request. A schema holding an
event's records changes because an operator ran `pnpm server:migrate` and watched
it, using the **direct** connection: a transaction-mode pooler cannot hold the
session state DDL relies on. That is why the migration URL resolves separately
from the application's, and why the application's may be pooled while the
migration's must not be.

## Why Point B works without Point A

Point B needs three things to record attributable feedback, and has all three
without a lookup:

1. **An identity**, from whatever the rider brought. A QR scan yields
   `participantId` and `publicCode`; a typed fallback yields `publicCode` alone;
   a rider with neither gives their own name, phone number and email, and those
   become the identity of the response.
2. **Validation**: for a code, the check character is deterministic arithmetic
   over the code itself, so a typo is caught locally with no participant list to
   consult. For contact details, the same rules Point A applies to the same
   three fields, so a number typed at either desk normalises identically.
3. **Somewhere to put it**. Point B's own IndexedDB, which never contains a
   copy of Point A's data.

Point B therefore needs no connectivity and cannot be blocked by Point A being
restarted, replaced or absent. The contact path in particular makes **zero**
network reads: it does not ask whether the rider registered, because that
question has no answer at a desk with the wifi off, and asking it would make the
one path designed for the rider who has nothing depend on the one thing the
venue cannot guarantee.

Attributing a response to a participant is the central server's job after
synchronisation, whether the response carries a typed code or a phone number
and an email address.

## What exists after Phase 10

- Vite + React + TypeScript project with strict compiler settings
- hash-based client-only routing (`#/a`, `#/b`, `#/admin`, `#/reporting`)
- typed V1 event/station configuration, with device identity resolved at runtime
- IndexedDB persistence for registrations, feedback and device configuration
- participant ID generation, per-device issuer codes, public code issuing and
  validation
- the QR payload contract: serialiser, parser and validation
- **Point A**: the working registration terminal, validation, durable save, QR
  sticker rendering, printing, reprint, refresh recovery and PII correction
- **Point B**: the working feedback terminal, QR scanning, manual fallback,
  the `feedback-v1` questionnaire, durable save, same-device duplicate refusal
- **Offline application shell**: the whole app precached, cold-starting with no
  server reachable; operator-gated updates; readiness and version on Admin
- **Encrypted backup and restore**: an operator-initiated `.oefbackup` file,
  verify-before-trust, and a non-destructive merge onto a replacement device
- **Central synchronisation**: device enrolment, an idempotent batched ingest
  API over Postgres, and a client outbox that survives lost responses
- **Central reconciliation**: a deterministic, versioned engine that classifies
  registration/feedback relationships and proposes duplicate candidates without
  ever altering the raw records
- **Central reporting**: a separately-credentialled, read-only API and screen
  over reconciled data, overview, participant and response browsers, anomaly
  and duplicate review, an explicit reconciliation trigger, and CSV/XLSX exports
  that never reach the device's storage
- **Campaign adaptation**: the Flying Flea design applied across the application,
  campaign registration fields captured end to end, a second versioned
  questionnaire alongside the original, and reporting that keeps the two apart
- **Deployment compatibility**: one Vercel project serving the PWA and the same
  Hono API from one origin, a shared server bootstrap behind both runtimes,
  serverless-appropriate database settings, and migrations that stay manual
- local record counts, sync status and device diagnostics on Admin
- unit and integration tests for all of the above, against a real IndexedDB
  implementation

## Explicitly deferred

None of the following exists yet:

- cross-device duplicate detection and reconciliation
- background sync, push notifications and runtime API caching
- printer-vendor SDKs and any automatic paper-out/jam detection
- automatic merging of duplicates or selection of a winning feedback record,
  reporting surfaces both sides and leaves the decision to a human
- user accounts, roles and permissions: reporting has one shared secret, and
  there is no way to tell two reviewers apart
- charting libraries, fuzzy search, background reconciliation, emailed reports
  and any publicly reachable reporting URL

The offline application shell, previously listed here as unscheduled, landed in
Phase 4.

## Known concerns carried into later phases

- **Restore once compared transport state.** Until Phase 6, the backup merge
  compared whole records, including `syncStatus`. Once synchronisation began
  changing that field, two copies of one record, synced on the source device,
  pending on the replacement, compared as different contents at the same
  revision and aborted the restore as a conflict. The merge now compares domain
  contents only. Latent since Phase 5; only reachable once records could be
  marked synced.

- **Ambiguous glyphs in printed codes.** The check character is drawn from the
  full `0-9A-Z` alphabet, so a code can still end in `O` or `I`. Normalisation
  deliberately does not fold `O`/`0` or `I`/`1`, because folding would corrupt
  legitimate codes. The issuer segment is hexadecimal specifically so that it
  cannot add to this problem, which leaves exactly one exposed character per
  code. The failure mode is benign (a misread character fails its checksum and
  staff retries, rather than attributing feedback to the wrong participant), but
  sticker typography should use a font that disambiguates. This is a Phase 2
  concern.
- **Device clock drift.** `createdAt` comes from the device clock, and offline
  devices are never corrected. Timestamps order events within one device
  reliably and across devices only approximately. Sync and reconciliation must
  not assume a global ordering.
- **Storage eviction.** A browser that evicts the database takes the device
  identity with it, which is the intended behaviour, but it also takes
  unsynchronised records. Backup/export exists partly to bound that risk.
