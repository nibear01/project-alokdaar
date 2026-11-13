-- 009_notifications_center.sql — Notification center + preferences (M6.9/M6.10, FR-M2-03)
-- read_at powers the in-app center; preferences gate email/SMS fan-out (in-app always on).

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL AND channel = 'in_app';

CREATE TABLE notification_preferences (
  user_id       BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sms_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- in-process scheduler bookkeeping (ARCHITECTURE §9: in-process cron)
CREATE TABLE job_runs (
  name        TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
