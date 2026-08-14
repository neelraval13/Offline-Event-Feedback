# Flying Flea campaign — manual QA

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

## 1. Point A — a rider, end to end

Open `#/a`.

1. Tap a vehicle plate. It should read at arm's length and show clearly which is
   selected.
2. Confirm the colour selector starts on **Flea Green** and switches to **Storm
   Black** cleanly. It must never show both or neither.
3. Fill Name, Email ID, Location, Phone Number. Leave Gender, Test Ride Date &
   Time, Driving Licence No and Pincode blank.
4. Submit.

**Expect** the registration to save and a sticker to appear. Then:

- Confirm the public code on screen matches the code printed under the QR.
- Print. One page, one sticker, 50 × 40 mm, QR crisp with a clear quiet zone.
- Scan the printed sticker with the Point B device. It must decode first time.

The sticker must show no name, phone, email, licence, vehicle, location or
pincode. Look at it and confirm.

### Speed

Time a full registration with a stopwatch, entering a phone number on the
tablet's own keyboard. If it is slower than the pre-campaign form, something in
the redesign is costing throughput and should be reported.

### Validation, without blocking the desk

- Submit an empty form: five errors — vehicle, name, email, location, phone.
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

## 2. Point B — the questionnaire

Open `#/b`, start the scanner, scan a sticker.

- Four rating questions, each showing seven headlamps, in the campaign's wording.
- Tapping 5 lights lamps 1–5 and the value reads "5 / 7" as text, not colour
  alone.
- Two free-text questions below them.

Submit with a rating missing: four errors, nothing saved.

Answer all four and submit: the branded thank-you appears and says nothing about
delivery — the tablet is routinely offline and a message implying the response had
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
