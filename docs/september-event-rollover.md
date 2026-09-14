# Rolling a device from the August event to September

The September event is **`ff-2026-09-20`**, on **20 September 2026**, running in
**Bengaluru and Hyderabad on the same day** as one event.

This runbook covers moving a tablet that ran `ff-rc-2026-08-23` onto the new
build, and preparing a fresh one. It is written to be followed in order by
somebody who is not a developer.

> Nothing in this document is a production cleanup instruction. The one step
> that deletes central data is at the end, is deliberate, and happens only after
> verification.

> **This runbook is about devices, and it starts after the release is live.**
> The server side happens first and once: migration `009_feedback_location.sql`
> is applied to production Neon, the current build is confirmed still working,
> and only then is the September release deployed. One Vercel release contains
> both the client and the API, so the migration cannot wait until "the client
> updates". See [vercel-production.md](vercel-production.md#d-deploy). Do not
> prepare tablets until that sequence is finished and smoke-tested.

---

## Why a rollover needs a procedure at all

Two facts about the system make "just install the new build" unsafe.

**Sync credentials are bound to one event.** A device token is issued for a
specific `eventId`, and the server checks it twice: once when authenticating the
batch, and again per record, refusing anything whose own event differs from the
batch's. A tablet holding August's credential cannot upload anything to the
September event, and a tablet holding September's credential cannot upload
August's leftover records.

**That second half is the one that loses data.** Records captured in August
carry `ff-rc-2026-08-23` on themselves. Once a device is enrolled for September,
those records can never be uploaded from it: the server answers `wrongEvent` and
the client marks each one with a permanent error. They are still on the device
and still in any backup, but the only ways to deliver them are the previous build
or a manual import.

So the order is: **close August first, then roll over.** The Admin screen will
tell you if you have not, and will make you acknowledge it before enrolling.

### What the software does if you skip this anyway

The runbook is the plan. These are the guarantees that hold when nobody follows
it, so that a skipped step costs an operator some confusion rather than costing
a rider their registration:

- **September sync never touches August records.** A sync run only ever attempts
  records belonging to the event its credential is for. August's are not sent,
  not marked, not revised and not deleted. They stay exactly as they are.
- **A September device holding an August credential attempts nothing at all**,
  not even its own September records. It cannot upload with that credential, and
  trying would only produce a failure on a screen where nothing is broken yet.
- **Point A ignores August riders.** The recent list, which is the route to the
  correction form, shows this event's registrations only. An August rider cannot
  be opened for correction on a September device and have a September city
  written onto their record.
- **The counters mean this event.** Point B's response count and Admin's pending
  figures are September's. August's records are reported separately, by name.
- **Point A can still register riders.** A device holding August registrations
  used to be unable to save a September one at all, because the public-code
  sequence restarts per event and the code it regenerated was already taken.
  Allocation now steps over codes this device has already issued.

---

## Step 1. Close the August event on the device

Open **Device Admin** on the tablet, on the build it is currently running, and
confirm all five:

| Check | Required value |
| --- | --- |
| Pending registrations | `0` |
| Pending feedback | `0` |
| Sync errors | `0` |
| Last successful sync | A real timestamp, after the last rider |
| Encrypted backup | Taken, if your process requires one |

If pending is not zero, connect the device to the internet and press **Sync
now**, then re-check. If sync errors are not zero, do not proceed: those records
have not reached the server and wiping the device destroys them.

Take the encrypted backup **before** anything is reset. The passphrase is not
stored anywhere by the application; if it is lost the file cannot be read.

---

## Step 2. Reset local site data, if that is your chosen process

Only once step 1 is fully green.

A clean install is the simplest way to guarantee the device carries nothing from
the previous event: no stale credential, no leftover records, no remembered
venue. Clear site data for the application's origin in the tablet's browser, then
reload.

If you prefer **not** to wipe, that is supported and the application handles it
honestly: the Admin screen will report `Enrolled for a different event` rather
than `Enrolled`, will not attempt to sync, and will make you acknowledge any
undelivered records before letting you enrol. It will never discard the old
credential on its own.

Admin's **Local data** panel states plainly that another event's records are on
the device, names the event, and warns you when some of them have not reached
the central server. That warning is the one to read before clearing site data:
those records may be the only copy.

---

## Step 3. Load the September build

Open the application and confirm on the **home screen**:

- the date reads **20 September 2026**
- the venue badge reads **Bengaluru / Hyderabad**

The home screen names both cities because it is not a station and records
nothing. A single city here would be a claim about a device nobody has pointed at
a desk yet.

---

## Step 4. Choose the location

This is the step that is new for September, and the one most worth getting right:
**the city cannot be recovered from anything else on a record.** A direct
contact response in particular matches no registration, so if its city is wrong
there is nothing anywhere to contradict it.

