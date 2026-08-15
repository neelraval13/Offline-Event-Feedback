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

### Accessibility

With a keyboard attached, Tab through a rating question and press Enter. The
rating must be selectable without a pointer, and each lamp must announce as
"Rate N out of 7".

## 3. Offline cold start

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

## 6. Exports

Download the registrations CSV, the feedback CSV and the workbook.

- Registrations carry the seven campaign columns; a pre-campaign registration
  leaves them blank rather than defaulted.
- Feedback rows fill either the `feedback-v1` columns or the campaign columns,
  never both.
- Open both CSVs in Excel or Numbers. No cell may evaluate as a formula. Type
  `=cmd|'/c calc'!A0` into a free-text answer at Point B first if you want to see
  the neutralisation work.
- In the workbook, every participant-derived cell is text.

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
