-- 014_tickets_ai.sql — Help desk tickets + AI surfaces (M6.12–M6.15, FR-AI-01..04)

CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');
CREATE TYPE ticket_priority AS ENUM ('low', 'normal', 'high');

CREATE TABLE tickets (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category        TEXT NOT NULL CHECK (category IN
                    ('documents', 'payments', 'applications', 'account', 'other')),
  subject         TEXT NOT NULL,
  status          ticket_status NOT NULL DEFAULT 'open',
  priority        ticket_priority NOT NULL DEFAULT 'normal',
  assignee_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  application_id  BIGINT REFERENCES applications(id) ON DELETE SET NULL,
  -- "escalate to ticket" carries the assistant conversation with it (H2-2)
  chat_transcript JSONB,
  rating          INT CHECK (rating BETWEEN 1 AND 5),
  rating_comment  TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tickets_inbox ON tickets (status, priority, created_at);
CREATE INDEX idx_tickets_user ON tickets (user_id, created_at DESC);

CREATE TABLE ticket_messages (
  id          BIGSERIAL PRIMARY KEY,
  ticket_id   BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  internal    BOOLEAN NOT NULL DEFAULT FALSE,   -- admin-only notes (H2-6)
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_messages ON ticket_messages (ticket_id, created_at);

-- cached reviewer summary + originality flag (H2-7, used inside N1-3)
ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_summary JSONB;
