# Offline Event Feedback

An offline-first web app for running participant registration and feedback
collection at a physical event, on devices that have **no internet connection
during operations**.

Participants register at **Point A**, where staff captures their details and
prints a QR sticker. After completing the activity they arrive at **Point B**,
where staff scans that sticker — or types the code printed under it — and
records their feedback. Both devices store everything locally and synchronise to
a central server later, whenever a connection happens to be available.

## Current V1 scope

- one event, one day
- one registration station (`A1`) and one feedback station (`B1`)
- approximately 10,000 participants
- no connectivity required at any point during the event
- no multi-event / multi-station management UI

Event, day, station and device identity are preserved internally on every record
so that multi-event and multi-station operation can be added later without
redesigning participant identity. See [docs/architecture.md](docs/architecture.md).

## Current phase

**Phase 5 — encrypted backup and restore.**

Records no longer live on exactly one machine. A device can be backed up to an
encrypted file, that file can be **verified before it is trusted**, and a
replacement device can restore it without cloning the failed machine's identity.

```
device  ->  encrypted .oefbackup  ->  verify  ->  merge onto a replacement
```

- **AES-GCM with PBKDF2-SHA-256 at 600,000 iterations.** The unopened file
  reveals only that it is a backup of this application — no event, no counts, no
  participant. The passphrase is never stored and cannot be recovered.
- **Verify without importing.** Generating a file is weak evidence; selecting it
  back off disk and decrypting it is real evidence, and Admin tracks the two
  separately.
- **Restore merges, never replaces.** The destination is never cleared, the
  whole merge is one transaction, and any conflict aborts it entirely — no
  partial import. Restoring the same file twice changes nothing.
- **Device identity is never cloned.** A replacement keeps its own `deviceId`
  and its own public-code issuer namespace, so a recovered machine can never
  collide with the original if that one returns.
- **Works entirely offline**, like everything else.

See [docs/backup-restore-test.md](docs/backup-restore-test.md) for the recovery
drill.

### Cold start

The application also **cold-starts with no server reachable**. After one online
preparation, a device runs the entire event from its own cache: no origin
server, no network, no CDN.

```
prepare device online  ->  shell precached  ->  server can disappear entirely
```

- **Installable PWA** — the whole app is precached, including the ~830 kB bundle
  carrying Dexie, the QR generator and the ZXing scanner. Nothing is lazily
  fetched, so nothing can be missing when the network is gone.
- **Updates never interrupt anyone** — a new version downloads and waits. Point A
  and Point B say nothing about it; only Admin offers **Apply update**, and only
  an operator pressing it reloads the terminal.
- **Offline readiness is verified, not assumed** — Admin reports *Ready for
  offline use* only when the shell is genuinely precached, never from
  `navigator.onLine`.
- **Updating never touches participant data** — application code lives in Cache
  Storage, records live in IndexedDB, and the two never meet.

See [docs/offline-cold-start-test.md](docs/offline-cold-start-test.md) for the
test that decides whether a device is venue-ready — it requires **stopping the
preview server**, which every earlier offline test did not.

