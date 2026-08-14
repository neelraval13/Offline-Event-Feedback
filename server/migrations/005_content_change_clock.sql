-- Offline Event Feedback — content-change clock correction, migration 005.
--
-- Migration 004 introduced `content_changed_at`, and the ingest writes filled it
-- from `receivedAt` — a timestamp produced by the API process. Reporting compares
-- it against `reconciliation_runs.completed_at`, which Postgres writes with its
-- own clock. Two clocks, one comparison.
--
-- The writes now use `now()` so both sides come from the database. This migration
-- deals with the rows already written under the old rule.
--
-- ## Why any correction is needed at all
--
-- Skew in one direction is self-healing and skew in the other is not.
--
-- If the API clock ran BEHIND the database, an existing value is stamped earlier
-- than the truth. That understates staleness only until the operator runs
-- reconciliation again — the new run's `completed_at` is later than every one of
-- those values, and from then on the comparison is correct. Nothing to fix.
--
-- If the API clock ran AHEAD, a value can sit in the future relative to the
-- database. That does not self-heal: every subsequent run completes *before* the
-- stamp, so freshness reports the run stale, the operator reconciles, and it
-- reports stale again. The warning that is meant to mean "reconcile" becomes a
-- warning that reconciling does not clear — which is how a real staleness warning
-- stops being read.
--
-- ## What this does
--
-- Caps future values at the database's own clock, and touches nothing else.
--
-- A row whose stamp is already in the past is left exactly as it is. It may be a
-- few seconds off, but it is a plausible historical time and it orders correctly
-- against any run completed after it; rewriting it would replace a small
-- inaccuracy with a fabricated one, and would move rows that were never wrong.
--
-- Capping to `now()` is the honest upper bound: the content demonstrably existed
-- by the time this migration runs, so `now()` is a true statement about it, and
-- it errs towards reporting a run stale rather than hiding a change.
--
-- Rows written from here on are stamped by Postgres, so this is a one-off.

UPDATE registrations
   SET content_changed_at = now()
 WHERE content_changed_at > now();

UPDATE feedback
   SET content_changed_at = now()
 WHERE content_changed_at > now();
