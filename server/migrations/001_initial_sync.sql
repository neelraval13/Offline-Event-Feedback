-- Offline Event Feedback: central synchronisation schema, migration 001.
--
-- Safe to apply to an empty database. Applied deliberately via
-- `pnpm server:migrate`, never as a side effect of starting the server: a
-- process restart must not be able to alter a schema holding an event's data.
--
-- Identity comes from the device that captured the record. There is no
-- server-generated record ID, because `record_id`, `participant_id` and
-- `public_code` are already printed on a sticker a participant is wearing.

CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Enrolled devices
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sync_devices (
  event_id            TEXT        NOT NULL,
  uploader_device_id  UUID        NOT NULL,
  -- SHA-256 of the issued token. The plaintext is never stored.
  token_hash          TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,

  PRIMARY KEY (event_id, uploader_device_id)
);

-- ---------------------------------------------------------------------------
-- Registrations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS registrations (
  record_id                UUID        PRIMARY KEY,

  participant_id           UUID        NOT NULL,
  public_code              TEXT        NOT NULL,

  event_id                 TEXT        NOT NULL,
  event_day                DATE        NOT NULL,
  station_id               TEXT        NOT NULL,
  -- The device that CAPTURED this record. After a Phase 5 recovery this
  -- differs from the device that uploaded it, and that is correct.
  source_device_id         UUID        NOT NULL,

  name                     TEXT        NOT NULL,
  phone                    TEXT        NOT NULL,
  email                    TEXT        NOT NULL,

  created_at               TIMESTAMPTZ NOT NULL,
  updated_at               TIMESTAMPTZ NOT NULL,
  revision                 INTEGER     NOT NULL CHECK (revision >= 1),

  first_received_at        TIMESTAMPTZ NOT NULL,
  last_received_at         TIMESTAMPTZ NOT NULL,
  last_uploader_device_id  UUID        NOT NULL
);

-- One participant, one code, one row, enforced by the database rather than by
-- application logic, because two devices can upload at the same instant.
CREATE UNIQUE INDEX IF NOT EXISTS registrations_participant_key
  ON registrations (event_id, participant_id);

CREATE UNIQUE INDEX IF NOT EXISTS registrations_public_code_key
  ON registrations (event_id, public_code);

CREATE INDEX IF NOT EXISTS registrations_event_idx
  ON registrations (event_id, event_day);

-- ---------------------------------------------------------------------------
-- Feedback
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feedback (
  record_id                UUID        PRIMARY KEY,

  -- Absent for a manually typed code: the printed code carries no participant
  -- ID and Point B cannot look one up. Joining them is reconciliation's job.
  participant_id           UUID,
  public_code              TEXT        NOT NULL,
  capture_method           TEXT        NOT NULL
                                       CHECK (capture_method IN ('qr', 'manual')),

  event_id                 TEXT        NOT NULL,
  event_day                DATE        NOT NULL,
  station_id               TEXT        NOT NULL,
  source_device_id         UUID        NOT NULL,

  form_version             TEXT        NOT NULL,
  answers                  JSONB       NOT NULL,

  created_at               TIMESTAMPTZ NOT NULL,
  updated_at               TIMESTAMPTZ NOT NULL,
  revision                 INTEGER     NOT NULL CHECK (revision >= 1),

  first_received_at        TIMESTAMPTZ NOT NULL,
  last_received_at         TIMESTAMPTZ NOT NULL,
  last_uploader_device_id  UUID        NOT NULL
);

-- Deliberately NOT unique on public_code: two Point B terminals may each hold
-- a response for one participant, and both must survive for reconciliation to
-- see them. There is also no foreign key to registrations, feedback may
-- legitimately arrive first.
CREATE INDEX IF NOT EXISTS feedback_public_code_idx
  ON feedback (event_id, public_code);

CREATE INDEX IF NOT EXISTS feedback_participant_idx
  ON feedback (event_id, participant_id);

-- ---------------------------------------------------------------------------
-- Ingest audit
-- ---------------------------------------------------------------------------

-- Counts only. No participant data, and nothing that could identify one.
CREATE TABLE IF NOT EXISTS sync_batches (
  batch_id                UUID        PRIMARY KEY,
  event_id                TEXT        NOT NULL,
  uploader_device_id      UUID        NOT NULL,
  received_at             TIMESTAMPTZ NOT NULL,
  accepted_count          INTEGER     NOT NULL DEFAULT 0,
  already_current_count   INTEGER     NOT NULL DEFAULT 0,
  server_newer_count      INTEGER     NOT NULL DEFAULT 0,
  conflict_count          INTEGER     NOT NULL DEFAULT 0,
  invalid_count           INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sync_batches_event_idx
  ON sync_batches (event_id, received_at DESC);
