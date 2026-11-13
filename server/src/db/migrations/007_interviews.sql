-- 007_interviews.sql — weekly slots, interviews, notifications (FR-RS-06/07/09)

CREATE TYPE interview_status AS ENUM
  ('scheduled', 'reschedule_requested', 'completed', 'cancelled', 'no_show');

-- Provider's weekly recurring availability templates (weekly slot picker)
CREATE TABLE interview_slots (
  id                BIGSERIAL PRIMARY KEY,
  program_id        BIGINT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  weekday           INT NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  duration_minutes  INT NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX idx_interview_slots_program ON interview_slots (program_id, weekday);

CREATE TABLE interviews (
  id                  BIGSERIAL PRIMARY KEY,
  program_id          BIGINT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  application_id      BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  slot_start          TIMESTAMPTZ NOT NULL,
  duration_minutes    INT NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  mode                TEXT NOT NULL DEFAULT 'online'
                      CHECK (mode IN ('online', 'in_person', 'phone')),
  meet_link           TEXT,
  calendar_event_id   TEXT,
  status              interview_status NOT NULL DEFAULT 'scheduled',
  notes               TEXT,
  reschedule_note     TEXT,
  proposed_slot_start TIMESTAMPTZ,
  created_by          BIGINT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_interviews_program_slot ON interviews (program_id, slot_start);
CREATE INDEX idx_interviews_application ON interviews (application_id);
CREATE INDEX idx_interviews_status ON interviews (status);

-- In-app / email / sms delivery log (ARCHITECTURE 5.7)
CREATE TABLE notifications (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id BIGINT REFERENCES applications(id) ON DELETE SET NULL,
  interview_id   BIGINT REFERENCES interviews(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL,
  channel        TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'sms')),
  title          TEXT,
  body           TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);
