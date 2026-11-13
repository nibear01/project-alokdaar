-- 012_discovery.sql — student discovery & application wizard (M2, FR-DA-01..07)
-- Adds draft applications (4-step wizard autosave), bookmarks, and one-active-
-- application-per-programme. Provider queue/ranking exclude drafts (code-side).

-- PG12+: allowed inside the migration transaction as long as the new value is
-- not used in this same file.
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'draft' BEFORE 'submitted';

-- drafts have no submission time yet
ALTER TABLE applications ALTER COLUMN submitted_at DROP NOT NULL;
ALTER TABLE applications ALTER COLUMN submitted_at DROP DEFAULT;

-- one live application per (programme, student); withdrawn frees the slot
CREATE UNIQUE INDEX IF NOT EXISTS uniq_applications_active
  ON applications (program_id, student_id)
  WHERE status <> 'withdrawn';

CREATE TABLE bookmarks (
  student_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id BIGINT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, program_id)
);

CREATE INDEX idx_bookmarks_program ON bookmarks (program_id);
