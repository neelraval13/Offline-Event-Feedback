# Point B: physical test guide

A manual pass using **real stickers printed by Point A**. The automated suite
drives the scanner through a fake, so everything about actual optics, whether a
phone or tablet camera reads a 26 mm QR off a curved sticker under venue
lighting, can only be answered here.

Run [the Point A guide](point-a-physical-test.md) first and keep the stickers it
produces. You need at least five, from several different participants.

## Origin and camera access: read first

Browsers only grant camera access in a **secure context**: `https://`, or
`localhost`. On a plain-HTTP LAN address such as `http://192.168.1.20:5173`,
`navigator.mediaDevices` is simply undefined and the camera can never start. The
app reports this as *"The browser only allows camera access over a secure (https)
address"* rather than pretending the camera is broken.

So test Point B on **`localhost` on the device itself**, or over HTTPS. A
remotely accessed plain-HTTP LAN origin is **not our deployment target** and a
camera failure there is expected, not a defect. Choosing the real deployment
(HTTPS with a certificate, or a packaged offline shell) is a later decision.

Manual code entry works on any origin, which is the point of it.

## Scope

This exercises **offline data operations**, not offline app startup. There is no
service worker yet, so the page must be loaded while the host is reachable. Do
not use this guide to claim the app boots offline.

Budget about 30 minutes.

## What you need

- the app running (`pnpm dev`, or `pnpm build && pnpm preview`) on localhost
- at least five real stickers from Point A, from different participants
- a device with a camera
- one sticker or QR that is *not* from this event (any other QR will do)

## Steps

### 1. Open Point B

Navigate to `#/b`. Confirm you see **Start scanner** and **Enter code
manually**, and that the camera has *not* started on its own; nothing should
request permission until staff asks.

### 2. Start the camera

Press **Start scanner** and grant permission. Confirm the preview appears and,
on a device with both, that the **rear** camera is used.

### 3. Scan a Point A sticker

Hold a sticker in front of the camera. Confirm:

- it is recognised within a second or two
- the feedback form appears
- the **Participant** code shown matches the code printed on that sticker,
  character for character
- **no name, phone number or email appears anywhere on screen**. Point B has
  never seen them and must never show them

Keep holding the sticker in view for several seconds. The form must appear
**once**. A second form, or a flicker of re-opening, is a latch defect.

### 4. Fill in the four questions

```
Overall rating              1 2 3 4 5
How was your experience?    Very Poor / Poor / Okay / Good / Excellent
Would you recommend…?       Yes / No
Any comments?               (optional)
```

Try pressing **Submit feedback** with nothing chosen first: three validation
messages must appear and nothing may be saved.

Then answer all three required questions and submit.

### 5. Confirm the saved record

Open DevTools → Application → IndexedDB → `offline-event-feedback` →
`feedback`. Find the new record and confirm:

| Field | Expected |
| --- | --- |
| `kind` | `feedback` |
| `captureMethod` | `qr` |
| `participantId` | the UUID from the sticker's QR |
| `publicCode` | the printed code |
| `stationId` | `B1` |
| `deviceId` | this device's UUID |
| `formVersion` | `feedback-v1` |
| `syncStatus` | `pending` |
| `answers` | `overall_rating`, `experience`, `recommend`, and `comments` only if typed |

### 6. Confirm no PII in the record

Read the whole record. There must be **no name, no phone number, no email**, and
no field that could carry them. If a comment was typed, it is the participant's
own words and is expected; nothing else about the person may be present.

### 7. Next participant

Press **Next participant**. Confirm:

- the scanner resumes **without asking for camera permission again**
- the previous answers are gone
- the counter at the foot of the screen has gone up by one

### 8. Scan several more stickers

Work through at least four more, from different participants.

This matters more than it looks: the QR matrix size varies per participant,
roughly 14% of payloads are 41×41 and 86% are 45×45, so scanning only one
sticker tests only one of the two symbol sizes. Confirm both scan comfortably.

Note any sticker that takes more than a couple of seconds, and at what distance
and angle.

### 9. Manual fallback

Press **Enter code manually** and type a code from a sticker you have *not* yet
used. Try it in a deliberately sloppy form: lower case, spaces instead of
dashes:

```
a1 b8efd9 00007 k
```

Confirm it is accepted and normalised to the canonical printed form.

Complete and submit the feedback, then check the new record: `captureMethod`
must be `manual` and there must be **no `participantId` field at all**. That is
correct: the printed code does not contain one and Point B cannot look one up.
Reconciliation resolves it centrally later.

### 10. Invalid code rejection

In manual entry, type a code with one character changed, for example alter the
last character:

```
A1-B8EFD9-00007-Z
```

Confirm it is rejected with a short message and that nothing is saved. This is
the check character doing its job.

Also try a code from the wrong station (`B1-…`): it must be refused as not
issued by the registration desk.

### 11. Invalid QR rejection

Point the camera at any unrelated QR: a poster, a Wi-Fi QR, a URL.

Confirm:

- a short message appears: *"This QR is not a valid participant sticker for this
  event."*
- no feedback form opens
- **scanning continues**: no need to restart anything
- no stack trace, no raw JSON, no technical detail

Then scan a real sticker to confirm the scanner is still working.

### 12. Same-device duplicate

Scan a sticker you have **already** submitted feedback for.

Confirm:

- **Feedback already recorded on this device** appears
- the participant code is shown
- there is no feedback form and no way to submit a second response
- in DevTools, the original record is unchanged and no second record exists

### 13. Camera denied

Reset the site's camera permission (Chrome: the icon in the address bar → Site
settings → Camera → Reset), reload, press **Start scanner**, and **deny**.

Confirm:

- **Camera unavailable** appears with a plain-language explanation
- **Try camera again** and **Enter code manually** are both offered
- manual entry still completes a full feedback submission

Point B must remain fully operational on a device with no working camera.

### 14. Refresh and reopen

Reload the page. Confirm the counter still shows the number of responses saved
on this device, and that DevTools still holds every record.

Navigate to `#/a` and back to `#/b`. Confirm the camera indicator light goes out
when you leave Point B: a scanner left running after navigation is a resource
leak.

### 15. Offline

With Point B loaded, turn off Wi-Fi and repeat a full scan-and-submit. Nothing
about normal operation may depend on the network.

## Recording results

Note the device and browser, whether the rear camera was selected, typical
recognition time, any sticker that scanned poorly and its printed size, and
whether both QR matrix sizes behaved the same. If recognition is unreliable,
the levers are the same as at Point A: larger printed QR, better print density,
and not changes to the identity or checksum format.
