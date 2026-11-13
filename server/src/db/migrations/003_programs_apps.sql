-- 003_programs_apps.sql — applications, status timeline, programs extras (FR-M1-02, FR-RS)

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS seats_available INT,
  ADD COLUMN IF NOT EXISTS location_district TEXT,
  ADD COLUMN IF NOT EXISTS education_level TEXT;

-- seats_available mirrors seats until approvals consume them
UPDATE programs SET seats_available = seats WHERE seats_available IS NULL;

CREATE OR REPLACE FUNCTION sync_seats_available() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.seats_available IS NULL THEN
    NEW.seats_available := NEW.seats;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_programs_seats ON programs;
CREATE TRIGGER trg_programs_seats
  BEFORE INSERT OR UPDATE OF seats ON programs
  FOR EACH ROW EXECUTE FUNCTION sync_seats_available();

-- --- applications (FR-DA submit side is Rafi's; schema shared) ---

CREATE TYPE application_status AS ENUM (
  'submitted', 'under_review', 'shortlisted',
  'approved', 'waitlisted', 'rejected', 'withdrawn'
);

CREATE TABLE applications (
  id               BIGSERIAL PRIMARY KEY,
  program_id       BIGINT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  student_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  statement        TEXT,
  status           application_status NOT NULL DEFAULT 'submitted',
  score            NUMERIC(8, 4),
  rank             INT,
  score_breakdown  JSONB NOT NULL DEFAULT '{}'::jsonb,
  duplicate_aid    BOOLEAN NOT NULL DEFAULT FALSE,
  decision_remarks TEXT,
  force_reason     TEXT,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (program_id, student_id)
);

CREATE INDEX idx_applications_program_status ON applications (program_id, status);
CREATE INDEX idx_applications_program_rank ON applications (program_id, rank);
CREATE INDEX idx_applications_student ON applications (student_id);
CREATE INDEX idx_applications_approved_student
  ON applications (student_id) WHERE status = 'approved';

-- --- application_events — status timeline (FR-DA-06, audit) ---

CREATE TABLE application_events (
  id             BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status    application_status,
  to_status      application_status NOT NULL,
  actor_id       BIGINT REFERENCES users(id),
  actor_role     TEXT,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_application_events_app
  ON application_events (application_id, created_at);
