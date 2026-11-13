/**
 * Dropout risk scoring (ARCHITECTURE §5.8, FR-M3-05) — pure and unit-testable.
 * Signals: CGPA trend across terms, latest attendance, household income per
 * member, absolute CGPA level. Score 0–100 → low | medium | high.
 */

export const LEVELS = { HIGH: 60, MEDIUM: 30 };

/**
 * @param academic  oldest-first [{ term, cgpa, attendance_pct }]
 * @param household { monthly_income, family_size } | null
 */
export function scoreStudent(academic, household) {
  const factors = [];
  const add = (factor, value, points) => factors.push({ factor, value, points });

  const terms = (academic || []).filter((r) => r.cgpa != null);
  const last = terms[terms.length - 1];
  const prev = terms[terms.length - 2];

  if (last && prev) {
    const drop = Number(prev.cgpa) - Number(last.cgpa);
    if (drop >= 0.3) add('cgpa_drop', `${prev.cgpa} → ${last.cgpa}`, 35);
    else if (drop >= 0.15) add('cgpa_drop', `${prev.cgpa} → ${last.cgpa}`, 20);
  }
  if (last?.cgpa != null && Number(last.cgpa) < 2.5) {
    add('low_cgpa', Number(last.cgpa), 15);
  }

  const att = (academic || []).filter((r) => r.attendance_pct != null).pop();
  if (att) {
    const a = Number(att.attendance_pct);
    if (a < 75) add('low_attendance', a, 25);
    else if (a < 85) add('slipping_attendance', a, 10);
  }

  if (household?.monthly_income != null) {
    const perMember = Number(household.monthly_income) / Math.max(1, Number(household.family_size || 1));
    const rounded = Math.round(perMember);
    if (perMember < 1500) add('income_per_member', rounded, 25);
    else if (perMember < 3000) add('income_per_member', rounded, 15);
  }

  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0));
  const level = score >= LEVELS.HIGH ? 'high' : score >= LEVELS.MEDIUM ? 'medium' : 'low';
  return { score, level, factors };
}
