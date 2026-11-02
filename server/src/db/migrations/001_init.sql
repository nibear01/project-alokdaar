-- 001_init.sql — core identity & programs (expand per ARCHITECTURE.md)

CREATE TYPE user_role AS ENUM ('student', 'provider', 'admin');

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  role          user_role NOT NULL,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  locale        TEXT NOT NULL DEFAULT 'en',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE program_status AS ENUM ('draft', 'open', 'paused', 'closed');

CREATE TABLE programs (
  id             BIGSERIAL PRIMARY KEY,
  provider_id    BIGINT NOT NULL REFERENCES users(id),
  title          TEXT NOT NULL,
  description    TEXT,
  criteria       JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_fund     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  amount_per_student NUMERIC(14, 2) NOT NULL DEFAULT 0,
  seats          INT NOT NULL DEFAULT 0,
  required_docs  JSONB NOT NULL DEFAULT '[]'::jsonb,
  deadline       TIMESTAMPTZ,
  status         program_status NOT NULL DEFAULT 'draft',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE program_weights (
  program_id BIGINT PRIMARY KEY REFERENCES programs(id) ON DELETE CASCADE,
  merit      INT NOT NULL DEFAULT 40,
  need       INT NOT NULL DEFAULT 40,
  attendance INT NOT NULL DEFAULT 20,
  CONSTRAINT weights_sum_100 CHECK (merit + need + attendance = 100)
);

CREATE INDEX idx_programs_status_deadline ON programs (status, deadline);
CREATE INDEX idx_programs_provider ON programs (provider_id);
