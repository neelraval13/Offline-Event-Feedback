-- Offline Event Feedback: contact identity for feedback, migration 008.
--
-- Point B gained a third way to identify a response. A rider with no sticker
-- and no printed code gives their name, phone number and email address, and
-- those become the identity of their response.
--
-- ## What this migration refuses to do
--
-- It does not invent a participant ID, does not mint a public code, and does
-- not create a registration row. A rider who only completed Point B did only
-- complete Point B, and a fabricated registration would put a person in this
-- event's participant list who never registered, with a code that was never
-- printed and never on anybody's sticker. Every count downstream would then be
-- wrong in a way nothing could detect, because the fabrication would look
-- exactly like the real thing.
--
-- Instead `public_code` becomes nullable and three nullable respondent columns
-- appear. NULL means "this response never had one", which is the truth.
--
-- ## Safe to apply before the new application deployment
--
-- Nothing here is required by the currently deployed code. Dropping a NOT NULL
-- and widening a CHECK cannot break a writer that was already satisfying the
-- stricter rule, and the new columns are nullable with no default, so existing
-- INSERT statements that never mention them continue to work unchanged.
--
-- Existing rows are not rewritten. Not one UPDATE runs below.

-- ---------------------------------------------------------------------------
-- Feedback: the third identity shape
-- ---------------------------------------------------------------------------

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS respondent_name  TEXT,
  ADD COLUMN IF NOT EXISTS respondent_phone TEXT,
  ADD COLUMN IF NOT EXISTS respondent_email TEXT;

-- A contact capture has no sticker, so it has no code to record.
ALTER TABLE feedback ALTER COLUMN public_code DROP NOT NULL;

/*
 * A legible failure instead of a raw constraint violation.
 *
 * The constraint below validates every existing row. If some row does not
 * conform, the ALTER fails with a message naming the constraint and one
 * offending row, which tells an operator very little at the moment they most
 * need to know what they are looking at. This says how many, and rolls the
 * whole migration back either way.
 *
 * It should never fire: the wire contract has enforced this shape on every
 * record since the first deployment. That is exactly why a failure here would
 * be worth understanding rather than working around.
 *
 * The predicate is deliberately the same one the constraint uses, all three
 * shapes, rather than only the two the previous schema could produce. Written
 * the narrower way it was correct on a first application and wrong on a second:
 * re-running this file against a database that had since collected legitimate
 * contact rows would report them as corruption. A migration nobody can safely
 * re-run is one that fails at the worst moment, and the columns referenced
 * below already exist because the ALTER above ran in this same transaction.
 */
DO $$
DECLARE
  offending INTEGER;
BEGIN
  SELECT count(*) INTO offending
  FROM feedback
  WHERE NOT (
    (capture_method = 'qr'
       AND participant_id IS NOT NULL AND public_code IS NOT NULL
       AND respondent_name IS NULL AND respondent_phone IS NULL
       AND respondent_email IS NULL)
    OR
    (capture_method = 'manual'
       AND participant_id IS NULL AND public_code IS NOT NULL
       AND respondent_name IS NULL AND respondent_phone IS NULL
       AND respondent_email IS NULL)
    OR
    (capture_method = 'contact'
       AND participant_id IS NULL AND public_code IS NULL
       AND respondent_name IS NOT NULL AND respondent_phone IS NOT NULL
       AND respondent_email IS NOT NULL)
  );

  IF offending > 0 THEN
    RAISE EXCEPTION
      'migration 008: % existing feedback row(s) do not satisfy the identity shape this migration enforces. Every row must be one of: a qr capture with both a participant_id and a public_code; a manual capture with a public_code and no participant_id; a contact capture with all three respondent fields and neither identifier. No row may mix them. Inspect them with: SELECT record_id, capture_method, (participant_id IS NULL) AS no_participant, (public_code IS NULL) AS no_code, (respondent_email IS NULL) AS no_respondent FROM feedback; nothing has been changed.',
      offending;
  END IF;
END $$;

/*
 * The identity shape, enforced by the database.
 *
 * Application validation already enforces this twice, on the wire and in the
 * backup validator, and this is deliberately a third copy. Those two protect
 * the paths we know about; this one protects the table itself, from a future
 * migration, a manual correction typed into psql at an event, or a bug in a
 * build nobody has written yet. The cost of a redundant CHECK is nothing; the
 * cost of one hybrid row is a response silently joined to a stranger's
 * registration by a query that had every right to trust the column.
 *
 * The dangerous shapes it forbids, specifically:
 *   contact + public_code       would join to whoever holds that code
 *   contact + participant_id    the same, through the other identifier
 *   qr without participant_id   half a scan, presented as a whole one
 *   manual + participant_id     an identifier the printed code cannot yield
 *   contact missing any of the three respondent fields, which is a response
 *     from nobody: unmatchable by reconciliation and unreachable by a human
 */
