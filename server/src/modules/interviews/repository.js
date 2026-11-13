import { query } from '../../config/db.js';

// --- weekly slot templates ---

export async function createSlot(programId, { weekday, start_time, end_time, duration_minutes }) {
  const { rows } = await query(
    `INSERT INTO interview_slots (program_id, weekday, start_time, end_time, duration_minutes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [programId, weekday, start_time, end_time, duration_minutes],
  );
  return rows[0];
}

export async function listSlots(programId) {
  const { rows } = await query(
    `SELECT * FROM interview_slots WHERE program_id = $1 ORDER BY weekday, start_time`,
    [programId],
  );
  return rows;
}

export async function deleteSlot(id) {
  const { rowCount } = await query(`DELETE FROM interview_slots WHERE id = $1`, [id]);
  return rowCount > 0;
}

// --- conflict detection (provider OR student overlap) ---

export async function findConflicts({ slotStart, durationMinutes, providerId, studentId, excludeId }) {
  const { rows } = await query(
    `SELECT i.id, i.slot_start, i.duration_minutes, i.status, i.application_id
     FROM interviews i
     JOIN applications a ON a.id = i.application_id
     JOIN programs p ON p.id = i.program_id
     WHERE i.status IN ('scheduled', 'reschedule_requested')
       AND i.slot_start < $1::timestamptz + ($2 || ' minutes')::interval
       AND i.slot_start + (i.duration_minutes || ' minutes')::interval > $1::timestamptz
       AND (p.provider_id = $3 OR a.student_id = $4)
       AND ($5::bigint IS NULL OR i.id <> $5)`,
    [slotStart, String(durationMinutes), providerId, studentId, excludeId ?? null],
  );
  return rows;
}

// --- application context for scheduling ---

export async function findContext(applicationId) {
  const { rows } = await query(
    `SELECT a.id AS application_id, a.program_id, a.student_id, a.status,
            p.provider_id, p.title AS program_title
     FROM applications a
     JOIN programs p ON p.id = a.program_id
     WHERE a.id = $1`,
    [applicationId],
  );
  return rows[0] || null;
}

// --- interviews ---

export async function createInterview(client, {
  programId, applicationId, slotStart, durationMinutes, mode, meetLink, notes, createdBy,
}) {
  const { rows } = await client.query(
    `INSERT INTO interviews
       (program_id, application_id, slot_start, duration_minutes, mode, meet_link, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [programId, applicationId, slotStart, durationMinutes, mode, meetLink, notes ?? null, createdBy],
  );
  return rows[0];
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT i.*, a.student_id, a.status AS application_status, p.provider_id, p.title AS program_title
     FROM interviews i
     JOIN applications a ON a.id = i.application_id
     JOIN programs p ON p.id = i.program_id
     WHERE i.id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function updateInterview(client, id, fields) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) {
      sets.push(`${k} = $${i++}`);
      vals.push(v);
    }
  }
  vals.push(id);
  const { rows } = await client.query(
    `UPDATE interviews SET ${sets.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`,
    vals,
  );
  return rows[0];
}

export async function listByProgram(programId, bucket) {
  const { rows } = await query(
    `SELECT i.*, a.student_id, s.name AS student_name, s.email AS student_email
     FROM interviews i
     JOIN applications a ON a.id = i.application_id
     JOIN users s ON s.id = a.student_id
     WHERE i.program_id = $1
       AND (
         CASE $2
           WHEN 'upcoming' THEN i.status = 'scheduled' AND i.slot_start > now()
           WHEN 'past' THEN (i.slot_start <= now() OR i.status IN ('completed', 'cancelled'))
                          AND NOT (i.status = 'scheduled' AND i.slot_start > now())
           WHEN 'no_show' THEN i.status = 'no_show'
           WHEN 'reschedule_requested' THEN i.status = 'reschedule_requested'
         END
       )
     ORDER BY i.slot_start ASC`,
    [programId, bucket],
  );
  return rows;
}

export async function listForStudent(studentId) {
  const { rows } = await query(
    `SELECT i.*, p.title AS program_title, a.id AS application_id
     FROM interviews i
     JOIN applications a ON a.id = i.application_id
     JOIN programs p ON p.id = i.program_id
     WHERE a.student_id = $1
     ORDER BY i.slot_start ASC`,
    [studentId],
  );
  return rows;
}
