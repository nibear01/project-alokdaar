import { getClient } from '../../config/db.js';
import { notify } from '../../lib/notify.js';
import * as repo from './repository.js';
import { scoreStudent } from './scoring.js';

function err(message, code, status = 400, details) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  if (details) e.details = details;
  return e;
}

/** Re-score every student (or one) — provider/admin button + future cron hook. */
export async function recompute({ student_id }) {
  const inputs = await repo.scoringInputs(student_id);
  const summary = { scored: 0, high: 0, medium: 0, low: 0 };
  for (const row of inputs) {
    const result = scoreStudent(row.academic, row.household);
    await repo.upsertCase(row.student_id, result);
    summary.scored += 1;
    summary[result.level] += 1;
  }
  return summary;
}

export async function listCases(filters) {
  const rows = await repo.listCases(filters);
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    items: rows.map(({ total_count, ...c }) => c),
    page: filters.page,
    limit: filters.limit,
    total,
  };
}

/** Case detail: factors, trend, household, notes, programme recommendations. */
export async function getCase(id) {
  const c = await repo.caseDetail(id);
  if (!c) throw err('Case not found', 'NOT_FOUND', 404);
  return {
    case: c,
    notes: await repo.notesFor(id),
    recommended_programs: await repo.recommendedPrograms(c.student_id),
  };
}

export async function addNote(user, id, { body }) {
  const c = await repo.caseDetail(id);
  if (!c) throw err('Case not found', 'NOT_FOUND', 404);
  return { note: await repo.addNote(id, user.id, body) };
}

export async function setStatus(id, { status }) {
  const row = await repo.setStatus(id, status);
  if (!row) throw err('Case not found', 'NOT_FOUND', 404);
  return { case: row };
}

/** Send the student their top open-programme matches (in-app/email/SMS). */
export async function recommend(id) {
  const c = await repo.caseDetail(id);
  if (!c) throw err('Case not found', 'NOT_FOUND', 404);
  const programs = await repo.recommendedPrograms(c.student_id);
  if (!programs.length) return { notified: false, reason: 'no open matching programmes' };

  const client = await getClient();
  try {
    await notify(client, {
      userId: c.student_id,
      kind: `dropout_recommendation:${c.id}`,
      title: 'Scholarships you can still apply to',
      body: programs
        .map((p) => `${p.title} — ৳${p.amount_per_student}${p.deadline ? `, closes ${new Date(p.deadline).toDateString()}` : ''}`)
        .join('; '),
      dedupHours: 72,
    });
  } finally {
    client.release();
  }
  return { notified: true, programs };
}