> ⚠️ Chrome's **Clear site data** deletes IndexedDB, and IndexedDB holds the
> participant records. Never use it to reset the app cache — the safe procedure
> is in [docs/architecture.md](docs/architecture.md#resetting-the-app-cache-safely).
> Keep an encrypted backup regardless.

Both stations can be physically tested.

**Point A** — staff enters a participant's details, the registration is durably
saved to this device, and only then is a QR sticker produced for printing.

```
name / phone / email  ->  saved to IndexedDB  ->  QR sticker  ->  print / reprint
```

- **50 mm × 40 mm sticker** carrying a 26 mm QR code and the public code
  beneath it — and no participant PII of any kind.
- **Print and reprint** through the browser's own print dialog. Reprint produces
  the identical sticker: no new record, no new identity, no counter movement.
- **Survives a refresh** — recent local registrations stay reachable for
  reprint.
- **Correct name, phone or email** on a saved registration without changing its
  identity or needing a new sticker.

See [docs/point-a-physical-test.md](docs/point-a-physical-test.md) for the
manual print QA pass.

**Point B** — staff scans that sticker, or types the code printed under it, and
records the participant's feedback.

```
scan QR   -> validate against this event + the A1 desk -+
                                                        +-> feedback-v1 -> IndexedDB
type code -> validate the check character --------------+
```

- **No Point A lookup, ever.** Point B holds no registrations and needs none:
  everything it validates comes from the sticker itself.
- **Manual fallback always available**, including when the camera is denied,
  missing or broken.
- **Same-device duplicate refusal** — scanning a sticker this terminal has
  already recorded shows *Already recorded* rather than quietly taking a second
  response.
- **No participant PII at Point B** — the screen shows the public code and
  nothing else.

See [docs/point-b-physical-test.md](docs/point-b-physical-test.md) for the
manual scan/camera QA pass.

### The `feedback-v1` questionnaire

| Question | Stored as |
| --- | --- |
| Overall rating | `overall_rating`: 1–5, required |
| How was your experience? | `experience`: `very_poor` … `excellent`, required |
| Would you recommend this experience? | `recommend`: boolean, required |
| Any comments? | `comments`: optional, ≤2000 characters |

Every response carries `formVersion: 'feedback-v1'`, so changing the questions
later leaves already-collected answers interpretable.

Beneath the UI:

- **Local storage** — IndexedDB (Dexie) holding registrations, feedback and
  device configuration, with unique-index protection against duplicate
  identities and transactional writes.
- **Device identity** — a stable `deviceId` generated on first use and
  persisted, surviving refresh and browser restart.
- **Participant identity** — offline UUIDv7 participant IDs, and issued public
  codes of the form `A1-B8EFD9-00001-X` with an ISO 7064 MOD 37-2 check
  character. The `B8EFD9` segment namespaces codes per device, so two
  installations at one station can issue in parallel without ever colliding.
- **QR payload contract** — a versioned serialiser, parser and validator, so
  Point A and Point B agree on identity before either is built.

Synchronisation, the central server and cross-device duplicate reconciliation
are **not implemented yet** — see the deferred list in
[docs/architecture.md](docs/architecture.md).

> The field deployment must be served over **HTTPS**. Both the service worker
> and the Point B camera require a secure context; `localhost` works for
> development, a plain-HTTP LAN address gets neither.

### Participant identity at a glance

| Concept | Value | Purpose |
| --- | --- | --- |
| `participantId` | UUIDv7 | canonical machine identity, encoded in the QR |
| `publicCode` | `A1-B8EFD9-00001-X` | human fallback, typed when a scan fails |
| `issuerCode` | `B8EFD9` | which device issued a code, derived from its `deviceId` |
| `deviceId` | UUIDv4 | which browser installation wrote a record |
| `stationId` | `A1` / `B1` | which operational post it was written at |
| `captureMethod` | `qr` / `manual` | how Point B read the identity; `manual` has no `participantId` |

`deviceId` and `stationId` are separate concepts and are never conflated: one
browser can visit both routes during development and remains one device.

## Routes

Routing is hash-based, so the built app runs from any static host, a local
file server, or a USB stick, with no server-side rewrite rules.

| Route | Surface |
| --- | --- |
| `/#/a` | Point A — Registration |
| `/#/b` | Point B — Feedback |
| `/#/admin` | Device Admin |
| `/#/` | Development home / navigation |

## Local development

Requires Node 20+ and pnpm.

```bash
pnpm install     # install dependencies
pnpm dev         # start the dev server
pnpm typecheck   # type-check without emitting
pnpm test        # run unit tests once
pnpm test:watch  # run unit tests in watch mode
pnpm build       # type-check, build, and verify the PWA precache
pnpm preview     # serve the production build locally
pnpm verify:pwa  # re-check dist/ for offline-cold-start readiness
pnpm icons       # regenerate the temporary PWA icons
```

`pnpm dev` runs **without** a service worker, so development never fights a
stale cached shell. Test PWA behaviour against `pnpm build && pnpm preview`.

## Project structure

```text
src/
  app/          App shell wiring and the route table
  components/   Shared presentational components
  config/       Typed V1 event / station / device configuration
  features/
    registration/  Point A — form, sticker, print/reprint, recovery
    feedback/      Point B — scanner, manual entry, questionnaire
    admin/         Device admin
    home/          Development navigation screen
  lib/
    backup/     Encrypted backup, verification and non-destructive restore
    print/      The browser print boundary
    pwa/        Service-worker lifecycle, offline readiness, app version
    scanner/    QR camera boundary (ZXing, bundled locally)
    qr/         QR rendering (SVG, bundled locally)
    routing/    Hash router
    identity/   Participant/record/device IDs, public codes, QR payload
    storage/    IndexedDB schema, repositories, device identity, sequences
    sync/       (seam) upload to the central server — not implemented
  test/         Test database helpers and the fake-indexeddb setup
  types/        Domain types: IDs, records, sync status
docs/
  architecture.md
  backup-restore-test.md
  offline-cold-start-test.md
  point-a-physical-test.md
  point-b-physical-test.md
scripts/
  generate-icons.mjs      Temporary PWA icons
  verify-pwa-build.mjs    Fails the build if the shell would not cold-start
```

## Roadmap

| Phase | Content |
| --- | --- |
| 0 | Foundation, architecture, routing, types, config — done |
| 1 | Local persistence, participant identity, public codes, QR contract — done |
| 2 | Point A registration, QR generation, sticker printing — done |
| 3 | Point B scanning, manual fallback entry, feedback questionnaire — done |
| 4 | Offline application shell / installable PWA — done |
| 5 | Local counts, encrypted backup and restore *(current)* |
| 6 | Synchronisation API, central database, reconciliation |

Phase boundaries are indicative; the ordering constraint that matters is that
nothing prints a sticker before persistence exists, and nothing depends on
synchronisation to operate.
