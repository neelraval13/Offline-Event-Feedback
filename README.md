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

**Phase 0 — project foundation and architecture scaffolding.**

The three surfaces exist as minimal placeholder screens. Registration,
persistence, QR generation, scanning, feedback capture and synchronisation are
**not implemented yet** — see the deferred list in the architecture document.

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
    identity/   (seam) participant ID, public code, QR payload
    storage/    (seam) IndexedDB persistence
    sync/       (seam) upload to the central server
  types/        Domain types: IDs, records, sync status
docs/
  architecture.md
```

## Roadmap

| Phase | Content |
| --- | --- |
| 0 | Foundation, architecture, routing, types, config *(current)* |
| 1 | Local persistence, participant identity and public-code generation |
| 2 | Registration flow, QR generation, sticker printing |
| 3 | QR scanning, manual fallback entry, feedback questionnaire |
| 4 | Admin: record counts, backup/export, diagnostics |
| 5 | Synchronisation API, central database, reconciliation |

Phase boundaries are indicative; the ordering constraint that matters is that
nothing prints a sticker before persistence exists, and nothing depends on
synchronisation to operate.
