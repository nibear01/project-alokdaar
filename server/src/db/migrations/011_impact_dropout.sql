-- 011_impact_dropout.sql — student profiles (district), dropout risk, impact base
-- (M6.1 FR-IM-01, M6.11 FR-M3-05; student_profiles also unblocks Rafi's M2.9)

-- Where a student lives — the impact map aggregates on this; falls back to
-- programs.location_district when a student has no profile row yet.
CREATE TABLE student_profiles (
  user_id         BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  district        TEXT,
  upazila         TEXT,
  education_level TEXT,
  institution     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_student_profiles_district ON student_profiles (district);

CREATE TYPE dropout_level AS ENUM ('low', 'medium', 'high');
CREATE TYPE dropout_case_status AS ENUM ('open', 'monitoring', 'resolved');

-- One case per student, re-scored in place by the recompute endpoint.
CREATE TABLE dropout_cases (
  id          BIGSERIAL PRIMARY KEY,
  student_id  BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  level       dropout_level NOT NULL,
  score       NUMERIC(5, 2) NOT NULL CHECK (score >= 0 AND score <= 100),
  factors     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ factor, value, points }]
  status      dropout_case_status NOT NULL DEFAULT 'open',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dropout_cases_level ON dropout_cases (level, status);

CREATE TABLE dropout_notes (
  id         BIGSERIAL PRIMARY KEY,
  case_id    BIGINT NOT NULL REFERENCES dropout_cases(id) ON DELETE CASCADE,
  author_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dropout_notes_case ON dropout_notes (case_id, created_at);
