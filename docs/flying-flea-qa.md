# Flying Flea campaign: manual QA

What to check by hand before the campaign runs. The automated suites cover the
rules; this pass covers the physical things a test cannot: a printed sticker, a
camera, a tablet held in daylight.

Run it on the hardware the event will use, over the network the venue has.

## 0. Build and open

```bash
pnpm build && pnpm preview
```

Open `#/` on the tablet. You should see the parachute and FF C6 marks, the lime
eyebrow, and two large station links.

Both marks must render. If either is a broken image, the inlining regressed and
the application is fetching assets it must not need.

## 1. Point A: a rider, end to end

Open `#/a`.

1. Tap a vehicle plate. It should read at arm's length and show clearly which is
   selected.
2. Confirm the colour selector starts on **Flea Green** and switches to **Storm
   Black** cleanly. It must never show both or neither.
3. Confirm the venue and date read **Richardson & Cruddas** and **23 August 2026**
   under the banner, and that neither is a form control.
4. Fill Name, Email ID, Phone Number. Leave Gender, Driving Licence No and
   Pincode blank.
5. Note the time on a clock, then submit.

**Expect** the registration to save and a sticker to appear. Then:

- Confirm the public code on screen matches the code printed under the QR.
- Print. One page, one sticker, 50 × 40 mm, QR crisp with a clear quiet zone.
- Scan the printed sticker with the Point B device. It must decode first time.

The sticker must show no name, phone, email, licence, vehicle, location or
pincode. Look at it and confirm.

### The venue and the time nobody typed

Open Admin, export a backup, and read the record just written.

- `location` is `Richardson & Cruddas`.
- `testRideAt` is `2026-08-23T` followed by the clock time you noted at submit,
  to the minute, in Indian time. Not the time the form was opened, and not the
  device's calendar date if that differs.

Then register a second rider several minutes later and confirm the two records
carry different times. Finally use **Correct details** on the first record to fix
its email address, and confirm `testRideAt` is unchanged afterwards.

This is worth doing on a device whose own timezone is deliberately set to
something other than India: the stored time must not move.

### QR density

The event ID is encoded into every sticker, so it is kept short on purpose:
`ff-rc-2026-08-23` gives a 114-byte payload and a 45-module symbol, which is a
size Point B has already been tested against by hand. Spelling the venue out
inside the ID would give 139 bytes and 49 modules, a denser code on every label.

Nothing new to check here, then, beyond the usual: the first few printed stickers
must decode first time at Point B. If a future event lengthens the ID past about
ten more characters, re-run the physical scan test in
`docs/point-b-physical-test.md` before the print run.

### Speed

Time a full registration with a stopwatch, entering a phone number on the
tablet's own keyboard. If it is slower than the pre-campaign form, something in
the redesign is costing throughput and should be reported.

### Validation, without blocking the desk

- Submit an empty form: four errors (vehicle, name, email, phone). Not five: the
  venue is no longer asked for.
- Type a 9-digit phone: "Enter a valid 10-digit mobile number."
- Type a 4-digit pincode: "Pincode must be 6 digits."
- Type an unusual but real licence (`KA01 2020 0001234`, `DL-0420110149646`).
  Both must be accepted. A rejected real licence at a desk with a queue is worse
  than an odd-looking stored one.

### Correction

Open a saved registration, tap **Correct details**, change the vehicle and the
pincode, save.

**Expect** the public code, participant ID and record ID to be unchanged, the
revision to increase, and the other campaign answers to survive untouched. The
sticker does not need reprinting.

## 2. Point B: the questionnaire

Open `#/b`, start the scanner, scan a sticker.

- Four rating questions, each showing seven headlamps, in the campaign's wording.
- Tapping 5 lights lamps 1–5 and the value reads "5 / 7" as text, not colour
  alone.
- Two free-text questions below them.

Submit with a rating missing: four errors, nothing saved.

Answer all four and submit: the branded thank-you appears and says nothing about
delivery: the tablet is routinely offline and a message implying the response had
reached a server would be false for hours.

