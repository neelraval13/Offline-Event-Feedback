# The Flying Flea test-ride campaign

Phase 9 adapts the offline event application to one campaign. Nothing about
identity, persistence, synchronisation, reconciliation or reporting changed
shape; what changed is what the forms ask, what a record carries, and what the
application looks like.

## Source of truth

Everything visual and every question comes from the supplied campaign package,
`flyingflea-testride.zip`, and specifically from its active deployment,
`google-hosted/Index.html`. Where this document and that file disagree, the file
is right.

| What | Taken from |
| --- | --- |
| Palette, radii, type intent | `google-hosted/Index.html`, the `:root` block |
| Parachute mark | `brand/parachute-white.svg` |
| FF C6 wordmark | `brand/ffc6-web.svg` |
| Headlamp rating icon | `LAMP_PATH` in `google-hosted/Index.html` |
| Registration fields and their required-ness | the form's own submit handler |
| Questionnaire wording | the form's markup, verbatim |
| Vehicles, colours, venue, thank-you | the `CFG` defaults in the same file |

All three marks are inlined as React components in `src/components/brand/marks/`
rather than fetched as files. The supplied page inlines them too, and for the
same reason: this application has to cold-start with no network, and an inlined
mark cannot fail to load.

### What was deliberately not carried over

- **The two bike photographs.** Both are hot-linked from Royal Enfield's CDN.
  The package's own README says so. A field application that needed them would
  show two broken images at a venue with no Wi-Fi, so the colour selector uses
  labelled swatches instead. An approved local asset would let the photographs
  come back; there is currently none.
- **Anton and Inter.** The design specifies both, loaded from Google Fonts. The
  package ships no font files, so nothing was downloaded or embedded; that is a
  licensing decision, not a technical one. `--ff-font-display` and
  `--ff-font-text` name the families first, so a machine that already has them
  renders as designed, and fall back to system faces of similar proportion
  otherwise. Supplying the licensed files is a one-line change to the tokens.
- **The circular dial keypads** for phone and pincode. See "Fidelity versus
  throughput" below.

## Design tokens

All in `src/styles/tokens.css`, and nowhere else. `src/styles.css` then defines
the application's existing generic variables in terms of them, which is what
rebrands Admin and Reporting without touching their markup.

| Token | Value | Role |
| --- | --- | --- |
| `--ff-bg` | `#0b0d0e` | Application background |
| `--ff-surface` | `#101213` | Cards |
| `--ff-surface-elevated` | `#17191b` | Raised panels |
| `--ff-field` | `#14171a` | Input wells |
| `--ff-border` | `rgba(255,255,255,0.1)` | Hairlines |
| `--ff-text` | `#f2f3f4` | Primary text |
| `--ff-muted` | `#9ba1a6` | Secondary text |
| `--ff-accent` | `#d3ff00` | **Display** lime: eyebrows, headings, lit lamps |
| `--ff-interactive` | `#3ac6be` | **Operable** teal: buttons, focus, selection |
| `--ff-error` | `#ff5a5a` | Errors |
| `--ff-radius-card` | `22px` | Cards |
| `--ff-radius-control` | `12px` | Inputs |

The two accents are not interchangeable, and this is the detail most easily got
wrong. In the supplied design the lime is a display colour and the teal is what
you can operate. A lime button would read as decoration.

## Campaign configuration

Two modules, split by what outlives what.

`shared/campaign/flyingFlea.ts` owns the questionnaire itself: the form version,
the stable answer keys, the exact six prompts, the 1–7 scale, and the closed sets
(colours, genders) plus field bounds that both the wire schema and the backup
validator enforce. The server imports it too (`server/reporting/campaign.ts` is
a re-export), so a report cannot quote a prompt the tablet never showed. The
wording used to be written out twice, and two copies of a question is one
question that will eventually disagree with itself, invisibly.

`src/features/campaign/flying-flea/config.ts` owns deployment and presentation:
vehicles at this venue, which venue that is, swatch colours, hero copy. All of
it can change without changing the meaning of a single stored answer. Neither
module contains persistence or validation logic.