On **Point A** (`#/a`), the **Event Location** card sits above Step 01. On **Point
B** (`#/b`), the selector sits under the banner.

- A device that has never been set up opens with **nothing chosen**. This is
  deliberate. There is no default, because Bengaluru and Hyderabad are
  indistinguishable in the data afterwards.
- **Point A** will refuse to save a registration until a city is chosen.
- **Point B** will not offer the scanner, manual entry or the contact form at all
  until a city is chosen.

Choose the city this tablet is physically in. The choice is remembered for this
event on this device, so staff answer it once rather than once per rider, and it
survives "Next rider" and a reload.

Confirm the caption under the banner now names that city. It is stated there, not
only inside the dropdown, so that a wrongly set tablet is noticed by somebody
glancing at the screen rather than by somebody who thought to check.

**Changing it later is allowed and expected.** If a desk moves between cities,
change the selector; every record written afterwards carries the new city, and
records already written are untouched.

The choice is stored per browser under `event-location:ff-2026-09-20`. It is
deliberately *not* part of an encrypted backup: restoring a Bengaluru tablet's
backup onto a replacement in Hyderabad must not silently set that machine to
Bengaluru.

---

## Step 5. Enrol the device for September

On **Device Admin**, in the Central sync panel:

- A clean device reads **Not enrolled**. Enter the enrolment code and enrol.
- A rolled-over device reads **Enrolled for a different event**, with an
  explanation. If it still holds undelivered records, it will state how many and
  require you to tick an acknowledgement before offering the form. Read that
  count. If it is not zero, go back to step 1.

After enrolling, confirm the status reads **Enrolled**.

---

## Step 6. Verify the device is ready

On **Device Admin**:

- Offline readiness reads **Ready for offline use**. If it does not, keep the
  device online until it does; this is what lets it work with no network at the
  venue.
- The application version matches the other devices. Compare them by eye.

---

## Step 7. One test rider, end to end

Use an obviously fake name. The point is to prove the whole path works on this
physical device before the event, not to test the questionnaire.

1. **Point A**: register the test rider, confirm the sticker prints at 50 × 40 mm
   and the printed code matches the screen.
2. **Point B**: scan that sticker, answer every question, submit.
3. **Point B again**: submit one direct contact response, to exercise the path
   that has no sticker.
4. **Admin**: press **Sync now**. Confirm pending returns to `0` and sync errors
   stay at `0`.

Then confirm centrally, in **Reporting**, that the test records arrived with the
right city: the response should appear under the city you set in step 4, and the
direct response should be attributable to it from its own record rather than from
any registration.

---

## Step 8. Remove the test data centrally, before event day

Only after step 7 has been verified, and only as a deliberate, documented
cleanup. Record the exact record IDs from step 7 and delete those, by ID.

Do not delete by name, email, phone, or by a broad timestamp range. Do not delete
the device enrolment rows: they are audit history, and a device is stopped by
revoking it, not by deleting it.

---

## What must never happen to the August data

The same database holds both events. September work is scoped by
`event_id = 'ff-2026-09-20'`; August remains `event_id = 'ff-rc-2026-08-23'`.

Do not delete August registrations, feedback, reconciliation runs or sync audit
rows. Do not rewrite August's `event_id`. Do not backfill August records with a
September city: a NULL location on an August response means *the location was not
captured*, which is the truth, and reporting shows it as blank or **Not
captured** rather than inventing a venue.

---

## Quick reference

| Symptom on Admin | What it means | What to do |
| --- | --- | --- |
| `Not enrolled` | Clean device, no credential | Enrol for `ff-2026-09-20` |
| `Enrolled` | Credential for this event | Nothing |
| `Enrolled for a different event` | August credential still present | Close August, then enrol |
| Pending > 0 after Sync now | Records have not reached the server | Do not wipe the device |
| Sync errors > 0 | Records the server refused | Investigate before wiping |

| Symptom at a station | What it means | What to do |
| --- | --- | --- |
| Point B offers no way in | No city chosen on this device | Choose one in the selector |
| Point A says *Select the event location.* | Same | Choose one, then resubmit |
| Caption reads `Bengaluru / Hyderabad` at a station | No city chosen yet | Choose one |
| Caption names the wrong city | Device set to the wrong city | Change it; earlier records are not rewritten |
| Point B's location selector is greyed out | A rider is part-way through a response | Finish or cancel it; the change applies to the next rider |
| Admin says records from another event remain | A previous event's data is still here | Safe to leave; deal with it before clearing site data |

## One rule worth remembering about the location

A response is filed under the city that was selected **when that response
started**. Changing the selector part-way through a rider's answers does not
move them, and the control is disabled while a response is open so this is
visible rather than merely true. Change it between riders and it applies from
the next one.
