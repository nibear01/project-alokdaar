-- 010_donations.sql — Online donations via SSLCommerz (M5.1–M5.8, FR-DN-01..09)
-- RULES §2 Money: fund_raised increments ONLY after IPN validation; receipts only
-- for confirmed donations; idempotency on tran_id/val_id.

CREATE TYPE donation_status AS ENUM ('pending', 'confirmed', 'failed', 'cancelled');
CREATE TYPE recurring_status AS ENUM ('active', 'paused', 'cancelled');

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS fund_raised NUMERIC(14, 2) NOT NULL DEFAULT 0;

CREATE TABLE donations (
  id               BIGSERIAL PRIMARY KEY,
  donor_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,  -- NULL = guest
  program_id       BIGINT REFERENCES programs(id) ON DELETE SET NULL, -- NULL = general fund
  amount           NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  tip_amount       NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (tip_amount >= 0),
  currency         TEXT NOT NULL DEFAULT 'BDT',
  recurring        BOOLEAN NOT NULL DEFAULT FALSE,
  recurring_state  recurring_status,               -- set only when recurring
  anonymous        BOOLEAN NOT NULL DEFAULT FALSE, -- hide from public donor lists
  donor_name       TEXT,                           -- guest contact (or snapshot)
  donor_email      TEXT,
  donor_phone      TEXT,
  status           donation_status NOT NULL DEFAULT 'pending',
  tran_id          TEXT NOT NULL UNIQUE,           -- ours; sent to the gateway
  val_id           TEXT UNIQUE,                    -- gateway's, set on validated IPN
  gateway_payload  JSONB,                          -- last IPN/validator response
  confirmed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recurring_state_only_when_recurring
    CHECK (recurring OR recurring_state IS NULL)
);

CREATE INDEX idx_donations_donor ON donations (donor_id, created_at DESC);
CREATE INDEX idx_donations_program ON donations (program_id, status);
CREATE INDEX idx_donations_status_time ON donations (status, created_at DESC);

-- receipt only on confirm (printable client-side from JSON; PDF in M5.11 scope)
CREATE TABLE receipts (
  id          BIGSERIAL PRIMARY KEY,
  donation_id BIGINT NOT NULL UNIQUE REFERENCES donations(id) ON DELETE CASCADE,
  receipt_no  TEXT NOT NULL UNIQUE,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
