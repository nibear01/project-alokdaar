import { query } from '../../config/db.js';

/** Everything eligibility needs about one student, in one query. */
export async function studentSnapshot(studentId) {
  const { rows } = await query(
    `SELECT u.id, u.name,
            la.cgpa, la.attendance_pct, la.institution AS record_institution,
            lh.monthly_income, lh.family_size,
            sp.district, sp.upazila, sp.education_level,
            COALESCE((SELECT array_agg(d.kind::text) FROM documents d
                      WHERE d.student_id = u.id AND d.superseded_at IS NULL
                        AND d.deleted_at IS NULL
                        AND d.status IN ('pending', 'verified')), '{}') AS verified_kinds
     FROM users u
     LEFT JOIN latest_academic la ON la.student_id = u.id
     LEFT JOIN latest_household lh ON lh.student_id = u.id
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     WHERE u.id = $1`,
    [studentId],
  );
  return rows[0] || null;
}

/** Open programmes matching the base filters (eligibility is computed in JS). */
export async function openPrograms(studentId, f) {
  const where = [`p.status = 'open'`];
  const params = [studentId];
  if (f.search) {
    params.push(`%${f.search}%`);
    where.push(`(p.title ILIKE $${params.length} OR p.description ILIKE $${params.length}
                 OR u.name ILIKE $${params.length})`);
  }
  if (f.district) { params.push(f.district); where.push(`p.location_district = $${params.length}`); }
  if (f.education_level) { params.push(f.education_level); where.push(`p.education_level = $${params.length}`); }
  if (f.min_amount) { params.push(f.min_amount); where.push(`p.amount_per_student >= $${params.length}`); }
  if (f.deadline_within_days) {
    params.push(f.deadline_within_days);
    where.push(`p.deadline IS NOT NULL AND p.deadline < now() + ($${params.length} || ' days')::interval`);
  }
  const order = {
    deadline: 'p.deadline ASC NULLS LAST',
    amount: 'p.amount_per_student DESC',
    newest: 'p.id DESC',
  }[f.sort] || 'p.deadline ASC NULLS LAST';

  const { rows } = await query(
    `SELECT p.id, p.title, p.description, p.criteria, p.required_docs,
            p.amount_per_student, p.total_fund, p.fund_raised, p.seats, p.seats_available,
            p.deadline, p.location_district, p.education_level,
            u.name AS provider_name,
            (b.student_id IS NOT NULL) AS bookmarked,
            a.id AS application_id, a.status AS application_status
     FROM programs p
     JOIN users u ON u.id = p.provider_id
     LEFT JOIN bookmarks b ON b.program_id = p.id AND b.student_id = $1
     LEFT JOIN applications a ON a.program_id = p.id AND a.student_id = $1
            AND a.status <> 'withdrawn'
     WHERE ${where.join(' AND ')}
     ORDER BY ${order}, p.id
     LIMIT 200`,
    params,
  );
  return rows;
}

export async function programForStudent(studentId, programId) {
  const { rows } = await query(
    `SELECT p.*, u.name AS provider_name,
            (b.student_id IS NOT NULL) AS bookmarked,
            a.id AS application_id, a.status AS application_status
     FROM programs p
     JOIN users u ON u.id = p.provider_id
     LEFT JOIN bookmarks b ON b.program_id = p.id AND b.student_id = $1
     LEFT JOIN applications a ON a.program_id = p.id AND a.student_id = $1
            AND a.status <> 'withdrawn'
     WHERE p.id = $2`,
    [studentId, programId],
  );
  return rows[0] || null;
}

// ---- bookmarks (FR-DA-03) ----

