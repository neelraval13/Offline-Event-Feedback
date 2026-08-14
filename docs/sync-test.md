# Central sync: real Postgres QA

The automated suites exercise ingest semantics against an in-memory store with
the same atomicity contract as the SQL. What they cannot prove is that the SQL
is written correctly: that the unique indexes exist, that `ON CONFLICT DO
NOTHING` behaves as intended, that a revision-conditional `UPDATE` really is
conditional. Only a real database proves that.

This is that pass. Run it before any event that depends on synchronisation.

## Ground rules

- **No event operation depends on this.** Point A and Point B work with the
  server switched off, and every step below can be abandoned without risk to a
  single local record.
- **Production is HTTPS.** Registrations carry names, phone numbers and email
  addresses. `localhost` is exempt for development because the browser already
  treats it as a secure context.
- **The enrolment code is not a password to share.** It is typed once per
  device and stored nowhere.

## 1. Prepare a database

```bash
createdb offline_event_feedback_test
cp .env.example .env      # then edit
```

Set `DATABASE_URL` to the new database and `SYNC_ENROLLMENT_SECRET` to a long
random value:

```bash
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

Apply the schema deliberately. The server never does this on startup:

```bash
pnpm server:migrate
```

Expect `✓ 001_initial_sync.sql`. Run it a second time and expect
`already applied`: migrations are tracked, and re-running is a no-op.

Confirm the shape:

```sql
\d registrations
\d feedback
\d sync_devices
```

Check specifically that `registrations` has unique indexes on
`(event_id, participant_id)` and `(event_id, public_code)`, and that `feedback`
has **no** unique index on `public_code` and **no** foreign key to
`registrations`.

## 2. Start the server

```bash
pnpm server:start
curl -s localhost:8788/health
```

Expect `{"status":"ok","protocolVersion":1,"database":true}` and nothing about
the connection string.

## 3. Start two devices

Build the client with the API location set:

```bash
VITE_SYNC_API_BASE_URL=http://localhost:8788 pnpm build && pnpm preview
```

Open it in **two separate Chrome profiles**: separate profiles, not tabs, so
each gets its own IndexedDB and therefore its own device identity. Call them
**Device A** and **Device B**.

On each, open `#/admin` and note the **Device ID**. They must differ.

## 4. Enrol both devices

On each device: `#/admin` → **Central sync** → type the enrolment code →
**Enroll device**.

Expect *"This device is enrolled for central sync."*

Then check the central table:

```sql
SELECT event_id, uploader_device_id, left(token_hash, 12) AS hash_prefix,
       created_at, revoked_at
FROM sync_devices;
```

Two rows. **The tokens are not there**: only a SHA-256 hash. Nothing you can
replay.

Now try a **wrong** enrolment code on a third profile. Expect *"Device could not
be enrolled. Check the enrollment code and try again."* and no new row.

## 5. Capture offline, then sync

On **Device A**, with Wi-Fi **off**:

- register several participants at `#/a`
- record feedback for some of them at `#/b`, including **one manual-entry**
  record (type the printed code rather than scanning)

`#/admin` shows the pending counts. Note them.

Turn Wi-Fi back on and press **Sync now**.

```sql
SELECT count(*) FROM registrations;
SELECT count(*) FROM feedback;
```

They should match what Admin reported. Then confirm the local statuses flipped:
`#/admin` shows pending at zero and **Synced** at the same total.

## 6. Sync again: idempotency

Press **Sync now** a second time.

Expect: *"Everything on this device is already synced."* There is nothing
pending, so nothing is sent. Central counts unchanged.

Now force a resend by flipping one record back:

```js
// DevTools console on Device A
const db = await new Promise((ok) => { const r = indexedDB.open('offline-event-feedback'); r.onsuccess = () => ok(r.result) })
// mark one registration pending again via the app's own Admin restore path,
// or simply re-run Sync after correcting a record in step 7.
```

Simpler and more realistic: continue to step 7, which produces a genuine resend.

## 7. Edit a record and sync the higher revision

On Device A: `#/a` → **Recent registrations** → **Correct details** → change the
email → save.

Admin shows one pending registration again, and its revision has increased.

