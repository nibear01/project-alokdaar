-- 006_waitlist.sql — waitlist positions for programs (FR-RS-08)

CREATE TABLE IF NOT EXISTS waitlist (
  id             BIGSERIAL PRIMARY KEY,
  program_id     BIGINT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  position       INT NOT NULL CHECK (position >= 1),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (program_id, position),
  UNIQUE (application_id)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_program_position
  ON waitlist (program_id, position);
