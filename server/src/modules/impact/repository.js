import { query } from '../../config/db.js';

/**
 * Per-district aggregates (FR-IM-01). Student district comes from
 * student_profiles and falls back to the programme's district; donations carry
 * the programme's district. funds_disbursed arrives with the M5.9 ledger —
 * until then funds_committed (approved × amount_per_student) is the proxy.
 */
export async function byDistrict({ program_id = null, provider_id = null, from = null, to = null }) {
  const params = [program_id, provider_id, from, to];
  const { rows } = await query(
    `WITH apps AS (
       SELECT COALESCE(sp.district, p.location_district, 'Unknown') AS district,
              count(*) FILTER (WHERE a.status = 'approved')::int AS students_supported,
              COALESCE(sum(p.amount_per_student) FILTER (WHERE a.status = 'approved'), 0) AS funds_committed,
              count(*) FILTER (WHERE a.status IN
                ('submitted','under_review','shortlisted','waitlisted'))::int AS unfunded_eligible
       FROM applications a
       JOIN programs p ON p.id = a.program_id
       LEFT JOIN student_profiles sp ON sp.user_id = a.student_id
       WHERE ($1::bigint IS NULL OR a.program_id = $1)
         AND ($2::bigint IS NULL OR p.provider_id = $2)
         AND ($3::timestamptz IS NULL OR a.submitted_at >= $3)
         AND ($4::timestamptz IS NULL OR a.submitted_at <= $4)
       GROUP BY 1
     ),
     dons AS (
       SELECT COALESCE(p.location_district, 'Unknown') AS district,
              COALESCE(sum(d.amount), 0) AS funds_raised,
              count(*)::int AS donations
       FROM donations d
       JOIN programs p ON p.id = d.program_id
       WHERE d.status = 'confirmed'
         AND ($1::bigint IS NULL OR d.program_id = $1)
         AND ($2::bigint IS NULL OR p.provider_id = $2)
         AND ($3::timestamptz IS NULL OR d.confirmed_at >= $3)
         AND ($4::timestamptz IS NULL OR d.confirmed_at <= $4)
       GROUP BY 1
     )
     SELECT COALESCE(a.district, dn.district) AS district,
            COALESCE(a.students_supported, 0) AS students_supported,
            COALESCE(a.funds_committed, 0) AS funds_committed,
            COALESCE(a.unfunded_eligible, 0) AS unfunded_eligible,
            COALESCE(dn.funds_raised, 0) AS funds_raised,
            COALESCE(dn.donations, 0) AS donations
     FROM apps a
     FULL JOIN dons dn ON dn.district = a.district
     ORDER BY COALESCE(dn.funds_raised, 0) DESC, district`,
    params,
  );
  return rows;
}

/** Upazila breakdown + programmes active in one district (FR-IM-03/04). */
export async function districtDetail(district) {
  const { rows: upazilas } = await query(
    `SELECT COALESCE(sp.upazila, 'Unknown') AS upazila,
            count(*) FILTER (WHERE a.status = 'approved')::int AS students_supported,
            COALESCE(sum(p.amount_per_student) FILTER (WHERE a.status = 'approved'), 0) AS funds_committed,
            count(*) FILTER (WHERE a.status IN
              ('submitted','under_review','shortlisted','waitlisted'))::int AS unfunded_eligible
     FROM applications a
     JOIN programs p ON p.id = a.program_id
     LEFT JOIN student_profiles sp ON sp.user_id = a.student_id
     WHERE COALESCE(sp.district, p.location_district, 'Unknown') = $1
     GROUP BY 1
     ORDER BY funds_committed DESC, upazila`,
    [district],
  );
  const { rows: programs } = await query(
    `SELECT id, title, status, amount_per_student, fund_raised, total_fund, deadline
     FROM programs
     WHERE location_district = $1
     ORDER BY (status = 'open') DESC, deadline ASC NULLS LAST
     LIMIT 20`,
    [district],
  );
  return { upazilas, programs };
}

/** Headline numbers for the public landing section (FR-IM-06). */
export async function publicSummary() {
  const { rows } = await query(
    `SELECT
       (SELECT COALESCE(sum(amount), 0) FROM donations WHERE status = 'confirmed') AS funds_raised,
       (SELECT COALESCE(sum(p.amount_per_student), 0)
          FROM applications a JOIN programs p ON p.id = a.program_id
          WHERE a.status = 'approved') AS funds_committed,
       (SELECT count(*) FROM applications WHERE status = 'approved') AS students_supported,
       (SELECT count(*) FROM applications
          WHERE status IN ('submitted','under_review','shortlisted','waitlisted')) AS unfunded_eligible,
       (SELECT count(DISTINCT COALESCE(sp.district, p.location_district))
          FROM applications a
          JOIN programs p ON p.id = a.program_id
          LEFT JOIN student_profiles sp ON sp.user_id = a.student_id
          WHERE COALESCE(sp.district, p.location_district) IS NOT NULL) AS districts_reached`,
  );
  return rows[0];
}

/** Analytics overview (M6.8 base): status funnel, weekly donations, programme progress. */
export async function overview(providerId) {
  const params = [providerId];
  const { rows: funnel } = await query(
    `SELECT a.status, count(*)::int AS count
     FROM applications a JOIN programs p ON p.id = a.program_id
     WHERE ($1::bigint IS NULL OR p.provider_id = $1)
     GROUP BY a.status`,
    params,
  );
  const { rows: weekly } = await query(
    `SELECT date_trunc('week', d.confirmed_at)::date AS week,
            COALESCE(sum(d.amount), 0) AS raised, count(*)::int AS donations
     FROM donations d
     LEFT JOIN programs p ON p.id = d.program_id
     WHERE d.status = 'confirmed'
       AND d.confirmed_at > now() - interval '8 weeks'
       AND ($1::bigint IS NULL OR p.provider_id = $1)
     GROUP BY 1 ORDER BY 1`,
    params,
  );
  const { rows: programs } = await query(
    `SELECT id, title, status, total_fund, fund_raised, seats, seats_available
     FROM programs
     WHERE ($1::bigint IS NULL OR provider_id = $1)
     ORDER BY (status = 'open') DESC, id DESC
     LIMIT 25`,
    params,
  );
  return { funnel, weekly, programs };
}
