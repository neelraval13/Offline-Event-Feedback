# Deploying to Vercel: operator guide

Everything here is done by a person, in a browser and a terminal. Nothing in the
repository deploys itself, creates a Vercel project, or touches the production
database.

Read section A before starting. The ordering in it is the part that matters.

---

## A. Before you begin

You need three things ready.

**1. A clean `main`.** The deployment builds whatever is on the branch Vercel
imports. Check `git status` is clean and the branch is pushed.

**2. A Neon database with the schema applied and nothing else.** Production
receives **schema only**. There is no data import, no QA copy, no seed,
registrations, feedback, device enrolments and reconciliation runs all begin at
zero and are created by the event itself.

Apply migrations from your own machine, using the **direct** (unpooled) Neon
connection string:

```bash
MIGRATION_DATABASE_URL='postgres://…neon.tech/…?sslmode=require' pnpm server:migrate
```

Expect seven migrations, `001` through `007`. Running it again reports them all
as already applied; it is safe to repeat and it never drops anything.

Then confirm the database is empty:

```sql
SELECT count(*) FROM registrations;          -- 0
SELECT count(*) FROM feedback;               -- 0
SELECT count(*) FROM sync_devices;           -- 0
SELECT count(*) FROM sync_batches;           -- 0
SELECT count(*) FROM reconciliation_runs;    -- 0
SELECT name FROM schema_migrations ORDER BY name;  -- 001 … 007
```

**3. Two secrets, generated fresh.** Do not reuse a development value.

```bash
# The code typed into each tablet once, to enrol it
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"

# The reporting login. Any non-empty value, including a memorable password.
# It must NOT equal the enrolment code: the server refuses to start if it does.
# Avoid spaces: it is sent as an HTTP Bearer credential.
```

Keep both out of chat, tickets and screenshots.

---

## B. Create the Vercel project

1. Vercel dashboard → **Add New… → Project**.
2. **Import** the GitHub repository.
3. Framework preset: **Vite**. If it is not detected, set it manually.
4. Build command: `pnpm build`
5. Output directory: `dist`
6. Install command: leave as detected (`pnpm install`).

Do **not** add `pnpm server:migrate` to the build command, or to any hook.
Migrations are yours to run, deliberately, from your own machine.

`vercel.json` in the repository already sets the function region to `sin1`
(Singapore, matching the database) and the caching headers described in section
H. You do not need to configure either in the dashboard.

---

## C. Environment variables

Project → **Settings → Environment Variables**. Add these to **Production** (and
to Preview if you are using a separate preview database; see section I).

| Name | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string | The one with `-pooler` in the host. The functions use this. |
| `SYNC_ENROLLMENT_SECRET` | the enrolment code you generated | Typed into each device once. |
| `REPORTING_ADMIN_SECRET` | the reporting password you chose | Any non-empty value, no spaces, different from the enrolment code. |
| `VITE_SYNC_API_BASE_URL` | `/api` | Build-time and public. It is a location, not a credential. |

Leave these **unset** in Vercel:

- `MIGRATION_DATABASE_URL`: the direct connection, needed only on your machine.
  The application never reads it, and it should not be in a deployment.
- `SYNC_ALLOWED_ORIGINS`: the app and the API share one origin in production, so
  there is nothing cross-origin to allow. Do not paste deployment hostnames here;
  they change with every deployment and would not help.

`VITE_SYNC_API_BASE_URL` is compiled into the browser bundle. The other three are
server-side only and never reach it: a build test asserts their names do not
appear in the output.

---

## D. Deploy

Trigger the first deployment (importing the project does this automatically).

Watch the build log for the line from the build verifier:

```
✓ PWA build verified: … navigation fallback present, updates gated on an operator.
  note: sync API configured same-origin: /api, which resolves against the page's own origin
```

If it instead says the sync API is configured over plain HTTP, the build fails on
purpose: `VITE_SYNC_API_BASE_URL` is wrong.

---

## E. Verify the deployment

Open the deployment URL and check each of these.

| Check | Expect |
| --- | --- |
| `/` | The Flying Flea home screen, both brand marks visible |
| `/#/a` | Point A registration form |
| `/#/b` | Point B, with a **Start scanner** button |
| `/#/admin` | Device Admin, with sync status |
| `/#/reporting` | The reporting sign-in prompt |
| `/api/health` | `{"status":"ok","protocolVersion":1,"database":true}` |

