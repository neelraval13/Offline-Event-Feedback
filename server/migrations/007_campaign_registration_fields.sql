-- Offline Event Feedback: campaign registration fields, migration 007.
--
-- The Flying Flea test-ride campaign captures seven things at Point A that the
-- generic registration form never did. They land here as explicit, nullable
-- columns.
--
-- ## Why columns and not a JSON blob
--
-- A `metadata JSONB` column would have absorbed all seven without a migration,
-- and would have been the wrong trade. These are first-class reporting fields:
-- an operator filters participants by vehicle, an export has a `location`
-- column, and an analyst asks how many riders chose Storm Black. Every one of
-- those becomes a JSON path expression with no type, no constraint and no index,
-- and a typo in a key silently returns nothing rather than failing.
--
-- The set is also stable. It is a campaign's registration form, not
-- user-defined data: it changes when a campaign changes, which is exactly when a
-- migration is appropriate.
--
-- `answers` on the feedback table stays JSONB, and that remains right for the
-- opposite reason: the questionnaire genuinely varies per campaign, is read as a
-- whole, and is already versioned by `form_version`.
--
-- ## Nullable, and why nothing is backfilled
--
-- Every column is nullable and no default is invented. A registration captured
-- before this campaign has no vehicle, and writing 'Vehicle 1' into it would
-- fabricate a fact about a real person's visit. NULL means "not captured", which
-- is the truth, and reporting renders it as blank rather than as an answer.
--
-- Existing rows are untouched. This migration adds columns and nothing else.

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS vehicle            TEXT,
  ADD COLUMN IF NOT EXISTS interested_colour  TEXT,
  ADD COLUMN IF NOT EXISTS location           TEXT,
  ADD COLUMN IF NOT EXISTS gender             TEXT,
  -- Wall-clock local time as the campaign's own control produces it
  -- (`YYYY-MM-DDTHH:mm`), deliberately NOT timestamptz: it is a slot at a venue,
  -- and storing it as an instant would shift a 10:00 booking in every export
  -- read outside the venue's timezone.
  ADD COLUMN IF NOT EXISTS test_ride_at       TEXT,
  -- Sensitive. Reporting shows it on the privileged detail view only, never in
  -- the participant list. See docs/flying-flea-campaign.md.
  ADD COLUMN IF NOT EXISTS driving_licence    TEXT,
  ADD COLUMN IF NOT EXISTS pincode            TEXT;

-- Vehicle and location are the two an operator filters and groups by; the rest
-- are read as part of a row that has already been located.
CREATE INDEX IF NOT EXISTS registrations_event_vehicle_idx
  ON registrations (event_id, vehicle);

CREATE INDEX IF NOT EXISTS registrations_event_location_idx
  ON registrations (event_id, location);
