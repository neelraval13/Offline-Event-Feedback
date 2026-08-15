# Central reporting: real Postgres QA

Reporting is the first API in this system that returns a participant's name,
phone number and email address. This pass proves it against a real database, on
the data the Phase 6 and Phase 7 QA left behind.

Two things are being checked throughout, and they matter more than any individual
figure:

1. **The credential boundary holds.** Nothing that authorises a device to upload
   may read the event's contact list.
2. **Nothing leaks or lingers.** No PII in a URL, a log line, a filename, or any
   browser store.

## What reporting is, and is not

**It is read-only about the event.** It may read registrations, feedback and
reconciliation results, calculate aggregates, generate files, and ask for a new
reconciliation run. It cannot update, delete or merge a record, choose a winner
between two responses, mark an anomaly resolved, or touch a device's sync state.

**It consumes reconciliation.** Every status, count and duplicate pair comes from
a Phase 7 run. Nothing is reclassified in the browser or on the way to a CSV.

**A run contains exactly what it classified.** Records that arrived after a run
completed belong to the next run, not that one; they are absent from its
browsers, its detail views and its exports.

**It shows ambiguity rather than resolving it.** A participant with two valid
responses has no answer attached, anywhere. Both responses are listed in full.

## Setup

```bash
export DATABASE_URL=postgres://localhost:5432/offline_event_feedback_test
pnpm server:migrate
```

Expect `001` and `002` to report as already applied, then
`✓ 003_reporting_browse.sql` and `✓ 004_content_changed_at.sql`. Run it again and
expect all four to report as already applied.

Both are safe against a database with data in it: 003 only creates indexes, and
004 adds a nullable column to `registrations` and `feedback` and backfills it from
`last_received_at`. Neither drops or rewrites a record.

Generate a reporting secret. Never commit it, never put it in a URL, never paste
it into a ticket:

```bash
export REPORTING_ADMIN_SECRET=$(openssl rand -hex 32)
export SYNC_ENROLLMENT_SECRET=<the Phase 6 enrolment code>
export SYNC_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173
pnpm server:start
```

The startup line must end with `reporting: enabled`.

## 1. The credential boundary

Every request below must be refused. Run each one and read the status code.

```bash
# No credential at all
curl -s -o /dev/null -w '%{http_code}\n' \
  "http://localhost:8788/v1/reporting/overview?eventId=ff-rc-2026-08-23"

# A wrong secret
curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer wrong' \
  "http://localhost:8788/v1/reporting/overview?eventId=ff-rc-2026-08-23"

# The ENROLMENT secret: valid for enrolling a device, useless here
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $SYNC_ENROLLMENT_SECRET" \
  "http://localhost:8788/v1/reporting/overview?eventId=ff-rc-2026-08-23"

# A device token issued by /v1/sync/enroll: valid for uploading, useless here
curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer <device token>' \
  "http://localhost:8788/v1/reporting/overview?eventId=ff-rc-2026-08-23"
```

**Expect `401` for all four.** A device token that can upload this event's
records and still cannot read them is the entire point of the separate secret.

Then confirm the correct secret works:

```bash
curl -s -i -H "Authorization: Bearer $REPORTING_ADMIN_SECRET" \
  "http://localhost:8788/v1/reporting/overview?eventId=ff-rc-2026-08-23" | head -8
```

**Expect `200`, and in the headers:**

```
cache-control: no-store, private
pragma: no-cache
x-content-type-options: nosniff
referrer-policy: no-referrer
```

Repeat the unauthenticated call and confirm the **same** cache headers appear on
the `401`. A failure response must not be cacheable either.

## 2. Fails closed, without taking sync down

Restart the server with `REPORTING_ADMIN_SECRET` unset.

The startup line must end with `reporting: disabled`. Then:

```bash
# Reporting refuses even with the correct secret: there is nothing to match
curl -s -H "Authorization: Bearer $REPORTING_ADMIN_SECRET" \
  "http://localhost:8788/v1/reporting/overview?eventId=ff-rc-2026-08-23"

# Sync is completely unaffected
curl -s http://localhost:8788/health
curl -s -X POST -H 'Content-Type: application/json' \
  -d "{\"eventId\":\"ff-rc-2026-08-23\",\"deviceId\":\"<a uuid>\",\"enrollmentSecret\":\"$SYNC_ENROLLMENT_SECRET\"}" \
  http://localhost:8788/v1/sync/enroll
```

**Expect** `503 reporting_not_configured` from the first, `status: ok` from the
second, and a device token from the third. Reporting being switched off must
never be able to stop a device syncing.

Also confirm a weak secret is rejected at startup rather than accepted:

```bash
REPORTING_ADMIN_SECRET=short pnpm server:start
```

