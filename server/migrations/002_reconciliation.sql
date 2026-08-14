-- Offline Event Feedback — reconciliation results, migration 002.
--
-- Reconciliation is DERIVED data. Everything here is a conclusion about the
-- rows in `registrations` and `feedback`; nothing here replaces them, and the
-- engine never writes to them. Those rows are the evidence of what the devices
-- actually captured, and an engine that rewrote them would destroy the only
-- account of how a conclusion was reached.
--
-- Each run is a snapshot of central data at one point in time. Runs are kept,
-- never overwritten: a record classified `feedback_without_registration` on
-- Monday and `matched` on Tuesday produces two correct snapshots, not a
-- correction.
--
-- No participant name, phone number, email address or feedback answer is copied
-- into any table below. Only record IDs, statuses and counts.

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  run_id                              UUID        PRIMARY KEY,
  event_id                            TEXT        NOT NULL,
  -- The rules that produced this run. Changing the rules later must not
  -- silently alter the meaning of runs already recorded.
  engine_version                      TEXT        NOT NULL,

  started_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL until the run finishes. An incomplete run is never presented as a
  -- result; see the latest-completed view below.
  completed_at                        TIMESTAMPTZ,

  -- Source counts, from the snapshot the run read.
  registration_count                  INTEGER     NOT NULL DEFAULT 0,
  feedback_count                      INTEGER     NOT NULL DEFAULT 0,

  -- Result counts.
  matched_registrations               INTEGER     NOT NULL DEFAULT 0,
  registrations_without_feedback      INTEGER     NOT NULL DEFAULT 0,
  registrations_with_multiple_feedback INTEGER    NOT NULL DEFAULT 0,
  matched_feedback                    INTEGER     NOT NULL DEFAULT 0,
  feedback_without_registration       INTEGER     NOT NULL DEFAULT 0,
  feedback_identity_conflicts         INTEGER     NOT NULL DEFAULT 0,
  feedback_in_multiple_groups         INTEGER     NOT NULL DEFAULT 0,
  duplicate_registration_candidate_count INTEGER  NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS reconciliation_runs_event_idx
  ON reconciliation_runs (event_id, completed_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- Per-registration conclusions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reconciliation_registration_results (
  run_id                 UUID    NOT NULL
                                 REFERENCES reconciliation_runs (run_id)
                                 ON DELETE CASCADE,
  registration_record_id UUID    NOT NULL
                                 REFERENCES registrations (record_id),
  status                 TEXT    NOT NULL
                                 CHECK (status IN ('matched',
                                                   'without_feedback',
                                                   'multiple_feedback')),
  -- Identity-conflict feedback is deliberately not counted here: a QR whose
  -- two identifiers disagree is not a valid link to anything.
  valid_feedback_count   INTEGER NOT NULL DEFAULT 0 CHECK (valid_feedback_count >= 0),

  PRIMARY KEY (run_id, registration_record_id)
);

CREATE INDEX IF NOT EXISTS reconciliation_registration_results_status_idx
  ON reconciliation_registration_results (run_id, status);

-- ---------------------------------------------------------------------------
-- Per-feedback conclusions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reconciliation_feedback_results (
  run_id                 UUID NOT NULL
                              REFERENCES reconciliation_runs (run_id)
                              ON DELETE CASCADE,
  feedback_record_id     UUID NOT NULL REFERENCES feedback (record_id),
  -- NULL when the feedback resolved to no registration, or when its QR
  -- identifiers disagreed and therefore resolved to neither.
  registration_record_id UUID          REFERENCES registrations (record_id),
  status                 TEXT NOT NULL
                              CHECK (status IN ('matched',
                                                'without_registration',
                                                'identity_conflict',
                                                'multiple_feedback')),
  match_method           TEXT          CHECK (match_method IN ('qr_identity',
                                                              'manual_public_code')),

  PRIMARY KEY (run_id, feedback_record_id)
);

CREATE INDEX IF NOT EXISTS reconciliation_feedback_results_status_idx
  ON reconciliation_feedback_results (run_id, status);

CREATE INDEX IF NOT EXISTS reconciliation_feedback_results_registration_idx
  ON reconciliation_feedback_results (run_id, registration_record_id);

-- ---------------------------------------------------------------------------
-- Possible duplicate registrations
-- ---------------------------------------------------------------------------

-- A candidate means "these MAY be the same person", never "these ARE".
-- Families share phone numbers and couples share email accounts, so nothing
-- here is ever merged or deleted automatically. Only record references are
-- stored: the contact values that produced the match stay in `registrations`.
CREATE TABLE IF NOT EXISTS reconciliation_duplicate_registration_candidates (
  run_id                       UUID NOT NULL
                                    REFERENCES reconciliation_runs (run_id)
                                    ON DELETE CASCADE,
  -- Canonically the lexicographically smaller ID, so a pair is stored once.
  left_registration_record_id  UUID NOT NULL REFERENCES registrations (record_id),
  right_registration_record_id UUID NOT NULL REFERENCES registrations (record_id),
  match_basis                  TEXT NOT NULL
                                    CHECK (match_basis IN ('phone_and_email',
                                                           'phone_only',
                                                           'email_only')),

  PRIMARY KEY (run_id, left_registration_record_id, right_registration_record_id),
  CHECK (left_registration_record_id < right_registration_record_id)
);

CREATE INDEX IF NOT EXISTS reconciliation_duplicate_candidates_basis_idx
  ON reconciliation_duplicate_registration_candidates (run_id, match_basis);

-- ---------------------------------------------------------------------------
-- Latest completed run per event
-- ---------------------------------------------------------------------------

-- Phase 8 reads from here. Incomplete runs are excluded by construction: a run
-- that failed halfway is not a result.
CREATE OR REPLACE VIEW reconciliation_latest_runs AS
SELECT DISTINCT ON (event_id) *
FROM reconciliation_runs
WHERE completed_at IS NOT NULL
ORDER BY event_id, completed_at DESC, started_at DESC;