/*
 * Dropped before it is added, because Postgres has no
 * `ADD CONSTRAINT IF NOT EXISTS` and every migration in this directory is
 * re-runnable. The ledger in `migrate.ts` means production applies each file
 * once, but the test suites replay the whole directory into a scratch database
 * that may already be migrated, and a migration that only works on a virgin
 * schema is one nobody can safely re-run when they need to most.
 */
ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_capture_method_check;
ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_identity_shape;

ALTER TABLE feedback ADD CONSTRAINT feedback_identity_shape CHECK (
  (
    capture_method = 'qr'
    AND participant_id   IS NOT NULL
    AND public_code      IS NOT NULL
    AND respondent_name  IS NULL
    AND respondent_phone IS NULL
    AND respondent_email IS NULL
  )
  OR (
    capture_method = 'manual'
    AND participant_id   IS NULL
    AND public_code      IS NOT NULL
    AND respondent_name  IS NULL
    AND respondent_phone IS NULL
    AND respondent_email IS NULL
  )
  OR (
    capture_method = 'contact'
    AND participant_id   IS NULL
    AND public_code      IS NULL
    AND respondent_name  IS NOT NULL
    AND respondent_phone IS NOT NULL
    AND respondent_email IS NOT NULL
  )
);

-- Reporting searches responses by respondent details, the way it already
-- searches registrations by name, phone and email. Reconciliation does NOT use
-- this index: it reads one event's rows into memory and matches there, so that
-- the matching rule is a pure function that can be tested exhaustively without
-- a database.
CREATE INDEX IF NOT EXISTS feedback_respondent_idx
  ON feedback (event_id, respondent_phone, respondent_email);

-- ---------------------------------------------------------------------------
-- Reconciliation: the standalone status and the contact match method
-- ---------------------------------------------------------------------------

/*
 * `standalone` is not an anomaly and must never be presented as one.
 *
 * It means: this response's contact details match no registration in the event,
 * and that is a complete, valid answer from a real rider who did not go through
 * Point A. Distinguishing it from `without_registration` is the whole point.
 * That status means a sticker resolved to nothing, which is a genuine problem
 * worth a human's attention, usually a mistyped code or a Point A device that
 * has not synced. Folding the two together would either bury real problems in a
 * pile of perfectly good direct responses, or put valid feedback in front of an
 * organiser under a heading that says something went wrong.
 */
ALTER TABLE reconciliation_feedback_results
  DROP CONSTRAINT IF EXISTS reconciliation_feedback_results_status_check;

ALTER TABLE reconciliation_feedback_results
  ADD CONSTRAINT reconciliation_feedback_results_status_check
  CHECK (status IN ('matched',
                    'without_registration',
                    'identity_conflict',
                    'multiple_feedback',
                    'standalone'));

-- How a contact response reached its registration: normalised phone AND email
-- both matching exactly one registration. Recorded so that a matched row can
-- always say why it matched, and so the three methods stay distinguishable in
-- an export a year from now.
ALTER TABLE reconciliation_feedback_results
  DROP CONSTRAINT IF EXISTS reconciliation_feedback_results_match_method_check;

ALTER TABLE reconciliation_feedback_results
  ADD CONSTRAINT reconciliation_feedback_results_match_method_check
  CHECK (match_method IN ('qr_identity',
                          'manual_public_code',
                          'contact_identity'));

-- Durable and auditable, like every other count on a run. Defaulted to 0 so
-- historical runs remain valid rows: they were produced by an engine that could
-- not classify anything as standalone, and 0 is the true count for them.
ALTER TABLE reconciliation_runs
  ADD COLUMN IF NOT EXISTS standalone_feedback INTEGER NOT NULL DEFAULT 0;

/*
 * The view is recreated because it was defined as `SELECT *`.
 *
 * Postgres expands the star at creation time and freezes the column list, so
 * without this the new column exists on the table and is invisible through the
 * view. `getLatestCompletedRun` reads the view, so every latest-run lookup
 * would have reported a standalone count of NaN while the table held the right
 * number, and nothing would have failed loudly.
 */
CREATE OR REPLACE VIEW reconciliation_latest_runs AS
SELECT DISTINCT ON (event_id) *
FROM reconciliation_runs
WHERE completed_at IS NOT NULL
ORDER BY event_id, completed_at DESC, started_at DESC;
