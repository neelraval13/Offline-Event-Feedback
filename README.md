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

**Phase 1 — local persistence and participant identity.**

What works now, beneath the UI:

- **Local storage** — IndexedDB (Dexie) holding registrations, feedback and
  device configuration, with unique-index protection against duplicate
  identities and transactional writes.
- **Device identity** — a stable `deviceId` generated on first use and
  persisted, surviving refresh and browser restart.
- **Participant identity** — offline UUIDv7 participant IDs, and issued public
  codes of the form `A1-00001-O` with an ISO 7064 MOD 37-2 check character.
- **QR payload contract** — a versioned serialiser, parser and validator, so
  Point A and Point B agree on identity before either is built.

The three surfaces are still placeholder screens, apart from device diagnostics
on Admin. QR rendering, scanning, printing, the registration form, the feedback
questionnaire and synchronisation are **not implemented yet** — see the deferred
list in [docs/architecture.md](docs/architecture.md).

### Participant identity at a glance

| Concept | Value | Purpose |
| --- | --- | --- |
| `participantId` | UUIDv7 | canonical machine identity, encoded in the QR |
| `publicCode` | `A1-00001-O` | human fallback, typed when a scan fails |
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
    registration/  Point A
    feedback/      Point B
    admin/         Device admin
    home/          Development navigation screen
  lib/
    routing/    Hash router
    identity/   Participant/record/device IDs, public codes, QR payload
    storage/    IndexedDB schema, repositories, device identity, sequences
    sync/       (seam) upload to the central server — not implemented
  test/         Test database helpers and the fake-indexeddb setup
  types/        Domain types: IDs, records, sync status
docs/
  architecture.md
```

## Roadmap

| Phase | Content |
| --- | --- |
| 0 | Foundation, architecture, routing, types, config — done |
| 1 | Local persistence, participant identity, public codes, QR contract *(current)* |
| 2 | Registration flow, QR generation, sticker printing |
| 3 | QR scanning, manual fallback entry, feedback questionnaire |
| 4 | Admin: record counts, backup/export, diagnostics |
| 5 | Synchronisation API, central database, reconciliation |

Phase boundaries are indicative; the ordering constraint that matters is that
nothing prints a sticker before persistence exists, and nothing depends on
synchronisation to operate.