export async function addBookmark(studentId, programId) {
  await query(
    `INSERT INTO bookmarks (student_id, program_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [studentId, programId],
  );
}

export async function removeBookmark(studentId, programId) {
  const { rowCount } = await query(
    `DELETE FROM bookmarks WHERE student_id = $1 AND program_id = $2`,
    [studentId, programId],
  );
  return rowCount;
}

export async function listBookmarks(studentId) {
  const { rows } = await query(
    `SELECT p.id, p.title, p.criteria, p.required_docs, p.amount_per_student,
            p.deadline, p.status, p.location_district, p.seats, p.seats_available,
            u.name AS provider_name, b.created_at AS bookmarked_at,
            a.id AS application_id, a.status AS application_status
     FROM bookmarks b
     JOIN programs p ON p.id = b.program_id
     JOIN users u ON u.id = p.provider_id
     LEFT JOIN applications a ON a.program_id = p.id AND a.student_id = $1
            AND a.status <> 'withdrawn'
     WHERE b.student_id = $1
     ORDER BY b.created_at DESC`,
    [studentId],
  );
  return rows;
}

// ---- applications, student side (FR-DA-04..06) ----

export async function insertDraft(client, { programId, studentId }) {
  const { rows } = await client.query(
    `INSERT INTO applications (program_id, student_id, status, statement, submitted_at)
     VALUES ($1, $2, 'draft', '', NULL)
     RETURNING *`,
    [programId, studentId],
  );
  return rows[0];
}

export async function findOwn(studentId, applicationId) {
  const { rows } = await query(
    `SELECT a.*, p.title AS program_title, p.deadline, p.status AS program_status,
            p.required_docs, p.criteria, p.amount_per_student,
            u.name AS provider_name, p.provider_id
     FROM applications a
     JOIN programs p ON p.id = a.program_id
     JOIN users u ON u.id = p.provider_id
     WHERE a.id = $1 AND a.student_id = $2`,
    [applicationId, studentId],
  );
  return rows[0] || null;
}

export async function saveStatement(applicationId, statement) {
  const { rows } = await query(
    `UPDATE applications SET statement = $2 WHERE id = $1 RETURNING id, statement, status`,
    [applicationId, statement],
  );
  return rows[0];
}

export async function submit(client, applicationId) {
  const { rows } = await client.query(
    `UPDATE applications
     SET status = 'submitted', submitted_at = now()
     WHERE id = $1 AND status = 'draft'
     RETURNING *`,
    [applicationId],
  );
  return rows[0] || null;
}

export async function deleteDraft(studentId, applicationId) {
  const { rowCount } = await query(
    `DELETE FROM applications WHERE id = $1 AND student_id = $2 AND status = 'draft'`,
    [applicationId, studentId],
  );
  return rowCount;
}

export async function listOwn(studentId, { status, page, limit }) {
  const where = ['a.student_id = $1'];
  const params = [studentId];
  if (status) { params.push(status); where.push(`a.status = $${params.length}::application_status`); }
  params.push(limit, (page - 1) * limit);
  const { rows } = await query(
    `SELECT a.id, a.status, a.submitted_at, a.decided_at, a.rank,
            p.id AS program_id, p.title AS program_title, p.deadline,
            p.amount_per_student, u.name AS provider_name,
            i.slot_start AS interview_at, i.meet_link,
            count(*) OVER() AS total_count
     FROM applications a
     JOIN programs p ON p.id = a.program_id
     JOIN users u ON u.id = p.provider_id
     LEFT JOIN interviews i ON i.application_id = a.id AND i.status NOT IN ('cancelled')
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(a.submitted_at, now()) DESC, a.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

export async function eventsFor(applicationId) {
  const { rows } = await query(
    `SELECT e.from_status, e.to_status, e.note, e.created_at, e.actor_role
     FROM application_events e
     WHERE e.application_id = $1
     ORDER BY e.created_at`,
    [applicationId],
  );
  return rows;
}

export async function insertEvent(client, { applicationId, from, to, actorId, actorRole, note }) {
  const run = client ? client.query.bind(client) : query;
  await run(
    `INSERT INTO application_events
       (application_id, from_status, to_status, actor_id, actor_role, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [applicationId, from ?? null, to, actorId ?? null, actorRole ?? null, note ?? null],
  );
}
