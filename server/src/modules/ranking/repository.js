import { query } from '../../config/db.js';

export const DEFAULT_WEIGHTS = { merit: 40, need: 40, attendance: 20 };

export async function getWeights(programId) {
  const { rows } = await query(
    `SELECT merit, need, attendance FROM program_weights WHERE program_id = $1`,
    [programId],
  );
  if (!rows[0]) return { ...DEFAULT_WEIGHTS };
  const { merit, need, attendance } = rows[0];
  return { merit, need, attendance };
}

export async function upsertWeights(programId, weights) {
  const { rows } = await query(
    `INSERT INTO program_weights (program_id, merit, need, attendance)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (program_id) DO UPDATE
       SET merit = EXCLUDED.merit,
           need = EXCLUDED.need,
           attendance = EXCLUDED.attendance
     RETURNING merit, need, attendance`,
    [programId, weights.merit, weights.need, weights.attendance],
  );
  const { merit, need, attendance } = rows[0];
  return { merit, need, attendance };
}

/** Per-program normalization params (empty object = defaults). */
export async function getScoringConfig(programId) {
  const { rows } = await query(
    `SELECT scoring_config FROM programs WHERE id = $1`,
    [programId],
  );
  return rows[0]?.scoring_config ?? {};
}

export async function saveScoringConfig(programId, config) {
  const { rows } = await query(
    `UPDATE programs SET scoring_config = $2::jsonb, updated_at = now()
     WHERE id = $1 RETURNING scoring_config`,
    [programId, JSON.stringify(config)],
  );
  return rows[0]?.scoring_config ?? {};
}

/**
 * All rankable applications for a program with their latest scoring inputs.
 * Withdrawn students are excluded from ranking.
 */
export async function getApplicationsWithInputs(programId) {
  const { rows } = await query(
    `SELECT a.id, a.status,
            la.cgpa, la.attendance_pct,
            lh.family_size, lh.earners, lh.monthly_income
     FROM applications a
     LEFT JOIN latest_academic la ON la.student_id = a.student_id
     LEFT JOIN latest_household lh ON lh.student_id = a.student_id
     WHERE a.program_id = $1 AND a.status <> 'withdrawn'
     ORDER BY a.id`,
    [programId],
  );
  return rows;
}

/** Persist computed score + breakdown + rank for a batch of applications. */
export async function saveRankedScores(programId, ranked) {
  const client = await (await import('../../config/db.js')).getClient();
  try {
    await client.query('BEGIN');
    for (const r of ranked) {
      await client.query(
        `UPDATE applications
         SET score = $2, rank = $3, score_breakdown = $4::jsonb, updated_at = now()
         WHERE id = $1`,
        [r.id, r.score, r.rank, JSON.stringify(r.breakdown)],
      );
    }
    // clear ranks for withdrawn (no longer in queue)
    await client.query(
      `UPDATE applications SET rank = NULL, updated_at = now()
       WHERE program_id = $1 AND status = 'withdrawn'`,
      [programId],
    );
    await client.query('COMMIT');
    return ranked.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Duplicate-aid flag: student holds an approved scholarship on ANOTHER program. */
export async function refreshDuplicateAidFlags(studentIds) {
  if (!studentIds.length) return;
  const { rowCount } = await query(
    `UPDATE applications a
     SET duplicate_aid = EXISTS (
           SELECT 1 FROM applications other
           WHERE other.student_id = a.student_id
             AND other.status = 'approved'
             AND other.program_id <> a.program_id
         ),
         updated_at = now()
     WHERE a.id = ANY($1::bigint[])`,
    [studentIds],
  );
  return rowCount;
}