**Expect** the process to exit with
`REPORTING_ADMIN_SECRET must be at least 32 characters` and no server listening.

Restart with the real secret before continuing.

## 3. Overview, and the two different numbers

```bash
curl -s -H "Authorization: Bearer $REPORTING_ADMIN_SECRET" \
  "http://localhost:8788/v1/reporting/overview?eventId=ff-rc-2026-08-23" | python3 -m json.tool
```

Check these relationships rather than any particular value:

```
coverage.registrationsWithFeedback = matchedRegistrations
                                   + registrationsWithMultipleFeedback

analytics.analysedResponses        = matchedFeedback     (matched only)
```

A participant with two conflicting responses must appear in **coverage** and in
**neither** average. On the Phase 6/7 QA data there is one such participant with
two responses rated 4 and 1; confirm that neither rating moves
`averageOverallRating`, which is computed from the matched responses only.

### Staleness, all three cases

`dataChangedSinceRun` must be `false` immediately after a run. Then, one at a
time:

1. **Sync a new record.** It must flip to `true`, and
   `registrationsAddedSinceRun` (or `feedbackAddedSinceRun`) must be 1. The run's
   own counts must not move.
2. **Sync a correction to an existing record**: a higher revision, accepted. It
   must be `true` with the added-counts still 0: `latestContentChangeAt` is what
   moved.
3. **Re-sync a batch a device has already delivered**, unchanged. Phase 6 answers
   `already_current`. Freshness must stay `false`.

Case 3 is the one worth being deliberate about. An offline tablet reconnecting
and re-uploading is the most ordinary event in this system, and reporting it as
"the data changed" trains operators to ignore the warning. Confirm in SQL that the
retry really landed and that the two timestamps disagree, which is the point:

```sql
SELECT last_received_at, content_changed_at FROM registrations
 WHERE record_id = '<the re-sent record>';
```

`last_received_at` moves on every delivery; `content_changed_at` only when the
server accepted new content.

### Historical runs

Request an older `runId` explicitly and confirm `isHistoricalRun` is `true`. On
the screen, the warning must be visible on **every** tab (Participants,
Responses, Needs review, Duplicates and Export), not only on Overview, and it must
say both halves: reconciliation statuses are historical, while names, phone
numbers, emails and answers are the current canonical values.

### Run membership

With a run selected, sync a new registration and a new response, then:

```bash
# Absent from the selected run's browsers
curl -s -X POST -H "Authorization: Bearer $REPORTING_ADMIN_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"ff-rc-2026-08-23","runId":"<older run>"}' \
  http://localhost:8788/v1/reporting/registrations/query

# Absent from its detail view: 404 under the older run, 200 under a new one
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $REPORTING_ADMIN_SECRET" \
  "http://localhost:8788/v1/reporting/registrations/<new record>?eventId=ff-rc-2026-08-23&runId=<older run>"
```

Then check the arithmetic on the exports for that run:

```
registrations CSV data rows == run.counts.registrationCount
feedback CSV data rows      == run.counts.feedbackCount
```

A row in a historical file that the run never classified is a file describing a
state of the event that never existed.

## 3a. Malformed input is refused, not passed to the database

```bash
for path in \
  "overview?eventId=ff-rc-2026-08-23&runId=not-a-uuid" \
  "duplicates?eventId=ff-rc-2026-08-23&runId=not-a-uuid" \
  "registrations/not-a-uuid?eventId=ff-rc-2026-08-23" \
  "feedback/12345?eventId=ff-rc-2026-08-23" \
  "overview"; do
  curl -s -o /dev/null -w "%{http_code} $path\n" \
    -H "Authorization: Bearer $REPORTING_ADMIN_SECRET" \
    "http://localhost:8788/v1/reporting/$path"
done
```

**Expect `400` for every one**, with body `{"error":"invalid_request"}`. A `500`
here would mean a value reached a `::uuid` or `::timestamptz` cast.

Do the same for a cursor:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer $REPORTING_ADMIN_SECRET" -H 'Content-Type: application/json' \
  -d '{"eventId":"ff-rc-2026-08-23","cursor":"rubbish"}' \
  http://localhost:8788/v1/reporting/registrations/query
```

## 3b. A rejected credential ends the session

Sign in on `#/reporting`, open Participants so real names are on screen, then
rotate `REPORTING_ADMIN_SECRET` on the server and restart it. Click anything that
issues a request.

**Expect** the screen to return to the sign-in form with a notice that the secret
was rejected, and **every participant's name, phone number and email to be gone
from the page**, not merely covered by an error message. Confirm in DevTools that
the panels are unmounted and that nothing was written to storage on the way out.

## 4. The browsers, and where an answer is not

