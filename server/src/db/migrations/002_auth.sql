-- 002_auth.sql — email verification + session tracking

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS otp_hash TEXT,
  ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_attempts INT NOT NULL DEFAULT 0;

-- One row per login session (device). Stores hash of refresh token.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  user_agent         TEXT,
  ip                 INET,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
  ON auth_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_hash
  ON auth_sessions (refresh_token_hash);
