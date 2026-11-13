import { query } from '../../config/db.js';

const COLS = `
  id, provider_id, title, description, criteria,
  total_fund, fund_raised, fund_disbursed, amount_per_student, seats, seats_available,
  required_docs, deadline, status, location_district, education_level,
  created_at, updated_at
`;

export async function insertProgram(providerId, data) {
  const { rows } = await query(
    `INSERT INTO programs (
       provider_id, title, description, criteria,
       total_fund, amount_per_student, seats, required_docs,
       deadline, location_district, education_level, status
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9,$10,$11,'draft')
     RETURNING ${COLS}`,
    [
      providerId,
      data.title,
      data.description ?? '',
      JSON.stringify(data.criteria ?? {}),
      data.total_fund ?? 0,
      data.amount_per_student ?? 0,
      data.seats ?? 0,
      JSON.stringify(data.required_docs ?? []),
      data.deadline ?? null,
      data.location_district ?? null,
      data.education_level ?? null,
    ],
  );
  return rows[0];
}

export async function findProgramById(id) {
  const { rows } = await query(`SELECT ${COLS} FROM programs WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function updateProgram(id, data) {
  const { rows } = await query(
    `UPDATE programs SET
       title = COALESCE($2, title),
       description = COALESCE($3, description),
       criteria = COALESCE($4::jsonb, criteria),
       total_fund = COALESCE($5, total_fund),
       amount_per_student = COALESCE($6, amount_per_student),
       seats = COALESCE($7, seats),
       required_docs = COALESCE($8::jsonb, required_docs),
       deadline = COALESCE($9, deadline),
       location_district = COALESCE($10, location_district),
       education_level = COALESCE($11, education_level),
       updated_at = now()
     WHERE id = $1
     RETURNING ${COLS}`,
    [
      id,
      data.title ?? null,
      data.description ?? null,
      data.criteria !== undefined ? JSON.stringify(data.criteria) : null,
      data.total_fund ?? null,
      data.amount_per_student ?? null,
      data.seats ?? null,
      data.required_docs !== undefined ? JSON.stringify(data.required_docs) : null,
      data.deadline ?? null,
      data.location_district ?? null,
      data.education_level ?? null,
    ],
  );
  return rows[0] || null;
}

/**
 * Atomic status transition — only flips when current status matches expected.
 * Returns the updated row, or null if the transition was illegal (stale state).
 */
export async function transitionStatus(id, expectedStatuses, newStatus) {
  const { rows } = await query(
    `UPDATE programs SET status = $3::program_status, updated_at = now()
     WHERE id = $1 AND status = ANY($2::program_status[])
     RETURNING ${COLS}`,
    [id, expectedStatuses, newStatus],
  );
  return rows[0] || null;
}

export async function listPrograms({ providerId, status, page, limit }) {
  const where = [];
  const params = [];
  if (providerId !== undefined) {
    params.push(providerId);
    where.push(`provider_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}::program_status`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit, (page - 1) * limit);

  const { rows } = await query(
    `SELECT ${COLS}, count(*) OVER() AS total_count
     FROM programs ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}