The supplied deployment reads these from a Google Sheet so the campaign team can
edit them without a code change. This application has no Sheet and no network at
the desk, so it compiles in the same defaults that page falls back to.

## Registration fields

Captured at Point A, in the campaign's own labels.

| Field | Required | Stored as | Notes |
| --- | --- | --- | --- |
| Select Vehicle No | Yes | `vehicle` | From `FLYING_FLEA_CAMPAIGN.vehicles` |
| Interested in Color? | Always answered | `interestedColour` | Single-select; the supplied toggle cannot express two |
| Name | Yes | `name` | Pre-existing field |
| Email ID | Yes | `email` | Pre-existing field |
| Gender | No | `gender` | Male / Female / Others |
| Driving Licence No | No | `drivingLicence` | **Sensitive**; no format imposed |
| Phone Number | Yes | `phone` | 10-digit Indian mobile, the campaign's own rule |
| Pincode | No | `pincode` | Six digits when given |

Required-ness is read from the supplied form's submit handler. Nothing was added
to that list: an event desk with a queue is the worst place to discover a newly
mandatory field.

### The two fields nobody types

`location` and `testRideAt` are still on every record, under the same keys and in
the same shapes. They are no longer questions.

| Field | Where the value comes from |
| --- | --- |
| `location` | `FLYING_FLEA_CAMPAIGN.lockedLocation`. One venue, fixed at build time |
| `testRideAt` | `EVENT_CONFIG.eventDay` plus the venue clock at the moment of submit |

Both are attached by `src/features/campaign/flying-flea/eventStamp.ts`, on the
new-registration path only. The venue and the event date are shown instead as
static metadata under the hero banner, at Point A and at Point B, by `EventMeta`.

Three properties of that are worth stating, because each one is a defect if it
slips:

- **The time is read at submit.** Not at mount, not when the draft is created,
  not when "Next rider" clears the desk. A form opened at 14:10 and submitted at
  14:13 records 14:13.
- **The date comes from configuration, never from the device calendar.** A tablet
  with a wrong date, or a test run in a different month, still stamps the event
  day.
- **A correction never restamps.** Fixing a misspelt email at 16:10 leaves a
  15:42 ride at 15:42. Corrections go through their own path, which carries the
  form's values through untouched.

The clock is read through `Asia/Kolkata` explicitly (`src/config/eventTime.ts`),
not through the device's own timezone: a tablet restored from a backup taken
abroad would otherwise write a time nobody was at the venue, and the stored value
carries no zone to reveal it.

`testRideAt` is stored as the local wall-clock string, never converted to UTC. It
is a slot at a venue; shifting it by a timezone would move a 15:42 ride to 10:12
in an export read by the people who run the venue.

### Mutable versus immutable

| Immutable | Mutable |
| --- | --- |
| `recordId`, `participantId`, `publicCode` | `name`, `phone`, `email` |
| `eventId`, `eventDay`, `stationId`, `deviceId` | every campaign field above |
| `createdAt` | |

The immutable set is what the printed sticker in a rider's hand refers to. The
mutable set is everything a human typed at a desk, so a correction can reach it;
a correction is a new revision of the same record, never a new participant. The
server enforces the same split (`server/sync/ingest.ts`).

### Correcting a registration

Which correction screen an operator gets is decided by one predicate,
`needsLegacyCorrection` in
`src/features/campaign/flying-flea/campaignRecord.ts`.

- **A campaign registration** (one carrying a vehicle, colour or location) is
  corrected through the campaign form, with every answer carried back into it so
  fixing one field cannot blank the rest.
- **A pre-campaign registration** is corrected through the generic
  name/phone/email form. Opening the campaign form on one would demand a vehicle
  and a venue and default the colour, so an operator fixing a typo in an email
  address would save a bike, a colour and a location that this rider was never
  asked about. Fabricating data is worse than a plainer screen.

Optional campaign fields are **clearable**. A correction distinguishes three
states: absent (unchanged), `null` (cleared), or a value. With only
`undefined` available, "leave it alone" and "delete it" are the same input and a
rider who asked for their pincode to be removed keeps it. A cleared field is
removed from the record rather than stored as an empty string, and the central
column becomes NULL on the next sync.

## The questionnaire

