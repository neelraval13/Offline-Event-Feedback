# True offline cold-start test

The test that decides whether this application is venue-ready.

## Why the previous offline test was not enough

Earlier phases were tested with the Internet disconnected while `pnpm preview`
kept serving `localhost`. That proved the **data** path works offline (no API
calls, no CDN, no lookups), and that was worth proving.

It did not prove the app can *start*. The origin server was still there, still
answering for `index.html` and the JavaScript bundle. Pull the power on that
server and the earlier test says nothing about what happens.

This test removes the server. That is the entire point, and it is the one step
that must not be skipped or approximated:

> **Stop `pnpm preview`. Actually stop it. `Ctrl+C` the process.**

Everything after that runs from Cache Storage or it does not run at all.

Only after this test passes may anyone say **"venue-ready offline cold start."**

## Before you start: what may be cleared and what may not

| Storage | Holds | Safe to clear? |
| --- | --- | --- |
| **Cache Storage** | application code, CSS, icons | Yes, it re-downloads when online |
| **IndexedDB** | **participant registrations and feedback** | **No, this is event data** |

Chrome's **Clear site data** button clears *both*. Using it during PWA
debugging is how a day of registrations disappears. The safe reset procedure is
in [architecture.md](architecture.md#resetting-the-app-cache-safely) and never
involves that button.

There is no backup or export yet. Treat IndexedDB as irreplaceable.

## Preparing a device for the event

The short version, for whoever sets up the tablets. No developer tools, no
terminal, and nothing below needs doing on a device that is already **Ready for
offline use**.

1. Connect the device to the Internet.
2. Open the production app.
3. Open **Device Admin**.
4. If **Offline readiness** says *Preparing* after the page has finished
   loading, reload the page once.
5. Confirm it reads **Ready for offline use**.
6. Only then test with Wi-Fi disabled.

That is the whole preparation. If a device will not reach *Ready for offline
use* after one reload while online, take it out of the rotation and use another;
do not try to fix it by clearing anything. **Never** clear site data, unregister
the service worker, or delete Cache Storage or IndexedDB on a device that has
taken registrations: those records are the event, and they live in IndexedDB
until they sync.

The rest of this document is the full engineering test, run once per release
rather than once per device.

## A. Prepare the device (online)

```bash
pnpm typecheck
pnpm test
pnpm build      # also runs scripts/verify-pwa-build.mjs
pnpm preview
```

The build prints a verification line. It must say the assets are all cached:

```
✓ PWA build verified: 8 precached entries, 2 JS + 1 CSS assets (826 KiB) all cached,
  navigation fallback present, updates gated on an operator.
```

Open the printed URL in Chrome. Then:

1. **Confirm the service worker is controlling the page.** DevTools →
   Application → Service Workers: status **activated and is running**, and the
   page is controlled (Application → Manifest also shows no errors). A worker
   that is *installed* but not *controlling* is not yet ready.
2. **Confirm the precache.** DevTools → Application → Cache Storage → the
   `workbox-precache-*` entry. The JavaScript bundle (~830 kB), the CSS, the
   manifest and the icons must all be listed.
3. **Confirm Admin agrees.** Open `#/admin`. It must read:

   ```
   Offline readiness     Ready for offline use
   Application version   0.0.0 · 2026-..-..T..:..:..Z
   ```

   If it still says *"Preparing"*, **reload the page once** and read it again.
   A service worker installs on the first visit and takes control of the page on
   the next one, so the first load of a fresh device is legitimately
   uncontrolled; this was verified against the production deployment and one
   reload resolves it. If it still says *"Preparing"* or says *"Not ready"*
   after that reload, stop: the device is not prepared and the rest of this test
   will fail for the right reason.

4. **Visit every surface while still online** (`#/a`, `#/b`, `#/admin`) so no
   browser-lazy behaviour is left unexercised.
5. **Grant the camera permission** at `#/b` and confirm the preview appears.
   Permission is per-origin and persists; granting it offline later is not
   possible.
6. **Create real test data**: at least one registration at `#/a` (print or at
   least open the print preview) and at least one feedback record at `#/b`.
7. Note the **Device ID** from Admin. It must be identical at the end.

## B. Remove the server

```
Ctrl+C   # in the terminal running pnpm preview
```

Confirm it is gone; reloading the page in a *new* tab should now fail if the
service worker were not there. Do not skip this; a backgrounded process still
serving on 4173 invalidates the whole test.

## C. Cold start

1. Close the application tab. For the strongest pass, **quit Chrome entirely**.
2. Keep the preview server **stopped**.
3. **Disconnect Wi-Fi / unplug Ethernet.**
4. Reopen Chrome and navigate to the same URL (or launch the installed PWA).

**Expected:** the application loads, from Cache Storage, with no server and no
network.

If it fails here, nothing below matters: the shell is not cached and the device
is not field-ready.

## D. Point A, offline

Open `#/a`.

- Create a new registration.
- Confirm the record in DevTools → Application → IndexedDB →
  `offline-event-feedback` → `registrations`.
- Confirm the sticker renders with its QR and public code.
- Open the print preview and confirm it is **one** 50 × 40 mm page.
- Confirm the registrations created in step A are **still there**.

## E. Point B, offline

Open `#/b`.

- Start the camera. It must not re-prompt for permission.
- Scan a sticker printed at Point A. Complete the four questions and submit.
- Confirm the feedback record in IndexedDB.
- Test the manual code fallback as well.
- Scan an already-recorded sticker and confirm *Feedback already recorded on
  this device*.

## F. Admin, offline

Open `#/admin`.

- The screen loads.
- **Device ID is the same value noted in step A.** A changed device ID means
  IndexedDB was lost, which is a serious failure.
- Offline readiness still reads **Ready for offline use**.
- The application version is shown, with no network available to look it up.
- All records from steps A, D and E are present.

## G. Cold start again

Close the app. With the server still stopped and the Internet still
disconnected, reopen it.

**Expected:** it starts again, and all data is still present.

A single successful cold start can be luck: a warm HTTP cache, a tab that was
never really closed. Two in a row from a fully quit browser is the evidence.

---

# Installed-PWA test

Where Chrome permits installation (it requires a secure context; see below):

1. Prepare the device online exactly as in section A.
2. Install the app (address-bar install icon, or ⋮ → Cast, save and share →
   Install page as app).
3. Close all Chrome tabs for the app.
4. Stop the server. Disconnect the Internet.
5. Launch the installed application from the OS.

**Expected:** it opens standalone at the home screen, Point A works, the Point B
camera works, and IndexedDB data is intact.

Installation is a convenience, not the supported mode: a **normal browser tab
controlled by the service worker must also pass the cold-start test above**.
Do not let a missing install badge block deployment.

## Secure context

The camera requires a secure context, and so does the service worker. Both work
on `localhost` for development. In the field the app must be served over
**HTTPS**: `http://192.168.x.x` will have neither a camera nor an offline
shell, and is not the deployment strategy.

---

# Update test

Run this before field deployment, not after every small edit.

1. **Build version N**, prepare a device as in section A, and create a
   registration and a feedback record.
2. Leave that tab open, on `#/a`, **with a half-filled form**: type a name and
   a phone number but do not submit.
3. **Build version N+1** while the device is online:
   ```bash
   pnpm build && pnpm preview
   ```
   Bump `version` in `package.json` first if you want the two builds to be
   obviously distinguishable; the build timestamp differs either way.
4. Leave the device to notice the new build (reload another tab, or wait for
   Chrome's periodic check).

**Expected:**

- **No forced reload.** The tab on `#/a` keeps running and the half-filled form
  is untouched. This is the single most important assertion of this test.
- Point A and Point B show nothing about the update at all.
- `#/admin` shows **Application update available** with an **Apply update**
  button.

5. Finish or discard the in-progress participant, then press **Apply update** in
   Admin.

**Expected:**

- The application reloads, deliberately, because an operator asked it to.
- Admin shows the new version identifier.
- **The registration from step 1 is still there.**
- **The feedback from step 1 is still there.**
- **The Device ID is unchanged.**

An update replaces application code in Cache Storage. It does not touch
IndexedDB, and nothing in the update path opens the database.

## Recording results

Note the Chrome version, the platform, whether installation was offered, the
device ID before and after, and the record counts before and after. If a cold
start fails, capture DevTools → Application → Service Workers and Cache Storage
before clearing anything, and do not use **Clear site data** to "try again",
because that deletes the participant records the test just created.