Then:

- Scan the same sticker again: the same-device duplicate refusal appears and the
  first response is unchanged.
- Enter a code by hand instead of scanning: the response saves with no
  participant ID, as it always has.
- Turn Wi-Fi off entirely and repeat the whole flow. Everything must work.

### A rider with no sticker and no code

Press **Continue without QR or code**. Confirm it is offered from the start
screen, the running scanner, the camera-error screen and manual entry: a rider
who never registered has nothing to scan and nothing to type, and nobody should
have to break the camera to reach this button.

Give a name, a phone number and an email address, answer all six questions,
submit.

- Blank fields are refused, with the same messages Point A gives for the same
  three fields. A nine-digit phone number is refused for the same reason.
- The saved record has `captureMethod: 'contact'` and the three respondent
  fields, and **no `publicCode` and no `participantId` at all**. Check in
  DevTools: the keys must be absent, not empty.
- No registration appears in the `registrations` store.
- Submitting the same name, phone and email a second time is **accepted**. There
  is no code to be a duplicate of, and one tablet must not decide that two
  humans are one.
- With Wi-Fi off, all of the above still works. This path makes no network
  request at any point, which is the property most worth checking because a
  lookup is the obvious thing to have added.

Make a save fail deliberately if you can (DevTools, throttle storage, or just
trust the automated test): every field and every answer must still be on screen
afterwards. A rider asked to retype their email address and six answers will
usually decline.

### Accessibility

With a keyboard attached, Tab through a rating question and press Enter. The
rating must be selectable without a pointer, and each lamp must announce as
"Rate N out of 7".

## 3. Offline cold start

### Preparing a device, in order

Do this on every tablet, on the venue's network or any other, **before** the
event. It takes about a minute per device and needs no developer tools.

1. Connect the device to the Internet.
2. Open the production app.
3. Open **Device Admin**.
4. If **Offline readiness** still says *Preparing* a few seconds after the page
   has loaded, reload the page once. The service worker installs on the first
   visit and takes control of the page on the next one; one reload is all that
   is needed, and this is normal browser behaviour rather than a fault.
5. Confirm it reads:

   ```
   Offline readiness   Ready for offline use
   ```

6. Only then test with Wi-Fi disabled.

Never clear site data, unregister the service worker, or delete Cache Storage or
IndexedDB on a device that has taken registrations. IndexedDB is where the
event's records live until they sync, and Chrome's **Clear site data** button
removes them along with the cache. Nothing in this preparation requires it.

### The test itself

Install the PWA, then put the tablet in aeroplane mode and cold-start it.

Point A and Point B must both open, render the brand marks, generate a QR and
save records. Nothing may hang waiting for a network.

## 4. Backup and restore

Take an encrypted backup from a device holding campaign registrations and
campaign responses. Verify the file, then restore it onto a second device.

**Expect** vehicle, colour, location, gender, test-ride time, licence and pincode
to survive exactly, along with every rating and both text answers. Restore a file
that also holds pre-campaign `feedback-v1` records and confirm it is accepted.

## 5. Sync and reporting

With the server reachable:

1. Sync from Point A and Point B.
2. Run reconciliation from `#/reporting`.
3. On the overview, confirm **Responses by questionnaire** lists
   `flying-flea-feedback-v1`, and that the campaign figures show a per-question
   average out of 7 with a 1–7 distribution.
4. If the event also holds `feedback-v1` records, confirm the two sets of figures
   are reported separately and no average mixes them.
5. Open a participant: the campaign fields appear, and **Driving licence
   (sensitive)** is shown here.
6. Go back to the participant list: the licence number must appear **nowhere** on
   it. Check the network response in DevTools too, not only the screen.
7. Open a campaign response: the six questions appear in the campaign's own
   words, not as `rotaryKnobUsage`.
8. On **Responses**, the Rating column reads `5 / 7` for a campaign response,
   never `None`. The scale is always shown: a bare `5` would be ambiguous
   between the two questionnaires this build reads.