Press **Sync now**, then:

```sql
SELECT revision, email, last_uploader_device_id
FROM registrations WHERE record_id = '<the record id>';
```

Revision incremented, email updated. The participant ID and public code are
unchanged, check them.

## 8. Feedback before registration

This is the ordering the server must tolerate.

On **Device B**: capture feedback for a participant registered on Device A,
scan one of A's stickers, but **do not sync Device A first**. Sync Device B.

```sql
SELECT record_id, public_code, participant_id FROM feedback ORDER BY first_received_at DESC LIMIT 1;
SELECT count(*) FROM registrations WHERE public_code = '<that public code>';
```

The feedback row exists; the registration does not yet. No foreign key blocked
it. Now sync Device A and confirm the registration inserts normally.

## 9. Restore-aware upload: the mandatory case

Take an encrypted backup on **Device A** (`#/admin` → **Create encrypted
backup**), then restore it onto **Device B** following
[the recovery drill](backup-restore-test.md).

Device B now holds records captured by Device A. Press **Sync now** on Device B.

```sql
SELECT record_id, source_device_id, last_uploader_device_id
FROM registrations
ORDER BY last_received_at DESC LIMIT 5;
```

**Expected, and the point of the whole exercise:**

- `source_device_id` is **Device A**: provenance survives recovery
- `last_uploader_device_id` is **Device B**: delivery is recorded separately

If the server had required `record.deviceId` to equal the uploader, recovered
records would be permanently unsyncable.

Also confirm Device B had to enrol on its own account: the backup carried no
credential, so it could not have inherited A's.

## 10. Two feedback records, one public code

Have Device A and Device B each record feedback for the same participant, then
sync both.

```sql
SELECT count(*) FROM feedback WHERE public_code = '<code>';
```

**Two rows.** Neither overwrote the other. That is a reconciliation question for
a later phase, not something ingest is allowed to silently resolve.

## 11. Conflict behaviour

Force one deliberately. With a record already synced, edit it directly in
IndexedDB so its contents differ at the **same** revision, then sync.

Expect: Admin shows **Sync errors: 1**, the record is locally marked `error`
with a code such as `REVISION_CONFLICT`, and the central row is **unchanged**.
Subsequent syncs do not retry it.

## 12. Server unavailable

Stop the server (`Ctrl+C`) and press **Sync now**.

Expect:

> Sync could not reach the central server. Your local records are safe and
> remain pending. Try again when connectivity is available.

Confirm the records are still `pending`, not `error`; nothing is known to be
wrong with them. Open `#/a` and `#/b` and confirm both work normally. Restart
the server and sync again; the records go up.

## 13. Revocation

```sql
UPDATE sync_devices SET revoked_at = now()
WHERE uploader_device_id = '<Device B>';
```

Press **Sync now** on Device B. Expect *"This device is no longer authorised to
sync."* and no new central rows. Re-enrolling restores it.

## 14. Logs

Read the server output for the whole session. It may contain batch IDs, device
IDs, event IDs, counts and durations. It must contain **no** name, phone number,
email address, feedback comment, device token, enrolment code or Authorization
header. If any appears, treat it as a privacy defect.

## What to record

| Step | Result |
| --- | --- |
| 1: migrations apply, re-run is a no-op | |
| 4: tokens stored hashed only | |
| 5: central counts match local | |
| 6: second sync sends nothing | |
| 7: higher revision accepted, identity unchanged | |
| 8: feedback before registration accepted | |
| 9: source device A, uploader device B | |
| 10: two feedback rows for one code | |
| 11: conflict marked locally, central row untouched | |
| 12: records stay pending, A and B keep working | |
| 13: revoked device rejected | |
| 14: no PII in logs | |

## Known limitations

- **No reconciliation.** Duplicate participants across devices, and multiple
  feedback records for one code, are preserved and left for a later phase.
- **No central read API.** Nothing reads records back out of the server; use
  `psql` for these checks.
- **No revocation UI.** Manual SQL is the V1 mechanism.
- **Sync is manual and opportunistic.** There is no background sync and no
  polling: an operator presses **Sync now**, plus one attempt when Admin opens
  and one when the browser reports connectivity returning.
