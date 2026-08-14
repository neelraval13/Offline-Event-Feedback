# Reconciliation — real Postgres QA

Reconciliation reads the canonical central tables and writes conclusions about
them somewhere else. This pass proves it against a real database, on the data
the Phase 6 QA left behind.

## What reconciliation is, and is not

**It is derived data.** `registrations`, `feedback`, `sync_devices` and
`sync_batches` are the evidence of what devices actually captured.
Reconciliation never edits, merges or deletes any of them. Every conclusion goes
into a `reconciliation_*` table, and if a conclusion is later found to be wrong,
the evidence is still there to re-derive from.

**It classifies; it does not resolve.** Where the data is ambiguous — two
responses for one participant, two registrations that might be one person — it
says so and stops. Choosing a winner would record a guess as a fact.

**A run is a snapshot.** Feedback classified `without_registration` on Monday
and `matched` on Tuesday produces two correct snapshots, not a correction. Old
runs are never overwritten.

## Setup

Use the Phase 6 test database — it already contains useful cases.

```bash
export DATABASE_URL=postgres://localhost:5432/offline_event_feedback_test
pnpm server:migrate
```

Expect `· 001_initial_sync.sql (already applied)` and `✓ 002_reconciliation.sql`.
Run it again and expect both to report as already applied.

Confirm the structures:

```sql
\dt reconciliation*
\d+ reconciliation_latest_runs
```

Five relations: three result tables, the runs table, and the
`reconciliation_latest_runs` view.

## 1. Run it

```bash
pnpm server:reconcile -- --event evt-dev-001
```

The output is counts only — no name, phone number, email address, comment or
answer. Confirm that by reading it.

Check the arithmetic, which must always hold:

```
matched registrations + without feedback + multiple feedback  =  registrations
matched feedback + without registration + identity conflicts
                 + feedback in multiple groups                =  feedback
```

Omit `--event` and confirm it refuses rather than guessing:

```bash
pnpm server:reconcile
# Missing required argument: --event <eventId>
```

## 2. Confirm the raw records are untouched

Take a fingerprint before and after a run:

```sql
SELECT md5(string_agg(record_id::text || revision::text || email || phone, ','
                      ORDER BY record_id)) FROM registrations;
SELECT md5(string_agg(record_id::text || revision::text || answers::text, ','
                      ORDER BY record_id)) FROM feedback;
```

Run reconciliation again. Both fingerprints must be identical. In particular,
check that a manual feedback record still has `participant_id IS NULL` — the
relationship lives in the derived result, and the raw row keeps saying exactly
what the device captured:

```sql
SELECT f.record_id, f.participant_id AS raw_participant,
       r.registration_record_id AS derived_link, r.match_method
FROM feedback f
JOIN reconciliation_feedback_results r ON r.feedback_record_id = f.record_id
WHERE f.capture_method = 'manual'
LIMIT 5;
```

`raw_participant` is null; `derived_link` is populated. That is the design.

## 3. Inspect the results

```sql
-- The run itself
SELECT run_id, engine_version, started_at, completed_at,
       registration_count, feedback_count
FROM reconciliation_latest_runs WHERE event_id = 'evt-dev-001';

-- Registration outcomes
SELECT status, count(*)
FROM reconciliation_registration_results
WHERE run_id = (SELECT run_id FROM reconciliation_latest_runs
                WHERE event_id = 'evt-dev-001')
GROUP BY 1 ORDER BY 1;

-- Feedback outcomes
SELECT status, match_method, count(*)
FROM reconciliation_feedback_results
WHERE run_id = (SELECT run_id FROM reconciliation_latest_runs
                WHERE event_id = 'evt-dev-001')
GROUP BY 1, 2 ORDER BY 1;
```

### Multiple-feedback groups

The Phase 6 database already contains one public code with two feedback
records:

```sql
SELECT registration_record_id, count(*) AS responses
FROM reconciliation_feedback_results
WHERE run_id = (SELECT run_id FROM reconciliation_latest_runs
                WHERE event_id = 'evt-dev-001')
  AND status = 'multiple_feedback'
GROUP BY 1;
```

Confirm both raw feedback rows still exist. Nothing is deleted and no winner is
chosen: device clocks are not aligned across machines, and `first_received_at`
records when a device found a connection, not when a participant answered.
Neither is authority, so the ambiguity is reported rather than resolved.

## 4. Fixture — a deliberate duplicate registration

Create two registrations for the same person, with distinct record IDs,
participant IDs and public codes but identical contact details. Sync them from a
device, or insert them directly:

```sql
INSERT INTO registrations (
  record_id, participant_id, public_code, event_id, event_day, station_id,
  source_device_id, name, phone, email, created_at, updated_at, revision,
  first_received_at, last_received_at, last_uploader_device_id
) VALUES
 (gen_random_uuid(), gen_random_uuid(), 'A1-DUPE01-00001-X', 'evt-dev-001',
  '2026-01-01', 'A1', (SELECT source_device_id FROM registrations LIMIT 1),
  'Test Duplicate', '+91 98765 43210', 'Dupe@Example.com',
  now(), now(), 1, now(), now(),
  (SELECT last_uploader_device_id FROM registrations LIMIT 1)),
 (gen_random_uuid(), gen_random_uuid(), 'A1-DUPE01-00002-X', 'evt-dev-001',
  '2026-01-01', 'A1', (SELECT source_device_id FROM registrations LIMIT 1),
  'Test Duplicate Again', '919876543210', ' dupe@example.com ',
  now(), now(), 1, now(), now(),
  (SELECT last_uploader_device_id FROM registrations LIMIT 1));
```