9. Device Admin lists no "Not implemented yet" section. Reconciliation and
   central reporting both shipped.

### Direct responses

If any rider used **Continue without QR or code**, check these too:

10. On **Responses**, that row's Captured column reads **Contact details**, its
    Code column reads **No code** rather than being blank, and its Participant
    column shows the rider's own name rather than `None`.
11. Its status reads **Direct feedback**, not "No registration". They mean
    opposite things: one is the contact path working and the other is a sticker
    code that led nowhere.
12. Search by the rider's name, phone number or email. The response must be
    findable by each. Searching by a public code must still work exactly as
    before.
13. Open it: the rider's name, phone and email appear under **Details given by
    the rider**, with a note saying nothing was looked up.
14. **Needs review** must NOT list it. Confirm the count of *"Responses with a
    code that matched no registration"* did not go up.
15. On the overview, **Direct responses (no registration)** shows the count, and
    the coverage fraction above it is unchanged by them. Coverage measures the
    registration list, and these riders are not on it.
16. The campaign averages **include** them: a direct response is unambiguous, and
    excluding it would make the figures describe registered riders rather than
    riders.
17. If a rider gave contact details that match exactly one registration, the
    response reads **Matched**, matched by *"Phone and email (both matched one
    registration)"*.

## 6. Exports

Download the registrations CSV, the feedback CSV and the workbook.

- Registrations carry the seven campaign columns; a pre-campaign registration
  leaves them blank rather than defaulted.
- Feedback rows fill either the `feedback-v1` columns or the campaign columns,
  never both.
- Open both CSVs in Excel or Numbers. No cell may evaluate as a formula. Type
  `=cmd|'/c calc'!A0` into a free-text answer at Point B first if you want to see
  the neutralisation work.
- Feedback rows carry `respondent_name`, `respondent_phone` and
  `respondent_email` as the last three columns, populated only for a contact
  response. Confirm no earlier column moved: they were appended precisely so a
  script indexing by column number keeps working.
- In the workbook, every participant-derived cell is text.
- On **Participant Feedback**, a direct response is one row with **Direct
  feedback** as its status, the rider's own name, phone and email in the Name,
  Phone and Email columns, a blank Public Code, and every Point A-only column
  (vehicle, colour, licence, gender, pincode, ride time) blank. All six answers
  are present.
- A contact response that matched a registration shows the **registration's**
  name in the main columns and what the rider typed in the three
  **(as entered)** columns at the far right. The **Identity Source** column
  distinguishes the four cases: QR sticker, typed code, contact details matched
  to Point A, and contact details direct.
- The workbook's **Summary** sheet has three sections in order: event and
  reconciliation counts, **FLYING FLEA FEEDBACK** with the four questions in the
  campaign's own words and their averages out of 7, and **LEGACY FEEDBACK**.
  At a Flying Flea event the legacy section must say the questionnaire was not
  collected rather than print a block of zeros.
- **Metadata** lists `readableFormVersions` as `feedback-v1,
  flying-flea-feedback-v1`, so nobody reads the file as understanding only one.

## 7. Offline asset audit

```bash
pnpm build
grep -rho 'https\?://[a-z0-9.-]*' dist/assets/*.js dist/sw.js | sort | uniq -c
```

Every host must be an XML namespace, a documentation link inside a dependency, or
the sync API origin this build was configured with. A fonts host, an image CDN or
anything at `royalenfield.com` is a defect: the field application would then need
a network it will not have.

## What must be true at the end

- A rider can be registered, printed, scanned and surveyed with the tablet in
  aeroplane mode from start to finish.
- The printed sticker carries no campaign answer and no PII.
- A correction changes campaign fields and never identity.
- A backup restores every campaign field and answer onto a replacement device.
- Reporting shows the campaign's questions in the campaign's words, and its
  averages on the 1–7 scale only.
- The licence number is on the detail view and on no list.
- Nothing in `dist/` points at a font, image or script host.