```bash
# A participant with several responses
curl -s -X POST -H "Authorization: Bearer $REPORTING_ADMIN_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"ff-rc-2026-08-23","status":"multiple_feedback"}' \
  http://localhost:8788/v1/reporting/registrations/query | python3 -m json.tool
```

**Expect** `reconciliationStatus: "multiple_feedback"`,
`validFeedbackCount: 2`, and `feedbackSummary: null`. A summary here would be a
guess presented as the participant's answer.

Open that participant's detail view and confirm **both** responses are listed in
full, with their individual ratings, and that nothing marks one as preferred.

```bash
# Responses that matched no registration
curl -s -X POST -H "Authorization: Bearer $REPORTING_ADMIN_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"ff-rc-2026-08-23","status":"without_registration"}' \
  http://localhost:8788/v1/reporting/feedback/query | python3 -m json.tool
```

### Search must not appear in a URL

Search from the screen (`#/reporting` → Participants) for a participant's phone
number, then check both:

- the browser's address bar still reads `#/reporting`; no search term in it
- the server log line reads `reporting registrations event=… rows=N ms=…`: a
  count and a timing, with no term, no name and no body

Search is a `POST` with a JSON body precisely so a phone number never reaches an
access log.

### Pagination

```bash
curl -s -X POST -H "Authorization: Bearer $REPORTING_ADMIN_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"ff-rc-2026-08-23","limit":2}' \
  http://localhost:8788/v1/reporting/registrations/query
```

`nextCursor` is opaque base64url. Pass it back and confirm the second page
contains no row from the first.

## 5. The explicit reconciliation trigger

Take a checksum of the evidence before and after, and confirm nothing moved:

```sql
SELECT md5(string_agg(record_id||name||phone||email||revision||updated_at, '|'
                      ORDER BY record_id)) FROM registrations;
SELECT md5(string_agg(record_id||answers::text||revision, '|'
                      ORDER BY record_id)) FROM feedback;
```

```bash
curl -s -X POST -H "Authorization: Bearer $REPORTING_ADMIN_SECRET" \
  -H 'Content-Type: application/json' -d '{"eventId":"ff-rc-2026-08-23"}' \
  http://localhost:8788/v1/reporting/reconcile
```

**Expect** a new `runId` and matching counts, both checksums **identical**, and
one additional row in `reconciliation_runs` with the previous runs untouched.
Reporting's only write creates a new derived snapshot; it never edits evidence
and never rewrites history.

## 6. Exports

```bash
for kind in registrations.csv feedback.csv duplicate-candidates.csv report.xlsx; do
  curl -s -D - -H "Authorization: Bearer $REPORTING_ADMIN_SECRET" \
    "http://localhost:8788/v1/reporting/export/$kind?eventId=ff-rc-2026-08-23" \
    -o "$kind" | grep -i -E 'content-disposition|cache-control'
done
```

For each file, confirm:

- the filename is `ff-rc-2026-08-23-<kind>-<date>.<ext>`: **no participant name,
  code, phone number or email in the filename**
- `cache-control: no-store, private` is present on the download too
- the row count matches the run: registrations CSV has one row per registration,
  feedback CSV one row per response

Then check the two things that break spreadsheets:

- **The ambiguous participant's row** in `registrations.csv` has its last six
  columns empty (`feedback_record_id` through `comments`). Both of their
  responses are present in `feedback.csv` with their own ratings.
- **Formula injection.** Any value starting `=`, `+`, `-` or `@` is prefixed with
  an apostrophe and quoted. An international phone number is the common case:
  `+919876543210` must appear as `"'+919876543210"`. Open the CSV in Excel or
  Numbers and confirm no cell evaluates and no cell reads `#NAME?`.

For the workbook, confirm five sheets (Summary, Registrations, Feedback,
Duplicate Candidates, Metadata), and that **every** participant-derived cell is
text, not a number and never a formula. The Metadata sheet must state the
inclusion rules: `analyticsInclusionRule`, `coverageRule`,
`multipleFeedbackRule`, `snapshotCaveat`, `supportedFormVersion`.

The snapshot caveat is the one worth reading aloud: reconciliation statuses are
historical for the selected run, while names, phones, emails and answers are the
current canonical values and may have been revised after the run completed.

## 6a. Questionnaire versions

If the event contains a response captured under a form version this build does not
know, confirm all of the following:

- it is **counted** in `analytics.unreadableFormVersions` and excluded from
  `analysedResponses`, the average rating, the experience counts and the
  recommend percentage
- the participant's row has **no** feedback summary
- the response's row in the browser shows no rating
- both CSVs and the workbook contain the row with its `form_version`, and the v1
  answer columns are **blank**