`"database": true` is the one that proves the function reached Neon. If it is
`false` or the request fails, the pooled `DATABASE_URL` is wrong or the database
is unreachable from the function region.

The health response deliberately says nothing else: no host, no database name,
no connection count.

---

## F. Enrol a device

On the tablet, open `/#/admin` → the sync panel → enter the enrolment code.

Expect the device to report itself enrolled. Behind that, the device now holds
its own token; the enrolment code is not stored on either side.

Then confirm centrally:

```sql
SELECT event_id, uploader_device_id, created_at FROM sync_devices;
```

One row per enrolled device.

---

## G. Sync and reporting

1. On the tablet, register one test rider at Point A and print or preview the
   sticker.
2. Capture feedback for that rider at Point B.
3. From Admin, sync. Both records should report as accepted.
4. Confirm centrally: `SELECT count(*) FROM registrations;` → 1.
5. Sync again. The same records must come back **already current**, not
   conflicts; that is the idempotency the whole outbox depends on.
6. Open `/#/reporting`, sign in with the reporting secret, run reconciliation,
   and check the participant and response appear.
7. Download the registrations CSV and confirm it opens cleanly.

Delete these test records before the event if you want a clean production
dataset, or run the event knowing they are there. Do not leave a half-finished
test rider in the participant list without knowing which one it is.

---

## H. Caching and offline behaviour

Already configured by `vercel.json`; verify rather than change.

- `/sw.js` is served `Cache-Control: public, max-age=0, must-revalidate`, so a
  new deployment's service worker is noticed on the next load rather than hours
  later.
- `/api/*` is served `Cache-Control: no-store`, and reporting responses
  additionally carry `no-store, private`. Nothing central is ever cached by a
  CDN, a proxy or the browser.
- The service worker precaches the application shell only. It contains no rule
  that could cache an API response: a build test fails if one appears.

To verify offline readiness on a device:

1. Load the deployment while online and let it finish.
2. Open Admin and confirm it reports the app as ready for offline use.
3. Put the tablet in aeroplane mode and cold-start the app.
4. `/#/a` and `/#/b` must open, generate QR codes and save records.

---

## I. Preview deployments

Preview builds are useful; pointing them at the production database is not.

Prefer a **Neon branch** or a separate disposable database, and set
`DATABASE_URL` for the Preview environment to that. If only the production
database exists, treat Preview as read-only: do not enrol devices or sync from
it, because those writes land in production data.

Automatic branch-per-preview is deliberately not built into this repository.

---

## J. Rolling out to field devices

The Phase 9 rollout contract applies, and the order is not optional:

1. Deploy the new server and frontend (they are one deployment).
2. On **each** field device, open the app **while online** and let the new
   version install.
3. Confirm in Admin that the update has been applied: the app prompts rather
   than reloading itself mid-registration.
4. Confirm offline readiness on that device.
5. Only then begin capturing campaign records on it.

A pre-Phase-9 build cannot represent the Flying Flea questionnaire. Do not
capture or restore campaign records on a device that has not been updated: the
responses will be refused by the server and will sit on the tablet.

---

## K. Rolling back

**Frontend and API** roll back together, because they are one deployment:
Vercel → Deployments → the previous good deployment → **Promote to Production**.

**The database does not roll back.** Migrations only ever create; there are no
automatic down migrations, and there deliberately never will be: an automatic
reversal of a schema change is a script that can delete an event's records
because someone clicked the wrong button.

If a schema change has to be undone, it is a deliberate recovery decision: take a
Neon backup or branch first, write the corrective migration, review it, and apply
it with `pnpm server:migrate` like any other.

Rolling the code back to a deployment older than a migration is usually safe,
the migrations so far are additive, and older code ignores columns it does not
know about, but confirm that for the specific migration before relying on it.

---

## What must be true before the event

- `/api/health` reports `database: true`.
- Every field device is on the new build and has been confirmed offline-ready.
- Each device is enrolled, and `sync_devices` has exactly the expected rows.
- One end-to-end rider has been registered, synced, reconciled and exported.
- No secret has been pasted into a ticket, a screenshot, or `vercel.json`.
