-- Offline Event Feedback: capture location on feedback, migration 009.
--
-- The September event runs in two cities on the same day, Bengaluru and
-- Hyderabad, under one event ID. A registration has carried a `location` since
-- migration 007; a response has not, because until now the venue was a property
-- of the build and there was only ever one of them.
--
-- That worked while every record in an event came from one address. It does not
-- work now, and the case that breaks it is the direct contact response: a rider
-- who never registered has no registration to inherit a city from, so if the
-- response does not record where it was captured, nothing afterwards can say
-- which of the two cities it came from. Not a report, not a query, not a person
-- looking at the row. The information is simply gone.
--
-- ## Historical rows are not touched
--
-- Not one UPDATE runs below. Every August response keeps a NULL location, and
-- NULL here means exactly one thing: this response was captured before the
-- field existed, so the location was never recorded.
--
-- It would be easy, and wrong, to backfill those rows with `Richardson &
-- Cruddas`. The August event did run at that address, so the value would even
-- be true. It would still be a value nobody captured, written into a column
-- whose whole purpose is to say what was captured, and after the write there
-- would be no way to tell an inferred venue from a recorded one. Reporting
-- shows these rows as blank instead, which is the honest answer and is a
-- distinction a reader can act on.
--
-- ## Safe to apply before the new application deployment
--
-- The column is nullable with no default, so every INSERT the currently
-- deployed code issues, none of which mentions it, keeps working unchanged.
-- Nothing here is required by the running build.
--
-- ## Re-runnable
--
-- `IF NOT EXISTS` on both statements, as every migration in this directory is.
-- The ledger in `migrate.ts` applies each file once in production, but the test
-- suites replay the whole directory into a scratch database that may already be
-- migrated, and a migration that only works on a virgin schema is one nobody
-- can safely re-run at the moment they most need to.

-- ---------------------------------------------------------------------------
-- Feedback: where the response was captured
-- ---------------------------------------------------------------------------

/*
 * TEXT, not an enum, and not a CHECK against the two cities.
 *
 * This table holds more than one event. An enum or a constraint naming today's
 * venues would have to be migrated every time the campaign moves, and until it
 * was, a perfectly valid response from a new city would be refused at ingest by
 * the database rather than by anything that could explain itself. The set of
 * acceptable cities is a client-side deployment decision, enforced where the
 * operator makes the choice (`src/config/eventLocations.ts`) and bounded on the
 * wire by MAX_LOCATION_LENGTH. What the column guarantees is only that the
 * value is text, which is all it can honestly guarantee across events.
 *
 * Note what this migration deliberately does NOT do: it does not go near
 * `feedback_identity_shape`. A location says where a desk was, not who a rider
 * is, so it is not part of any of the three identity shapes and the CHECK from
 * migration 008 is left exactly as it stands.
 */
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS location TEXT;

/*
 * The index reporting actually issues.
 *
 * Every location question is asked within one event: "how many responses in
 * Bengaluru", never "how many responses in Bengaluru across all events we have
 * ever run". So the event comes first and the city second, which is also the
 * order that lets the same index serve a plain event scan.
 *
 * Reconciliation does not use this index and does not group by location at all.
 * It reads one event's rows into memory and matches there, so that the matching
 * rule stays a pure function testable without a database.
 */
CREATE INDEX IF NOT EXISTS feedback_event_location_idx
  ON feedback (event_id, location);
