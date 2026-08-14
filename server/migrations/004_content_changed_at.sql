-- Offline Event Feedback — content-change timestamps, migration 004.
--
-- One column per canonical table, recording the server time at which the server
-- last accepted **new content** for that row.
--
-- ## Why `last_received_at` could not answer this
--
-- Reporting has to tell an operator whether a reconciliation run is still a fair
-- description of the event. The obvious signal was `last_received_at`, and it is
-- the wrong one: Phase 6 deliberately touches it on an `already_current` result,
-- because knowing when a device last re-sent a record is genuinely useful for
-- diagnosing a sync problem.
--
-- The consequence is that an offline tablet reconnecting and re-uploading a batch
-- it had already delivered — the single most ordinary thing that happens in this
-- system — moved `last_received_at` on every record in it, and reporting called
-- a perfectly current run stale. An operator who is told the data has changed
-- when it has not either reconciles pointlessly or, worse, stops believing the
-- warning by the time it is true.
--
-- `last_received_at` keeps its meaning exactly. This column answers the other
-- question, and only the two writes that actually change content set it:
--
--   INSERT of a new record                  -> set
--   revision-conditional UPDATE (accepted)  -> set
--   idempotent touch (already_current)      -> NOT set
--
-- Combined with run membership — a record the run never classified is a record
-- that arrived afterwards — this gives reporting both halves of staleness:
-- something new arrived, or something existing was revised.
--
-- ## Backfill
--
-- Existing rows are backfilled from `last_received_at`, which is the latest time
-- content *could* have changed for them. That may overstate a row that was only
-- ever re-sent, which errs towards reporting a stale run rather than hiding one.
-- A false "reconcile again" costs a click; a false "this run is current" costs
-- the trust in the number.

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS content_changed_at TIMESTAMPTZ;

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS content_changed_at TIMESTAMPTZ;

UPDATE registrations
   SET content_changed_at = COALESCE(last_received_at, first_received_at)
 WHERE content_changed_at IS NULL;

UPDATE feedback
   SET content_changed_at = COALESCE(last_received_at, first_received_at)
 WHERE content_changed_at IS NULL;

-- Freshness reads one aggregate per event, so the event is the leading column.
CREATE INDEX IF NOT EXISTS registrations_content_changed_idx
  ON registrations (event_id, content_changed_at);

CREATE INDEX IF NOT EXISTS feedback_content_changed_idx
  ON feedback (event_id, content_changed_at);