## 8. Responsive pass, both stations

Layout is CSS, so no test proves it. Use Chrome DevTools device toolbar in
**Responsive** mode and type each width by hand; the height matters far less
than the width except where noted.

Before anything else, at every width, run this in the console and expect
`false`:

```js
document.documentElement.scrollWidth > document.documentElement.clientWidth
```

A `true` is a defect in the layout, not something to hide with `overflow-x`.

### What changes, and where

| Width | Personal details | Phone and pincode | Rating scale | Hero banner |
| --- | --- | --- | --- | --- |
| 320 to 430 | one column | stacked, full width | four then three | shortest |
| 480 to 700 | one column | stacked | seven across | growing |
| 768 to 1024 | two columns | side by side | seven across | growing |
| 1280 and up | two columns | side by side | seven across | full height |

The columns are decided by the space each component has, not by the window, so
a laptop window dragged narrow behaves exactly like the tablet of that width.

### 320 x 568, the smallest phone

Point A:

- the topbar wraps: marks on one line, the venue badge below, neither clipped
- the hero is short, its title is legible over the photograph, and the first
  field is reachable with one thumb scroll
- the four vehicle plates are one per row and each is comfortably tappable
- the motorcycle is whole: front wheel, mirror and tail all inside the frame
- switching to Storm Black does not move anything below it
- both colour buttons are full width and at least a finger tall
- the venue and date sit under the banner on one line, or wrap onto two, with
  neither clipped at the right edge
- every personal detail is one per row; the Gender select shows its native arrow
  inside the field, and the licence field is not cut
- the phone cluster is a full circle with ten slots, all readable, and the arc
  is round rather than an ellipse
- every keypad key can be hit without hitting its neighbour
- tapping the dial face opens the device keyboard
- the pincode cluster is below the phone one, six slots
- **Register & Print** is full width
- under Recent, the public code and time share a line and **Reprint** wraps
  below them; nothing is cut off at the right edge

Point B:

- the two start buttons stack, each full width, labels complete
- the camera preview fills the card width and is about four units wide to three
  tall; it does not grow taller than the screen
- **Enter code manually**: the input is full width and the code fits
- the participant code is fully visible on one line
- each rating question shows four lamps then three, in order, with the readout
  on its own line under them
- both text areas are full width, at least three lines tall, and can only be
  dragged taller, never wider
- **Submit Feedback** is full width; the success panel and **Next rider** fit
  without clipping

### 360 x 640 and 375 x 667

As above. Check specifically that the rating lamps have not become cramped and
that the hero title still sits on at most two lines.

### 390 x 844 and 414 x 896

- the vehicle plates may pair up; if they do, both are still easily tappable
- the colour buttons pair up; the swatch and label stay on one line

### 430 x 932

- the rating scale is still four then three at 430 and switches to seven across
  just above it; both arrangements keep 1 on the left and 7 on the right

### 768 x 1024, tablet portrait, the event device

This is the one to spend time on.

- personal details are two columns and every label reads on one line
- phone and pincode sit side by side, each dial about 330px, digits large
- the keypad keys are comfortable with a gloved fingertip
- the hero, the vehicle grid and the bike all use the width without stretching
- Point B: the rating scale is seven across with real spacing between lamps

### 820 x 1180

As 768. Confirm nothing has stretched: the form is still a readable column
rather than the full width of the tablet.

### 1024 x 768, tablet landscape

- the whole form is centred with even margins, not pinned left
- the hero is at full height and the first card is still visible under it

### 1024 x 1366

As 1024 x 768, with more of the form visible at once.

### 1280 x 800, 1366 x 768, 1440 x 900, 1920 x 1080

- the form stays centred at its reading width and does not keep growing
- the motorcycle stage stops growing and stays in proportion; the black card
  around it does not become a wide letterbox
- the two clusters are side by side and neither is stretched into an oval
- Central reporting (`#/reporting`) is the one screen that uses the extra
  width; its tables should not scroll horizontally at 1280 and up
