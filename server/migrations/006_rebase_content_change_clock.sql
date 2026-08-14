-- Offline Event Feedback — rebase the content-change clock, migration 006.
--
-- Every `content_changed_at` value written before the ingest fix came from the
-- API process's clock. Reporting compares that column against
-- `reconciliation_runs.completed_at`, which Postgres writes with its own clock.
-- Those two numbers were never in the same clock domain, and no amount of
-- inspection can now sort the accurate values from the skewed ones: a stamp of
-- 14:03:11 looks identical whether the API host was correct or forty seconds
-- fast.
--
-- Migration 005 dealt with the half of that problem which is visibly impossible —
-- stamps in the future. This deals with the half that is invisible.
--
-- ## The failure being closed
--
-- An API clock running BEHIND the database understates a content change: a
-- revision accepted after a run can carry a timestamp from before it. Freshness
-- then reports `dataChangedSinceRun = false` — the run says it still describes
-- the event when it does not, and an operator exports a report that is quietly
-- missing a correction. A warning that fails to appear is worse than one that
-- appears too often, because nothing about the screen invites a second look.
--
-- ## What this migration does, and what it does not claim
--
--   UPDATE ... SET content_changed_at = now()
--
-- It does **not** claim the content changed at migration time. Nobody edited
-- anything. The column is a freshness marker, not a history of edits, and this
-- rewrites the marker to a value that is meaningful in the only clock domain
-- reporting can compare against.
--
-- The consequence is deliberate and is the point: every reconciliation run that
-- completed before this migration will report itself stale exactly once. The
-- operator runs reconciliation, its `completed_at` is later than these rebased
-- values, and from that moment both sides of every freshness comparison come from
-- the Postgres clock and ordinary semantics resume. One conservative false alarm,
-- once, in exchange for closing a failure mode that is silent by construction.
--
-- After that first run, an idempotent re-delivery still does not make anything
-- stale: `touchRegistration` / `touchFeedback` do not write this column at all.
--
-- ## What is not touched
--
-- `first_received_at`, `last_received_at`, `revision`, `updated_at`, and every
-- participant-supplied field are left exactly as they are. This migration changes
-- one derived marker and no evidence: the record of what devices captured, when
-- the server first heard it, and when a device last spoke is unchanged.
--
-- Rows written from here on are stamped by Postgres at the moment content is
-- accepted, so this is a one-off boundary and not a recurring correction.

UPDATE registrations
   SET content_changed_at = now()
 WHERE content_changed_at IS NOT NULL;

UPDATE feedback
   SET content_changed_at = now()
 WHERE content_changed_at IS NOT NULL;
