import { query } from '../../config/db.js';

/**
 * Review queue rows (FR-RS-01): ranked applicants + student identity
 * + score breakdown for the colour bar + duplicate-aid badge.
 */
export async function queueForProgram(programId, filters) {
  // drafts are wizard-in-progress (M2) — never shown to providers
  const where = ['a.program_id = $1', `a.status <> 'draft'`];
  const params = [programId];

  if (filters.status) {
    params.push(filters.status);
    where.push(`a.status = $${params.length}::application_status`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  if (filters.duplicate === 'true') where.push('a.duplicate_aid = TRUE');
  if (filters.duplicate === 'false') where.push('a.duplicate_aid = FALSE');

  const sortCol = { rank: 'a.rank ASC NULLS LAST', score: 'a.score DESC NULLS LAST', submitted_at: 'a.submitted_at DESC' }[filters.sort];
  params.push(filters.limit, (filters.page - 1) * filters.limit);

  const { rows } = await query(
    `SELECT a.id, a.rank, a.score, a.status, a.duplicate_aid, a.submitted_at,
            a.score_breakdown,
            u.id AS student_id, u.name AS student_name, u.email AS student_email,
            count(*) OVER() AS total_count
     FROM applications a
     JOIN users u ON u.id = a.student_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${sortCol}, a.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

/** Full applicant detail (FR-RS-03): application + student + program + trend + household. */
export async function findDetail(applicationId) {
  const { rows } = await query(
    `SELECT a.id, a.program_id, a.student_id, a.statement, a.status, a.score, a.rank,
            a.score_breakdown, a.duplicate_aid, a.decision_remarks, a.force_reason,
            a.submitted_at, a.decided_at,
            u.name AS student_name, u.email AS student_email, u.phone AS student_phone,
            u.locale AS student_locale,
            p.title AS program_title, p.amount_per_student, p.seats, p.deadline,
            p.status AS program_status, p.provider_id
     FROM applications a
     JOIN users u ON u.id = a.student_id
     JOIN programs p ON p.id = a.program_id
     WHERE a.id = $1`,
    [applicationId],
  );
  return rows[0] || null;
}

/** Academic trend (all terms, oldest first) — FR-RS-03. */
export async function academicTrend(studentId) {
  const { rows } = await query(
    `SELECT term, cgpa, attendance_pct, institution, created_at
     FROM academic_records
     WHERE student_id = $1
     ORDER BY term ASC, created_at ASC`,
    [studentId],
  );
  return rows;
}

export async function householdRecord(studentId) {
  const { rows } = await query(
    `SELECT family_size, earners, monthly_income, source, created_at
     FROM household_records
     WHERE student_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [studentId],
  );
  return rows[0] || null;
}

/** Status timeline — FR-DA-06 / audit (for detail page). */
export async function timeline(applicationId) {
  const { rows } = await query(
    `SELECT e.from_status, e.to_status, e.actor_role, e.note, e.created_at,
            u.name AS actor_name
     FROM application_events e
     LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.application_id = $1
     ORDER BY e.created_at ASC`,
    [applicationId],
  );
  return rows;
}

// --- decisions (FR-RS-04/05) ---

/** Live duplicate-aid lookup: student's approved scholarships on OTHER programs. */
export async function findActiveScholarships(studentId, excludeApplicationId) {
  const { rows } = await query(
    `SELECT a.id AS application_id, a.program_id, a.decided_at,
            p.title AS program_title, p.amount_per_student
     FROM applications a
     JOIN programs p ON p.id = a.program_id
     WHERE a.student_id = $1
       AND a.status = 'approved'
       AND a.id <> $2`,
    [studentId, excludeApplicationId],
  );
  return rows;
}

export async function findForDecision(applicationId) {
  const { rows } = await query(
    `SELECT a.id, a.program_id, a.student_id, a.status,
            p.provider_id, p.seats_available, p.amount_per_student,
            p.deadline, p.title AS program_title
     FROM applications a
     JOIN programs p ON p.id = a.program_id
     WHERE a.id = $1`,
    [applicationId],
  );
  return rows[0] || null;
}

export async function updateDecision(client, appId, { toStatus, remarks, forceReason }) {
  const { rows } = await client.query(
    `UPDATE applications
     SET status = $2::application_status,
         decision_remarks = COALESCE($3, decision_remarks),
         force_reason = COALESCE($4, force_reason),
         decided_at = now(),
         updated_at = now()
     WHERE id = $1
     RETURNING id, program_id, student_id, status, rank, score, decision_remarks, decided_at`,
    [appId, toStatus, remarks ?? null, forceReason ?? null],
  );
  return rows[0];
}

export async function insertEvent(client, { applicationId, fromStatus, toStatus, actorId, actorRole, note }) {
  await client.query(
    `INSERT INTO application_events (application_id, from_status, to_status, actor_id, actor_role, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [applicationId, fromStatus, toStatus, actorId, actorRole, note ?? null],
  );
}

/** Returns new seats_available, or null if no seats left. */
export async function decrementSeats(client, programId) {
  const { rows } = await client.query(
    `UPDATE programs
     SET seats_available = seats_available - 1, updated_at = now()
     WHERE id = $1 AND seats_available > 0
     RETURNING seats_available`,
    [programId],
  );
  return rows[0]?.seats_available ?? null;
}

// --- waitlist (FR-RS-08) ---

export async function nextWaitlistPosition(client, programId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM waitlist WHERE program_id = $1`,
    [programId],
  );
  return Number(rows[0].next);
}

export async function shiftWaitlist(client, programId, fromPosition) {
  await client.query(
    `UPDATE waitlist SET position = position + 1
     WHERE program_id = $1 AND position >= $2`,
    [programId, fromPosition],
  );
}

export async function insertWaitlist(client, { programId, applicationId, position }) {
  await client.query(
    `INSERT INTO waitlist (program_id, application_id, position)
     VALUES ($1, $2, $3)`,
    [programId, applicationId, position],
  );
}

export async function removeFromWaitlist(client, applicationId) {
  await client.query(`DELETE FROM waitlist WHERE application_id = $1`, [applicationId]);
}

// --- waitlist management (FR-RS-08) ---

export async function listWaitlist(programId) {
  const { rows } = await query(
    `SELECT w.position, w.application_id, w.created_at AS waitlisted_at,
            a.status, a.rank, a.score, a.duplicate_aid,
            u.id AS student_id, u.name AS student_name, u.email AS student_email
     FROM waitlist w
     JOIN applications a ON a.id = w.application_id
     JOIN users u ON u.id = a.student_id
     WHERE w.program_id = $1
     ORDER BY w.position ASC`,
    [programId],
  );
  return rows;
}

export async function findNextWaitlist(client, programId) {
  const { rows } = await client.query(
    `SELECT w.application_id, w.position, a.student_id, a.rank, a.score
     FROM waitlist w
     JOIN applications a ON a.id = w.application_id
     WHERE w.program_id = $1
     ORDER BY w.position ASC
     LIMIT 1
     FOR UPDATE`,
    [programId],
  );
  return rows[0] || null;
}

/** Returns new seats_available after freeing one. */
export async function freeSeat(client, programId) {
  const { rows } = await client.query(
    `UPDATE programs
     SET seats_available = seats_available + 1, updated_at = now()
     WHERE id = $1
     RETURNING seats_available`,
    [programId],
  );
  return rows[0]?.seats_available ?? null;
}

/** Cancel open interviews tied to a withdrawn application. */
export async function cancelOpenInterviews(client, applicationId) {
  const { rowCount } = await client.query(
    `UPDATE interviews SET status = 'cancelled', updated_at = now()
     WHERE application_id = $1 AND status IN ('scheduled', 'reschedule_requested')`,
    [applicationId],
  );
  return rowCount;
}
