-- 005_scoring_config.sql — per-program scoring parameters (FR-RS-02)
-- Providers tune normalization per program; defaults applied in code when keys absent.

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS scoring_config JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN programs.scoring_config IS
  'e.g. {"max_cgpa":4,"need_reference_income":10000,"attendance_max":100} — empty object = defaults';
