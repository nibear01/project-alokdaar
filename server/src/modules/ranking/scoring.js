/**
 * Config-driven scoring for Application Review & Smart Selection (FR-RS-02).
 *
 * score = (w_m·merit + w_n·need + w_a·attendance) / 100     [0..100]
 *
 * All normalization parameters come from the program's scoring_config —
 * no per-program magic numbers in code. Missing keys fall back to defaults.
 */

export const DEFAULT_SCORING = {
  // CGPA scale maximum (3.0, 3.3, 4.0 …)
  max_cgpa: 4,
  // ৳ income per member/month where need score hits 0 (linear falloff → 0..ref)
  need_reference_income: 10000,
  // attendance scale maximum (100 = percentage, 10 = 10-point scale …)
  attendance_max: 100,
};

/** Merge stored config with defaults — unknown keys ignored, numbers coerced. */
export function resolveScoringConfig(stored) {
  const cfg = { ...DEFAULT_SCORING };
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(DEFAULT_SCORING)) {
      const v = Number(stored[key]);
      if (Number.isFinite(v) && v > 0) cfg[key] = v;
    }
  }
  return cfg;
}

function clamp(n, min = 0, max = 100) {
  return Math.min(max, Math.max(min, n));
}

export function meritScore(cgpa, config) {
  if (cgpa === null || cgpa === undefined) return 0;
  return clamp((Number(cgpa) / config.max_cgpa) * 100);
}

export function needScore(household, config) {
  if (!household) return 0;
  const size = Number(household.family_size) || 1;
  const income = Number(household.monthly_income) || 0;
  const perMember = income / size;
  return clamp(100 * (1 - perMember / config.need_reference_income));
}

export function attendanceScore(attendancePct, config) {
  if (attendancePct === null || attendancePct === undefined) return 0;
  return clamp((Number(attendancePct) / config.attendance_max) * 100);
}

/**
 * @param {{cgpa?: number|null, attendance_pct?: number|null, household?: object|null}} inputs
 * @param {{merit: number, need: number, attendance: number}} weights — sums to 100
 * @param {object} [storedConfig] — program scoring_config (raw, from DB)
 * @returns {{score: number, breakdown: object}}
 */
export function computeScore(inputs, weights, storedConfig) {
  const config = resolveScoringConfig(storedConfig);
  const merit = meritScore(inputs.cgpa, config);
  const need = needScore(inputs.household, config);
  const attendance = attendanceScore(inputs.attendance_pct, config);

  const score =
    (weights.merit * merit + weights.need * need + weights.attendance * attendance) / 100;

  return {
    score: Math.round(score * 10000) / 10000, // NUMERIC(8,4)
    breakdown: {
      config, // what normalization was applied — surfaced in "Why this rank?"
      merit: {
        cgpa: inputs.cgpa ?? null,
        normalized: Math.round(merit * 100) / 100,
        weight: weights.merit,
        points: Math.round(weights.merit * merit) / 100,
      },
      need: {
        family_size: inputs.household?.family_size ?? null,
        monthly_income: inputs.household?.monthly_income ?? null,
        income_per_member: inputs.household
          ? Math.round(
              (Number(inputs.household.monthly_income) /
                Number(inputs.household.family_size || 1)) * 100,
            ) / 100
          : null,
        normalized: Math.round(need * 100) / 100,
        weight: weights.need,
        points: Math.round(weights.need * need) / 100,
      },
      attendance: {
        attendance_pct: inputs.attendance_pct ?? null,
        normalized: Math.round(attendance * 100) / 100,
        weight: weights.attendance,
        points: Math.round(weights.attendance * attendance) / 100,
      },
      total: Math.round(score * 100) / 100,
    },
  };
}
