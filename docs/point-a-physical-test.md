# Point A: physical test guide

A manual pass to run once real label stock and a real printer are available.
The automated suite covers the data path; this covers the parts only paper can
answer, physical size, print contrast, and whether a phone camera can actually
read a 26 mm QR code off a sticker on someone's sleeve.

**Scope warning.** This exercises **offline data operations**, not offline app
startup. There is no service worker yet, so the page itself must be loaded while
the dev server or static host is reachable. Do not use this guide to claim the
app boots offline; see step 2.

Budget about 30 minutes, plus a printer.

## What you need

- the app running (`pnpm dev`, or `pnpm build && pnpm preview`)
- a label printer and 50 mm × 40 mm label stock
- a ruler with millimetre markings
- an ordinary phone, no special scanning app
- a second browser profile or device if you want to check code namespacing

## Steps

### 1. Open Point A

Navigate to `#/a`. Confirm the Name field already has focus; staff should be
able to start typing without touching the mouse.

### 2. Disconnect the network

Turn off Wi-Fi, or use DevTools → Network → Offline.

**Leave the tab open.** Do not reload yet. Without a service worker a reload
will fail to fetch the app, and that failure is expected at this phase; it is
not what this test is measuring. Everything from here on must work with no
connectivity.

### 3. Register a test participant

Use obviously fake details, for example:

```
Name            Test Participant
Phone number    +44 20 7946 0958
Email address   test@example.invalid
```

Tab between fields, press Enter from Email. Confirm:

- the button shows a saving state and cannot be pressed twice
- "Registration saved" appears with a public code like `A1-B8EFD9-00001-X`
- the sticker preview appears with a QR and the same code beneath it
- focus has moved to **Print sticker**

### 4. Confirm the local save

Open DevTools → Application → IndexedDB → `offline-event-feedback` →
`registrations`. Confirm the record is there with `syncStatus: "pending"` and
that its `publicCode` matches what is on screen.

This is the invariant in action: the sticker only exists because that row does.

### 5. Print

Press Enter (or click **Print sticker**). In the print dialog:

- set the paper size to your label stock if the driver does not pick it up
- set margins to none/minimum
- disable any "fit to page" or "shrink to fit" scaling; **this is the setting
  most likely to ruin the test**, because scaling changes the physical QR size

Print one label.

### 6. Count the pages

**Before measuring anything, count the pages.** Print to PDF and check the page
count, or read it off the print dialog's preview.

There must be **exactly one page**. One Print or Reprint invocation produces one
50 mm × 40 mm page containing one sticker.

Earlier QA found six identical pages here: the application was being hidden in
a way that left it occupying layout, and the label was positioned fixed, so it
repeated on every page the app's height generated. If more than one page appears
again, that is a regression in the print CSS or DOM structure, not a driver
quirk.

### 7. Measure the label

With the ruler, check against the design:

| Element | Expected |
| --- | --- |
| Sticker area | 50 mm × 40 mm |
| QR symbol | ~26 mm × 26 mm including its quiet zone |
| Quiet zone | ~2.1 mm of white on all four sides of the QR |
| Public code | one line, ~3.2 mm tall, not touching any edge |

If everything is proportionally small, scaling was left on in step 5. Reprint
before concluding anything.

### 8. Inspect QR quality

Look closely, ideally with a loupe or a phone macro shot:

- module edges crisp, not grey or feathered
- **solid filled squares, not thin horizontal lines**: earlier QA found a
  symbol printing as hairlines because dark modules were stroked rather than
  filled. They are filled rectangles now, and this is the check that catches a
  regression
- no white gaps inside dark areas from missing print head dots
- the three corner finder patterns solid and square
- true black, not dark grey

Matrix size varies per participant: the payload encodes to 41×41 for about 14%
of participants and 45×45 for the other 86%, depending on the random participant
UUID. At 26 mm that is roughly 0.53 mm and 0.48 mm per module: about 4 printer
dots at 203 dpi. **Register at least four or five participants and print
several**, so both sizes are exercised; a defect that only affects one of the
two is exactly what earlier QA hit. Blurred or bleeding modules mean the printer
is the limit, and density or a higher-resolution printer is the fix.

### 9. Refresh the browser

Reload the tab. (Reconnect the network first if needed; again, this is a
Phase 2 limitation, not a data problem.)

Confirm **Recent registrations on this device** lists the participant's public
code. The record survived; the screen state did not need to.

### 10. Reprint the same sticker

Click **Reprint** next to that code. Confirm:

- the sticker preview returns with the same public code
- printing again produces a label indistinguishable from the first

### 11. Compare the two labels

Put both stickers side by side. The public codes must be **character for
character identical**, and the QR symbols must look identical module for module.

A different code means a second registration was created: a serious bug. Check
`registrations` in DevTools: there must still be exactly one row.

### 12. Scan with a phone

Open the ordinary camera app and point it at the QR. It should recognise it
within a second or two at a comfortable reading distance.

Try it also at an angle, in dim light, and with the sticker curved over a sleeve
or bottle; that is where it will actually live.

This is a sanity check that the symbol is well formed. It is **not** a test of
Point B, which does not exist yet.

### 13. Confirm the QR carries no PII

Read the decoded text the camera shows. It must be exactly this shape:

```json
{"v":1,"event":"ff-rc-2026-08-23","participant":"<uuid>","code":"A1-B8EFD9-00001-X"}
```

Four fields. **No name, no phone number, no email address.** Anyone who picks up
a lost sticker learns nothing about the person who was wearing it.

If any personal detail appears here, stop and treat it as a privacy defect.

## Optional checks

**Correcting details.** Register someone, click **Correct details**, change the
email, save. Confirm in DevTools that `revision` incremented, `syncStatus`
returned to `pending`, and `participantId`, `publicCode` and `createdAt` are
unchanged. No reprint is needed: the sticker never carried the email.

**Two devices at one station.** Open the app in a second browser profile (a
different profile, not a second tab: profiles have separate IndexedDB) and
register someone there. The two devices' codes must differ in the issuer
segment: `A1-B8EFD9-00001-X` versus `A1-6091A1-00001-C`. Same station, same
sequence number, different sticker.

**Several stickers in a row.** Register five participants and print each. Every
print must be one page, and every QR must be solidly filled regardless of
whether it came out 41×41 or 45×45.

**Printer removed mid-run.** Turn the printer off, register someone, press
Print, cancel the dialog. Confirm the registration is still saved and Reprint
still works. The browser cannot tell whether paper came out, which is exactly
why Reprint is always available.

## Recording results

Note the printer model, driver settings, measured dimensions, and whether the
phone scanned first time. If the QR is unreliable at 26 mm on the printer we end
up buying, the levers are, in order of preference: print a larger QR, raise
printer density, drop to error-correction level L to reduce module count, or
shorten the payload. All are Phase 3 decisions; do not change the identity or
checksum format to chase a printing problem.
