# Backup and restore: a recovery drill

A real drill, not a smoke test. The question it answers is the one that matters
after a laptop is dropped, stolen or simply refuses to boot:

> Can a replacement device be put into service with the event's records intact,
> without cloning the failed machine's identity?

Run it before the event, on the actual hardware, with real printed stickers.

## Before you start

**The passphrase is not recoverable.** Nothing in this application stores it,
and there is no reset. Choose one, write it down somewhere physical, and keep it
apart from the backup file. A backup whose passphrase is lost is a file of
random bytes.

**A generated backup is not a verified backup.** The browser cannot tell whether
a download was kept, where it went, or whether it is readable. Only step C
proves you have something recoverable, do not consider a device protected until
it passes.

You will need: the app on two separate browser profiles (or two machines), some
real Point A stickers, and somewhere to keep the file.

---

## A. Source device: capture some data

On the device that will "fail":

1. Register **several participants** at `#/a`, printing stickers.
2. Record **several QR feedback records** at `#/b`.
3. Record **one manual-entry feedback record**: type the printed code instead
   of scanning. This one has no `participantId` by design, and the drill should
   prove it survives that way.

Open `#/admin` and write down:

| | |
| --- | --- |
| Device ID | |
| Registrations | |
| Feedback | |
| Pending registrations | |
| Two or three public codes | |

## B. Create the backup

Still on the source device, ideally with **Wi-Fi off and the server stopped**,
backup must work from the cached shell with no network at all.

1. `#/admin` → **Create encrypted backup**
2. Enter the passphrase twice.
3. Confirm the file downloads, named like
   `offline-event-feedback_20260813T162500Z.oefbackup`.

Confirm **Last backup generated** is no longer *Never*.

Note the elapsed time. For ~10,000 participants expect well under a second of
computation plus the browser's own save dialog.

### Check the filename and the outer file

Open the `.oefbackup` in a text editor. You should see only:

```json
{"format":"offline-event-feedback","version":1,"kdf":{...},"cipher":{...},"ciphertext":"..."}
```

Search it for a participant's name, an email address, a phone number and a
feedback comment. **None may appear.** Neither should the event ID or the record
counts: an unopened file says nothing about whose data it holds.

## C. Verify the backup: the step that counts

1. `#/admin` → **Verify backup file**
2. Choose the downloaded file, enter the **correct** passphrase.

Expected: **Backup verified**, with the counts and source device ID from step A,
and *"Nothing was imported."* Confirm **Last backup verified** updates.

Now the negative case:

3. Repeat with a **wrong passphrase**.

Expected: *"This backup could not be unlocked or verified…"*. One message, no
cryptographic detail, and **Last backup verified** unchanged.

## D. Tamper test

Copy the backup file twice and damage each copy:

- **Flip a character** in the middle of the long `ciphertext` string.
- **Truncate** the file: delete the second half and save.

Verify each with the correct passphrase.

Expected: both fail with the same message. AES-GCM authenticates as well as
encrypts, so a damaged file cannot decrypt into plausible-looking records.

## E. Fresh replacement installation

Use a **separate Chrome profile** (not a second tab: profiles have separate
IndexedDB) or a different machine.

1. Prepare the PWA as in [the cold-start guide](offline-cold-start-test.md) so
   the replacement can run offline too.
2. Open `#/admin` and **record the NEW device ID**. It must differ from step A.
3. **Restore backup** → choose the file → enter the passphrase → **Continue**.

At the preview, confirm:

- the counts match step A
- the source device ID matches step A
- it says the operation will **merge** and existing records will not be deleted
- it warns: *"This backup came from another device. This device will keep its
  current device identity."*

4. Press **Restore backup**.

Expected: a result summary with *added* counts matching step A, and **Local
data** counts updating to match.

Then confirm, in DevTools → IndexedDB:

- restored registrations still carry the **source** `deviceId`: provenance is
  preserved
- `deviceConfig.deviceId` is still the **replacement's** ID from step E.2

> **This is the most important assertion in the drill.** If the replacement had
> adopted the source's identity and the original machine ever came back into
> service, two independent offline devices would issue public codes from the
> same namespace and start colliding.

## F. Old sticker recovery

On the replacement device, open `#/a` and find a restored registration in
**Recent registrations**. Press **Reprint**.

Compare the reprinted sticker with the original from step A:

- same public code, character for character
- same QR symbol

Scan the **original printed sticker** at `#/b` on the replacement device. It must
be recognised. The stickers participants are already wearing remain valid; that
is what makes recovery possible at all.

## G. New registration after restore

Register a new participant on the replacement device.

Expected: the new record carries the **replacement's** `deviceId`, and its public
code uses the **replacement's issuer segment**: a different six-character block
from the restored records:

```
restored:  A1-B8EFD9-00004-X     (source device)
new:       A1-6091A1-00001-C     (replacement device)
```

If the new code reuses the source issuer, stop: the device identity was cloned
and codes will eventually collide.

## H. Idempotent restore

Restore **the same file again** on the replacement device.

Expected:

- record counts unchanged
- the result summary reports everything as **unchanged**, nothing added
- no duplicate registrations, no duplicate feedback

Restoring twice is something a nervous operator will do. It must be harmless.

## I. Offline recovery

With the **server stopped and Wi-Fi off**, repeat on the replacement device:

- verify the backup file
- restore it again
- open `#/a` and register someone
- open `#/b` and record feedback

Everything must work. No backup or recovery operation touches the network.

---

## Conflict behaviour (optional but informative)

To see the safety net work, edit a restored registration's contact details on the
replacement device (`#/a` → **Correct details**), this raises its `revision`,
then restore the same backup again.

Expected: the local, higher-revision record is kept and reported as *unchanged*.
The backup does not roll it back.

## What to record

| Step | Result | Time |
| --- | --- | --- |
| B: create backup | | |
| C: verify (correct passphrase) | | |
| C: verify (wrong passphrase) | fails | |
| D: tampered / truncated | both fail | |
| E: restore onto replacement | | |
| E: destination device ID unchanged | | |
| F: reprint matches original sticker | | |
| G: new code uses replacement issuer | | |
| H: second restore idempotent | | |
| I: everything works offline | | |

## Cautions

- **Clearing site data destroys IndexedDB**, which is the participant records.
  Never use it to "reset" a device mid-drill. See the safe reset procedure in
  [architecture.md](architecture.md#resetting-the-app-cache-safely).
- **Keep the backup file and its passphrase apart.** Together they are the
  event's PII; separately, the file alone is unreadable.
- **Restore is a merge and never deletes**, so a restore onto a device that has
  already started working is safe. It is still worth taking a fresh backup of
  that device first.
- There is no cross-device duplicate detection yet. Restoring several devices'
  backups into one database will preserve every record, including two feedback
  responses for the same participant from different terminals. That is
  deliberate: reconciliation is a later phase.