Note the deliberately different formatting: spacing in the phone number, casing
and padding in the email. Re-run reconciliation, then:

```sql
SELECT left_registration_record_id, right_registration_record_id, match_basis
FROM reconciliation_duplicate_registration_candidates
WHERE run_id = (SELECT run_id FROM reconciliation_latest_runs
                WHERE event_id = 'evt-dev-001');
```

**Expected:** exactly one row, `match_basis = phone_and_email`, and the pair
stored once in canonical order. Not two rows, and not also `phone_only` and
`email_only` — a reviewer should see one candidate, not three.

**Also expected:** both registrations still exist as independent records.

```sql
SELECT count(*) FROM registrations WHERE public_code LIKE 'A1-DUPE01-%';  -- 2
```

A candidate means *these may be the same person*. Families share phone numbers
and couples share email accounts. Nothing is ever merged automatically, and
Phase 7 provides no way to merge anything at all.

## 5. Fixture — feedback that arrives first

Insert feedback whose public code has no registration:

```sql
INSERT INTO feedback (
  record_id, participant_id, public_code, capture_method, event_id, event_day,
  station_id, source_device_id, form_version, answers, created_at, updated_at,
  revision, first_received_at, last_received_at, last_uploader_device_id
) VALUES (
  gen_random_uuid(), NULL, 'A1-ORPHAN-00001-X', 'manual', 'evt-dev-001',
  '2026-01-01', 'B1', (SELECT source_device_id FROM feedback LIMIT 1),
  'feedback-v1', '{"overall_rating":4,"experience":"good","recommend":true}',
  now(), now(), 1, now(), now(),
  (SELECT last_uploader_device_id FROM feedback LIMIT 1)
);
```

Re-run reconciliation. The record is `without_registration` — which is not
necessarily an error. The Point A device may simply not have synced yet.

Now add the missing registration with `public_code = 'A1-ORPHAN-00001-X'` and
run reconciliation a third time.

**Expected:** the same feedback record is now `matched` with
`match_method = manual_public_code`, **and the earlier run still says
`without_registration`**:

```sql
SELECT r.started_at, f.status
FROM reconciliation_feedback_results f
JOIN reconciliation_runs r ON r.run_id = f.run_id
WHERE f.feedback_record_id = '<the orphan record id>'
ORDER BY r.started_at;
```

Two rows, two different statuses. Both are correct descriptions of the moment
they were taken.

## 6. Runs accumulate

```sql
SELECT run_id, started_at, completed_at, registration_count, feedback_count
FROM reconciliation_runs WHERE event_id = 'evt-dev-001'
ORDER BY started_at;
```

Every run you have made is listed. The view returns only the most recent
**completed** one:

```sql
SELECT run_id FROM reconciliation_latest_runs WHERE event_id = 'evt-dev-001';
```

To confirm an unfinished run is never mistaken for a result, insert one and
check the view is unchanged:

```sql
INSERT INTO reconciliation_runs (run_id, event_id, engine_version, started_at)
VALUES (gen_random_uuid(), 'evt-dev-001', 'reconciliation-v1',
        now() + interval '1 hour');

SELECT run_id FROM reconciliation_latest_runs WHERE event_id = 'evt-dev-001';
-- unchanged: completed_at IS NULL is excluded

DELETE FROM reconciliation_runs WHERE completed_at IS NULL;
```

## 7. QR identity conflicts

The Phase 6 database currently holds only manual feedback, so this case needs a
fixture. Insert a QR feedback record whose `participant_id` belongs to one
registration and whose `public_code` belongs to another.

**Expected:** `identity_conflict`, linked to neither registration, and counted
towards neither registration's `valid_feedback_count`.

The QR contract says both identifiers describe the same person. When they
disagree, preferring one silently would bury evidence that something upstream
produced an inconsistent sticker or record — so the disagreement itself is the
finding.

## What to record

| Step | Result |
| --- | --- |
| Migration 002 applies; re-run is a no-op | |
| CLI prints counts only, no PII | |
| CLI refuses without `--event` | |
| Status counts sum to source counts | |
| Raw fingerprints identical before/after | |
| Manual feedback keeps `participant_id IS NULL` | |
| Multiple-feedback group: both rows preserved | |
| Duplicate fixture: one `phone_and_email` candidate | |
| Duplicate fixture: both registrations still present | |
| Orphan feedback: `without_registration`, then `matched` | |
| Earlier run unchanged by the later one | |
| Incomplete run excluded from latest | |

## Known limitations

- **No merging, ever.** Phase 7 offers no way to merge duplicate registrations
  or pick a winning feedback record. Those are review decisions for a later
  phase with a human in the loop.
- **Exact matching only.** Duplicate candidates come from exactly equal
  normalised phone or email. No fuzzy names, no nicknames, no transposed digits.
- **Normalisation is deliberately minimal.** A missing country code is not
  inferred and no provider-specific email rules are applied — see the
  architecture notes for why.
- **A shared contact value produces a pair for every combination in the group.**
  A group of *k* registrations sharing one phone number yields *k(k-1)/2*
  candidates. Realistic groups are tiny; a placeholder value entered hundreds of
  times would not be.
- **Reconciliation is never automatic.** It is not run after a sync batch, so a
  run reflects only what had synced when it was invoked.
