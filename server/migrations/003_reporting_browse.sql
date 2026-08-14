-- Offline Event Feedback — reporting browse indexes, migration 003.
--
-- Two indexes, no schema change. Reporting reads only: it adds no table, no
-- column and no constraint, because it draws its conclusions entirely from what
-- Phase 6 ingested and Phase 7 reconciled.
--
-- Both indexes exist for one query shape — the keyset page that every browse
-- screen and every export ordering uses:
--
--   WHERE event_id = $1
--     AND (created_at, record_id) > ($cursor_time, $cursor_id)
--   ORDER BY created_at, record_id
--   LIMIT $page
--
-- Measured on 10,000 registrations (see server/reporting/scale.test.ts), for a
-- page taken from the middle of the list:
--
--   without an index   Seq Scan + top-N heapsort   1.81 ms   (scans 10,000 rows)
--   with the index     Index Only Scan             0.10 ms   (reads 51 rows)
--
-- 1.8 ms is survivable; the shape of it is not. Without the index the cost of
-- every page is proportional to the whole event, so an organiser paging through
-- a 50,000-participant list pays for 50,000 rows two hundred times over. With
-- it, a page costs a page.
--
-- The column order is what makes this work: `event_id` first because it is
-- always an equality filter, then exactly the sort key, so Postgres can satisfy
-- the ordering from the index and stop at LIMIT instead of sorting the event.
--
-- `record_id` is included as the tiebreaker rather than left to the heap: two
-- records captured in the same millisecond on two devices are entirely normal,
-- and without a total order a keyset cursor can skip or repeat a row.

-- ---------------------------------------------------------------------------
-- Participant browser, and the ordering of the registrations export
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS registrations_event_browse_idx
  ON registrations (event_id, created_at, record_id);

-- ---------------------------------------------------------------------------
-- Response browser, and the ordering of the feedback export
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS feedback_event_browse_idx
  ON feedback (event_id, created_at, record_id);

-- Nothing is indexed for search. `name ILIKE '%term%'` cannot use a B-tree at
-- all, and the alternative — a trigram index — would mean an extension, a
-- rebuild cost on every ingest, and a fuzzy-matching behaviour this phase
-- deliberately does not have. At event scale the search is a filtered scan of
-- one event and measures in single-digit milliseconds; if that ever stops being
-- true, the fix is a decision about search behaviour, not a quiet index.