Form version: **`flying-flea-feedback-v1`**. `feedback-v1` is untouched and every
reader branches on the version.

| # | Question, verbatim | Answer key | Type |
| --- | --- | --- | --- |
| 1 | How was your test ride experience of Flying Flea motorcycle? | `testRideExperience` | 1–7 |
| 2 | How do you rate usage of the rotary knob for changing modes? | `rotaryKnobUsage` | 1–7 |
| 3 | How do you rate the ride experience in different ride modes? | `rideModesExperience` | 1–7 |
| 4 | How would you rate your overall experience? | `overallExperienceRating` | 1–7 |
| 5 | Which top 3 features did you like in the motorcycle? | `topThreeFeatures` | text |
| 6 | How was your overall experience of the Flying Flea motorcycle? | `overallExperienceComments` | text |

Keys are named for what the question asks, never for its position. Reordering the
form must not silently re-point an answer at a different question.

**Ratings** are integers 1–7, validated as such on the device, on the wire and in
analytics. All four are required; the two free-text answers are not: a rider who
has just handed back a helmet is not held at a tablet for a paragraph. Blank text
is stored as an absent field rather than an empty string, so "wrote nothing" and
"typed a space" do not become different data.

**Text limit**: 2,000 characters (`MAX_CAMPAIGN_TEXT_LENGTH`). The supplied form
sets none. This is a storage bound so a stuck key cannot produce a record too
large to sync; the visible question is unchanged.

## Three ways to identify a response

Point B started with two, both of which read a sticker Point A issued. The third
exists because riders turn up without one: they never registered, or the sticker
is in a jacket pocket somewhere, or it went through a puddle.

| `captureMethod` | identity it carries | never carries |
| --- | --- | --- |
| `qr` | `participantId` + `publicCode` | respondent details |
| `manual` | `publicCode` | `participantId`, respondent details |
| `contact` | `respondentName` + `respondentPhone` + `respondentEmail` | `participantId`, `publicCode` |

### What is deliberately not done

**No fabricated identity.** A contact response gets no invented public code and
no invented participant ID. A generated code would be indistinguishable from a
printed one at every layer downstream and would be joined to whichever
registration happened to hold it, silently, by a query with every right to trust
the column. The fields are **absent**, not empty: an empty-string code joins
against every other empty-string code the first time somebody writes a careless
query.

**No registration created.** A rider who only completed Point B did only
complete Point B. Inventing a registration would put a participant in the event
who never registered, carrying a code that was never printed and is on nobody's
sticker, and every count downstream would be wrong in a way nothing could
detect, because the fabrication would look exactly like the real thing.

**No lookup.** Point B makes zero network reads on this path. It does not ask
whether the rider registered, because that question has no answer at a desk with
the wifi off, and asking it would make the one path designed for the rider who
has nothing depend on the one thing a venue cannot guarantee.

### The rules the three shapes obey

Enforced in three independent places, deliberately: the wire schema
(`shared/sync/protocol.ts`), the backup validator (`src/lib/backup/validate.ts`)
and the database itself (`feedback_identity_shape`, migration 008). The first
two protect the paths we know about; the third protects the table from a future
migration, a manual correction typed into psql at an event, or a bug in a build
nobody has written yet. A redundant CHECK costs nothing; one hybrid row costs a
response silently attributed to a stranger.

### Validation reuses Point A's rules

Name, phone and email are checked with the same functions Point A uses,
imported rather than restated. If the two desks accepted different phone
formats, the same rider typing the same number at both would produce values that
normalise differently and never match, and the failure would be invisible from
either screen.

### How a contact response is attributed

Centrally, after sync, by reconciliation, and only on the **normalised phone and
the normalised email together**, matching **exactly one** registration in the
event.

- Not the name. Two riders called Rahul Sharma at one event is a Tuesday.
- Not the phone alone. Families share phone numbers.
- Not the email alone. Couples share email accounts.
- Not "the best" of several. Two registrations with that exact pair means the
  event genuinely cannot say which rider this is, and it is recorded as an
  identity conflict rather than resolved by choosing.

