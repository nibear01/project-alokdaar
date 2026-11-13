-- 004_academic_household.sql — scoring inputs for ranking (FR-M1-03, FR-RS-02)
-- Contract per ARCHITECTURE §4. CREATE IF NOT EXISTS so Rafi's M2.9 work can extend safely.

CREATE TABLE IF NOT EXISTS academic_records (
  id           BIGSERIAL PRIMARY KEY,
  student_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term         TEXT NOT NULL,
  cgpa         NUMERIC(3, 2) CHECK (cgpa >= 0 AND cgpa <= 4),
  attendance_pct NUMERIC(5, 2) CHECK (attendance_pct >= 0 AND attendance_pct <= 100),
  institution  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, term)
);

CREATE TABLE IF NOT EXISTS household_records (
  id             BIGSERIAL PRIMARY KEY,
  student_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_size    INT NOT NULL CHECK (family_size >= 1),
  earners        INT NOT NULL CHECK (earners >= 0),
  monthly_income NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monthly_income >= 0),
  source         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academic_student_term
  ON academic_records (student_id, term DESC);
CREATE INDEX IF NOT EXISTS idx_household_student
  ON household_records (student_id, created_at DESC);

-- latest academic row per student (for scoring)
CREATE OR REPLACE VIEW latest_academic AS
SELECT DISTINCT ON (student_id)
  student_id, term, cgpa, attendance_pct, institution
FROM academic_records
ORDER BY student_id, term DESC, created_at DESC;

-- latest household row per student
CREATE OR REPLACE VIEW latest_household AS
SELECT DISTINCT ON (student_id)
  student_id, family_size, earners, monthly_income, source
FROM household_records
ORDER BY student_id, created_at DESC;
