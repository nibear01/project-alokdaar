/**
 * Eligibility engine (ARCHITECTURE §5.1, FR-DA-02) — pure and unit-testable.
 * program.criteria (jsonb) × student snapshot → pass/fail per criterion with the
 * exact failure reason (RULES §4: always show exact failure reasons).
 *
 * criteria: { min_cgpa, max_household_income, districts[], education_levels[] }
 * student:  { cgpa, monthly_income, district, education_level, verified_kinds[] }
 */

const norm = (s) => String(s ?? '').trim().toLowerCase();

export function evaluate(criteria = {}, requiredDocs = [], student = {}) {
  const checks = [];
  const add = (criterion, required, actual, pass, reason = null) =>
    checks.push({ criterion, required, actual, pass, reason });

  if (criteria.min_cgpa != null) {
    const have = student.cgpa != null ? Number(student.cgpa) : null;
    const pass = have != null && have >= Number(criteria.min_cgpa);
    add('min_cgpa', Number(criteria.min_cgpa), have, pass,
      pass ? null : have == null
        ? 'Add your academic record to check this'
        : `CGPA ${have} < ${criteria.min_cgpa}`);
  }

  if (criteria.max_household_income != null) {
    const have = student.monthly_income != null ? Number(student.monthly_income) : null;
    const pass = have != null && have <= Number(criteria.max_household_income);
    add('max_household_income', Number(criteria.max_household_income), have, pass,
      pass ? null : have == null
        ? 'Add your household record to check this'
        : `Income ৳${have} > ৳${criteria.max_household_income}`);
  }

  if (Array.isArray(criteria.districts) && criteria.districts.length) {
    const have = student.district ?? null;
    const pass = have != null && criteria.districts.map(norm).includes(norm(have));
    add('districts', criteria.districts, have, pass,
      pass ? null : have == null
        ? 'Set your district in your profile'
        : `${have} is not an eligible district`);
  }

  if (Array.isArray(criteria.education_levels) && criteria.education_levels.length) {
    const have = student.education_level ?? null;
    const pass = have != null && criteria.education_levels.map(norm).includes(norm(have));
    add('education_levels', criteria.education_levels, have, pass,
      pass ? null : have == null
        ? 'Set your education level in your profile'
        : `${have} is not an eligible level`);
  }

  const docs = (requiredDocs || []).map((kind) => ({
    kind,
    in_vault: (student.verified_kinds || []).includes(kind),
  }));

  return {
    eligible: checks.every((c) => c.pass),
    checks,
    required_docs: docs,
    missing_docs: docs.filter((d) => !d.in_vault).map((d) => d.kind),
  };
}