Matching nothing is the ordinary outcome for a rider who never registered. It is
recorded as **`standalone`**, shown as **Direct feedback**, and it is not an
anomaly: it does not appear under Needs Review, it counts towards the campaign
averages, and it is deliberately distinct from `without_registration`, which
means a sticker code that resolved to nothing and does need somebody to look.

Coverage keeps counting registrations only. A direct response has none, so it
moves neither half of that fraction and is reported beside it. Folding it into
the numerator could report coverage above 100% at an event where the contact
desk was busy, which is the kind of number that makes an organiser stop trusting
the whole report.

## Backwards compatibility

- The device stores the questionnaire and its answers as one discriminated value
  (`FeedbackQuestionnairePayload`), so a record declaring one questionnaire while
  carrying another's answers cannot be constructed. The runtime validators on the
  wire and in the backup file are unchanged and still authoritative: the type
  stops our own code writing a bad pair, not a tampered file.
- The server reads `form_version` from the column and refuses a version it does
  not know, rather than assuming `feedback-v1`. Assuming it made an identical
  re-delivery of a campaign response compare as a change, which ingest correctly
  called a conflict, for a record nobody had touched.
- Records captured in Phases 0–8 have no campaign fields. Every campaign field is
  optional at every persistence boundary (IndexedDB, the wire schema, the
  central table), and null means "not captured", never a default.
- The IndexedDB schema is **not** versioned up. Adding optional fields to a
  record needs no new `version()` block and no index change; a bump would carry
  upgrade risk for installed devices in exchange for nothing.
- The sync protocol stays at version 1. The registration schema gained optional
  fields, the feedback schema became a version-tagged union, and later gained a
  third `captureMethod` with three optional respondent fields. Every one of
  those is additive, so a device on an older build still uploads successfully.
- Contact identity added no IndexedDB version either. IndexedDB indexes are
  sparse by construction, so a record with no `publicCode` property is simply
  not in that index, exactly as a manual-entry record has never been in the
  `participantId` index. Nothing on the device queries a response by respondent
  details, so there is nothing for a new index to serve, and an upgrade
  transaction is a moment a database holding an event's only copy of some
  records can fail.
- `feedback-v1` responses keep their meaning exactly. Reporting computes their
  figures separately and never averages a 1–5 rating together with a 1–7 one.
- A restore file may hold both questionnaires; the validator branches on version.

## Sync protocol v1: the rollout contract

`SYNC_PROTOCOL_VERSION` is still **1**, and that is a decision rather than an
oversight. The changes were additive: optional registration fields, and a second
`formVersion` with its own answer schema. Bumping the version would have forced
every device to be updated before any could sync (mid-campaign, at a venue)
and would have bought nothing in either direction.

What that buys, and what it costs, in both directions:

### Supported: old client → Phase 9 server

A tablet still running a pre-campaign build uploads registrations without campaign
fields and `feedback-v1` responses. Both are accepted exactly as before; the new
columns stay NULL, which is the truth about what was captured. Verified by
`protocol v1 across mixed builds` in `server/tests/api.test.ts`, including a
single batch carrying records from both builds.

### Supported: Phase 9 client → Phase 9 server

Full campaign data preserved end to end: every registration field into its own
column, campaign responses stored under their own `form_version` with their
answers intact, and an identical re-delivery recognised as `already_current`
rather than fought as a conflict. Verified against a real Postgres in
`server/tests/ingestPostgres.test.ts`.

### NOT supported: Phase 9 client → pre-Phase 9 server

**Do not do this.** An older server does not know
`flying-flea-feedback-v1`; its schema rejects the record outright, the device
marks it in error, and the response stays on the tablet. Campaign registration
fields would be rejected as unknown keys for the same reason.

A version bump would not have helped: the older server would refuse the batch on
the version instead of the field, and the data would be just as stuck. This is a
deployment ordering rule, not something a number can enforce.

### Contact identity keeps the same contract

The third capture method is additive in exactly the same way, so the protocol
stayed at 1 and the supported direction is unchanged:

- **Old client, new server.** A tablet that has been offline all day, running
  the previous build, with unsynced responses on it, uploads them unchanged.
  Every one is a `qr` or `manual` record with a `publicCode`, which is still a
  valid shape. Verified by `protocol compatibility` in
  `server/tests/wireIdentity.test.ts`.