- its detail view shows the raw answers exactly as stored, with a notice naming
  the version

A later questionnaire may reuse `overall_rating` for a ten-point scale. Reading it
as a 1–5 answer would move an average by an amount nobody can see.

## 7. Duplicate candidates

```bash
curl -s -H "Authorization: Bearer $REPORTING_ADMIN_SECRET" \
  "http://localhost:8788/v1/reporting/duplicates?eventId=ff-rc-2026-08-23" | python3 -m json.tool
```

Both sides of each pair are shown with their public codes. There is no merge
action and no endpoint that could merge: a shared phone number at an event is
common and legitimate.

If `truncated` is `true`, the screen must say how many pairs the run found and
point at the CSV, which is never truncated. A page of 50 presented as if it were
all of them would be the misleading failure here.

## 8. Nothing is stored on the reviewing machine

With the reporting screen open on real data, in DevTools:

- **Application → IndexedDB**: the local database contains only this device's
  own captures. No central registration, response or aggregate appears in it.
- **Application → Local Storage / Session Storage**: empty of report data, and
  the reporting secret appears in neither.
- **Application → Cache Storage**: the precache holds built assets only. No
  entry for `/v1/reporting/*`.
- **Network**: every reporting response shows `Cache-Control: no-store, private`.
  Reload with the network throttled to offline: the screen fails to load data and
  shows an error. It must **not** serve a cached copy of anyone's details.

Press **Sign out**, then reload. The screen must ask for the secret again: a
credential that survived either would be a credential that survived the machine
being handed to someone else.

## 9. Logs carry no PII

Read the whole server log for this session and confirm every line is identifiers,
counts and timings. There must be no name, phone number, email address, comment,
answer, search term, reporting secret or Authorization header anywhere in it.

Auth failures log a reason and a path, never the credential:

```
reporting auth failed reason=rejected path=/v1/reporting/overview
reporting overview event=ff-rc-2026-08-23 run=<uuid> ms=5
reporting export kind=xlsx registrations=13 feedback=6 run=<uuid> ms=35
```

## 10. CORS is still explicit

```bash
# An allowed origin, for a reporting GET
curl -s -o /dev/null -D - -X OPTIONS -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: GET' \
  http://localhost:8788/v1/reporting/overview | grep -i access-control

# The same for a sync POST. Phase 6 must not have regressed
curl -s -o /dev/null -D - -X OPTIONS -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: POST' \
  http://localhost:8788/v1/sync/batch | grep -i access-control

# A foreign origin
curl -s -o /dev/null -D - -X OPTIONS -H 'Origin: https://evil.example' \
  -H 'Access-Control-Request-Method: GET' \
  http://localhost:8788/v1/reporting/overview | grep -i access-control-allow-origin
```

**Expect** `access-control-allow-methods: GET,POST,OPTIONS` and the echoed origin
for the first two, and **no** `access-control-allow-origin` header for the third.
There is no wildcard anywhere.

## 11. Scale

The automated suite covers 10,000 registrations and 9,000 responses. Point it at
a scratch database; it writes ~19,000 rows and clears them first, so never aim
it at a database holding an event:

```bash
REPORTING_SCALE_DATABASE_URL=postgres://localhost:5432/oef_scale_test pnpm server:test
```

It prints its timings. Reference figures from a development machine
(Postgres 14, local socket):

| Operation | Time |
| --- | --- |
| overview (whole event) | 15 ms |
| first page of 50 registrations | 2 ms |
| 39 further pages of 50 | 32 ms total |
| search by name substring | 6 ms |
| filter to `multiple_feedback` | 2 ms |
| export 10,000 registrations | 37 ms |
| export 9,000 responses | 35 ms |
| build the whole XLSX workbook | 1.3 s |

The test also prints the query plan for a page of registrations and asserts it is
an index only scan using `registrations_event_browse_idx`. If that assertion ever
fails, paging has quietly become proportional to the size of the event.

## What must be true at the end

- A device token and the enrolment secret are both refused by reporting.
- With no reporting secret configured, reporting returns 503 and sync still works.
- No registration, response or reconciliation row was modified by anything in
  this pass; the only new rows are reconciliation runs.
- A participant with several responses has no answer attached anywhere (screen,
  CSV or workbook), and every one of their responses is present in full.
- No participant data reached IndexedDB, localStorage, sessionStorage or a cache
  on the reviewing machine.
- No PII, and no credential, appears in any URL, filename or log line.
- Each export's row count equals the selected run's own count, and no record that
  arrived after the run appears in it.
- A re-delivered, unchanged batch did not make a current run report as stale.
- A 401 ended the session and cleared the data from the page.
- Malformed ids and cursors returned 400, never 500.
