-- 013_disbursements.sql — installments, hash-chained ledger, award letters
-- (M5.9–M5.12, FR-M3-01; ARCHITECTURE §5.5, RULES §2 Money)
-- Ledger rows are append-only: voids/adjusts are NEW entries with a reason;
-- nothing is ever deleted or rewritten (RULES §3 Database).

CREATE TYPE installment_status AS ENUM ('scheduled', 'paid', 'void');
CREATE TYPE payout_method AS ENUM ('bkash', 'nagad', 'bank', 'cash');
CREATE TYPE ledger_entry_type AS ENUM ('disbursement', 'void');

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS fund_disbursed NUMERIC(14, 2) NOT NULL DEFAULT 0;

CREATE TABLE installments (
  id             BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  seq            INT NOT NULL CHECK (seq >= 1),
  amount         NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  due_date       DATE NOT NULL,
  status         installment_status NOT NULL DEFAULT 'scheduled',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, seq)
);

CREATE INDEX idx_installments_due ON installments (status, due_date);

CREATE TABLE disbursements (
  id                   BIGSERIAL PRIMARY KEY,
  installment_id       BIGINT NOT NULL REFERENCES installments(id) ON DELETE RESTRICT,
  amount               NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  method               payout_method NOT NULL,
  ref                  TEXT NOT NULL,            -- gateway/bank reference
  note                 TEXT,
  paid_at              TIMESTAMPTZ NOT NULL,
  created_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  voided               BOOLEAN NOT NULL DEFAULT FALSE,
  void_reason          TEXT,
  voided_by            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  voided_at            TIMESTAMPTZ,
  receipt_confirmed_at TIMESTAMPTZ,              -- student "I received it" (M5.12)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT void_requires_reason CHECK (NOT voided OR void_reason IS NOT NULL)
);

-- one live (non-voided) payment per installment
CREATE UNIQUE INDEX uniq_disbursement_live
  ON disbursements (installment_id) WHERE NOT voided;

-- the tamper-evident chain: hash = sha256(prev_hash || canonical(payload))
CREATE TABLE ledger_entries (
  id              BIGSERIAL PRIMARY KEY,
  entry_type      ledger_entry_type NOT NULL,
  disbursement_id BIGINT NOT NULL REFERENCES disbursements(id) ON DELETE RESTRICT,
  payload         JSONB NOT NULL,
  prev_hash       TEXT NOT NULL,                 -- 'GENESIS' for the first entry
  hash            TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_order ON ledger_entries (id);

CREATE TABLE award_letters (
  id             BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
  code           TEXT NOT NULL UNIQUE,           -- QR → /verify/award/<code>
  issued_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
