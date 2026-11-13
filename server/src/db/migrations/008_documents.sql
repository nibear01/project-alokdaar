-- 008_documents.sql — Document Vault with OCR verification (FR-DV-01..05, ARCHITECTURE §5.4)
-- Status pipeline: processing → action_required (OCR mismatch, student confirms)
--                             → pending (admin queue) → verified | rejected(reason)
-- Re-upload/replace creates a NEW row that supersedes the old one (history preserved).

CREATE TYPE document_kind AS ENUM (
  'birth_certificate', 'transcript', 'income_certificate', 'institution_id'
);

CREATE TYPE document_status AS ENUM (
  'processing', 'action_required', 'pending', 'verified', 'rejected'
);

CREATE TABLE documents (
  id                    BIGSERIAL PRIMARY KEY,
  student_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                  document_kind NOT NULL,
  status                document_status NOT NULL DEFAULT 'processing',

  -- file (Cloudinary; file_url direct only in dev fallback)
  cloudinary_public_id  TEXT,
  file_url              TEXT,
  file_name             TEXT NOT NULL,
  mime_type             TEXT NOT NULL,
  file_size_bytes       BIGINT NOT NULL CHECK (file_size_bytes > 0),

  -- OCR (Google Vision; 'dev' provider when keys absent)
  ocr_provider          TEXT,
  ocr_fields            JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- [{ field, document_value, profile_value, resolution: null|'document'|'profile' }]
  mismatch              JSONB NOT NULL DEFAULT '[]'::jsonb,
  mismatch_resolved_at  TIMESTAMPTZ,

  -- admin decision
  reviewed_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at           TIMESTAMPTZ,
  reject_reason         TEXT,

  -- replace / re-upload chain + soft delete
  supersedes_id         BIGINT REFERENCES documents(id) ON DELETE SET NULL,
  superseded_at         TIMESTAMPTZ,
  deleted_at            TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reject_requires_reason
    CHECK (status <> 'rejected' OR reject_reason IS NOT NULL)
);

-- one ACTIVE document per (student, kind); history rows keep superseded_at/deleted_at
CREATE UNIQUE INDEX uniq_documents_active
  ON documents (student_id, kind)
  WHERE superseded_at IS NULL AND deleted_at IS NULL;

-- admin queue: oldest pending first; filters by status/kind
CREATE INDEX idx_documents_queue
  ON documents (status, created_at)
  WHERE superseded_at IS NULL AND deleted_at IS NULL;

CREATE INDEX idx_documents_student ON documents (student_id, created_at DESC);

-- verification history (Figma H1-1 "Verification history", H1-9 audit trail)
CREATE TABLE document_events (
  id           BIGSERIAL PRIMARY KEY,
  document_id  BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  from_status  document_status,
  to_status    document_status NOT NULL,
  actor_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_events_doc ON document_events (document_id, created_at);
