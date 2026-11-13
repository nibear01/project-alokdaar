import { query } from '../../config/db.js';

/** Scoring inputs for every student with at least one academic record. */
export async function scoringInputs(studentId) {
  const params = [];
  let filter = '';
  if (studentId) {
    params.push(studentId);
    filter = `WHERE ar.student_id = $1`;
  }
  const { rows } = await query(
    `SELECT ar.student_id,
            jsonb_agg(jsonb_build_object('term', ar.term, 'cgpa', ar.cgpa,
                                         'attendance_pct', ar.attendance_pct)
                      ORDER BY ar.term) AS academic,
            (SELECT to_jsonb(lh) FROM latest_household lh
              WHERE lh.student_id = ar.student_id) AS household
     FROM academic_records ar
     ${filter}
     GROUP BY ar.student_id`,
    params,
  );
  return rows;
}

export async function upsertCase(studentId, { score, level, factors }) {
  const { rows } = await query(
    `INSERT INTO dropout_cases (student_id, level, score, factors)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (student_id) DO UPDATE
       SET level = $2, score = $3, factors = $4, computed_at = now(), updated_at = now()
     RETURNING *`,
    [studentId, level, score, JSON.stringify(factors)],
  );
  return rows[0];
}

export async function listCases({ level, status, page, limit }) {
  const where = ['TRUE'];
  const params = [];
  if (level) { params.push(level); where.push(`c.level = $${params.length}::dropout_level`); }
  if (status) { params.push(status); where.push(`c.status = $${params.length}::dropout_case_status`); }
  params.push(limit, (page - 1) * limit);
  const { rows } = await query(
    `SELECT c.*, u.name AS student_name, sp.district,
            count(*) OVER() AS total_count
     FROM dropout_cases c
     JOIN users u ON u.id = c.student_id
     LEFT JOIN student_profiles sp ON sp.user_id = c.student_id
     WHERE ${where.join(' AND ')}
     ORDER BY CASE c.level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
              c.score DESC, c.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

export async function caseDetail(id) {
  const { rows } = await query(
    `SELECT c.*, u.name AS student_name, u.email AS student_email,
            sp.district, sp.upazila, sp.education_level,
            (SELECT jsonb_agg(jsonb_build_object('term', ar.term, 'cgpa', ar.cgpa,
                    'attendance_pct', ar.attendance_pct) ORDER BY ar.term)
             FROM academic_records ar WHERE ar.student_id = c.student_id) AS academic_trend,
            (SELECT to_jsonb(lh) FROM latest_household lh WHERE lh.student_id = c.student_id) AS household
     FROM dropout_cases c
     JOIN users u ON u.id = c.student_id
     LEFT JOIN student_profiles sp ON sp.user_id = c.student_id
     WHERE c.id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function setStatus(id, status) {
  const { rows } = await query(
    `UPDATE dropout_cases SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status],
  );
  return rows[0] || null;
}

export async function addNote(caseId, authorId, body) {
  const { rows } = await query(
    `INSERT INTO dropout_notes (case_id, author_id, body) VALUES ($1, $2, $3) RETURNING *`,
    [caseId, authorId, body],
  );
  return rows[0];
}

export async function notesFor(caseId) {
  const { rows } = await query(
    `SELECT n.id, n.body, n.created_at, u.name AS author_name, u.role AS author_role
     FROM dropout_notes n LEFT JOIN users u ON u.id = n.author_id
     WHERE n.case_id = $1 ORDER BY n.created_at`,
    [caseId],
  );
  return rows;
}

/** Open programmes a struggling student could still apply to (§5.8 recommend). */
export async function recommendedPrograms(studentId, limit = 5) {
  const { rows } = await query(
    `SELECT p.id, p.title, p.amount_per_student, p.deadline, p.location_district
     FROM programs p
     LEFT JOIN student_profiles sp ON sp.user_id = $1
     WHERE p.status = 'open'
       AND (p.deadline IS NULL OR p.deadline > now())
       AND (p.location_district IS NULL OR sp.district IS NULL
            OR p.location_district = sp.district)
       AND NOT EXISTS (SELECT 1 FROM applications a
                       WHERE a.program_id = p.id AND a.student_id = $1
                         AND a.status <> 'withdrawn')
     ORDER BY p.deadline ASC NULLS LAST
     LIMIT $2`,
    [studentId, limit],
  );
  return rows;
}
