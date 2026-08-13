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

**Phase 2 — Point A registration and QR sticker printing.**

Point A is a working registration terminal and can be physically tested end to
end. Staff enters a participant's details, the registration is durably saved to
this device, and only then is a QR sticker produced for printing.

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
manual print/scan QA pass.

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

Point B is still a placeholder screen. QR scanning, manual code entry, the
feedback questionnaire, the offline app shell and synchronisation are **not
implemented yet** — see the deferred list in
[docs/architecture.md](docs/architecture.md).

> Offline **data** operations work today. Offline **app startup** does not: there
> is no service worker yet, so the page must be loaded while the host is
> reachable.

### Participant identity at a glance

| Concept | Value | Purpose |
| --- | --- | --- |
| `participantId` | UUIDv7 | canonical machine identity, encoded in the QR |
| `publicCode` | `A1-B8EFD9-00001-X` | human fallback, typed when a scan fails |
| `issuerCode` | `B8EFD9` | which device issued a code, derived from its `deviceId` |
| `deviceId` | UUIDv4 | which browser installation wrote a record |
| `stationId` | `A1` / `B1` | which operational post it was written at |

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
pnpm build       # type-check and produce a production build in dist/
pnpm preview     # serve the production build locally
```

## Project structure

```text
src/
  app/          App shell wiring and the route table
  components/   Shared presentational components
  config/       Typed V1 event / station / device configuration
  features/
    registration/  Point A — form, sticker, print/reprint, recovery
    feedback/      Point B
    admin/         Device admin
    home/          Development navigation screen
  lib/
    print/      The browser print boundary
    qr/         QR rendering (SVG, bundled locally)
    routing/    Hash router
    identity/   Participant/record/device IDs, public codes, QR payload
    storage/    IndexedDB schema, repositories, device identity, sequences
    sync/       (seam) upload to the central server — not implemented
  test/         Test database helpers and the fake-indexeddb setup
  types/        Domain types: IDs, records, sync status
docs/
  architecture.md
  point-a-physical-test.md
```

## Roadmap

| Phase | Content |
| --- | --- |
| 0 | Foundation, architecture, routing, types, config — done |
| 1 | Local persistence, participant identity, public codes, QR contract — done |
| 2 | Point A registration, QR generation, sticker printing *(current)* |
| 3 | QR scanning, manual fallback entry, feedback questionnaire |
| 4 | Admin: record counts, backup/export, diagnostics |
| 5 | Synchronisation API, central database, reconciliation |

Phase boundaries are indicative; the ordering constraint that matters is that
nothing prints a sticker before persistence exists, and nothing depends on
synchronisation to operate.