- **New client, old server.** Not supported, for the same reason as above: the
  older server's enum has no `contact` member and would reject the record. A
  version bump would not have helped, only changed which line refused it.

Migration 008 is safe to apply **before** the new application is deployed, which
is the order below. Nothing in it is required by the running code: dropping a
NOT NULL and widening a CHECK cannot break a writer that was already satisfying
the stricter rule, and the new columns are nullable with no default, so the
existing INSERT statements continue to work unchanged. Proved against a schema
built through migration 007 and populated with real qr and manual rows, in
`server/tests/migration008.test.ts`.

### Deployment gate

1. Deploy the **server** and run `pnpm server:migrate` first.
2. Only then update the field devices to the new application.
3. A device must be on the new build **before** it captures or restores any
   record that the older build cannot represent: a Flying Flea campaign
   response, or a contact-identity response. A pre-campaign build cannot
   represent the questionnaire and a pre-contact build cannot represent the
   identity, and restoring such a backup onto one will fail validation rather
   than silently drop the record.

## Fidelity versus throughput

The supplied design renders phone and pincode as circular dial keypads styled
after the C6's instrument cluster. They are the most striking thing in the
reference and were not carried over.

Point A is staff-operated, several hundred times a day, with a rider waiting. A
rendered keypad means ten taps on a small target instead of a number typed on the
tablet's own keyboard, with no paste and no autofill. The fields are `inputMode`
numeric inputs, which raise the same keypad the dial imitates.

The plate and swatch motifs *were* kept, because they are faster than the
alternatives: staff read a plate off the bike that just came back, and a swatch is
quicker to confirm than a word in a dropdown.

## Reporting and analytics

Reporting reads both questionnaires and keeps them apart.

- `analytics` (`feedback-v1` only): average 1–5 rating, experience counts,
  recommend percentage.
- `campaignAnalytics` (`flying-flea-feedback-v1` only): per-question average on
  the 1–7 scale, per-question 1–7 distribution, and how many riders answered each
  free-text question.
- `responsesByFormVersion`: how many matched responses each questionnaire
  contributed, including versions this build cannot read.
- `unreadableResponses`: matched responses whose questionnaire has no figures
  here. They are still listed, still exported, and still readable individually.

The campaign has no recommend question, so no recommend percentage is reported
for it. A null next to the campaign figures would read as a result rather than as
an absence.

Both sets use the Phase 8 rule unchanged: only responses a reconciliation run
classified `matched`. Coverage is unchanged: registrations with at least one
valid response, over registrations.

### The licence number

`drivingLicence` is returned by the participant **detail** endpoint and is absent
from the participant **list**. Reporting is privileged, so a reviewer who has
opened one rider's record may see it, labelled "Driving licence (sensitive)". A
list answers no question that needs it, and one screen holding every rider's
licence number is a different exposure from one row holding one.

## Exports

Registrations CSV/XLSX gained `vehicle`, `interested_colour`, `location`,
`gender`, `test_ride_at`, `driving_licence`, `pincode`.

Feedback CSV/XLSX keeps its `feedback-v1` columns and adds
`test_ride_experience_rating`, `rotary_knob_rating`, `ride_modes_rating`,
`overall_experience_rating`, `top_three_features`,
`overall_experience_comments`. Each questionnaire fills only its own columns, so
a 1–7 rating can never land in a column an analyst reads as 1–5.

Everything Phase 8 guaranteed still holds: run membership, no winner chosen for a
participant with several responses, formula-injection neutralisation on both new
free-text columns, PII-free filenames, and XLSX cells written as strings.

## Offline asset policy

The field application must fetch nothing at runtime except the sync and reporting
API it is configured with. That means:

- no CDN fonts, stylesheets or scripts
- no remote images, including the campaign's bike photographs
- brand marks inlined, not linked
- every emitted chunk precached, verified by `scripts/verify-pwa-build.mjs`

The audit is repeatable: build, then grep `dist/` for `http://` and `https://`.
Everything that appears should be an XML namespace, a documentation URL in a
dependency, or the configured API origin.
