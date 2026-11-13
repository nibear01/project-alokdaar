import { Router } from 'express';
import { z } from 'zod';
import { getClient, query } from '../../config/db.js';
import { notify } from '../../lib/notify.js';
import { authJwt, requireRole } from '../../middleware/auth.js';

/**
 * Academic & household records CRUD + renewal hook (M2.9/M2.10, FR-M1-03).
 * New academic terms feed ranking, eligibility and dropout scoring; providers
 * of the student's approved programmes are notified of each renewal upload.
 */
const router = Router();

function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
}

function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const err = new Error('Validation failed');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = result.error.flatten().fieldErrors;
    throw err;
  }
  return result.data;
}

const academicSchema = z.object({
  term: z.string().trim().min(2).max(40),
  cgpa: z.number().min(0).max(4).nullable().optional(),
  attendance_pct: z.number().min(0).max(100).nullable().optional(),
  institution: z.string().trim().min(2).max(200).nullable().optional(),
});
const householdSchema = z.object({
  family_size: z.number().int().min(1).max(30),
  earners: z.number().int().min(0).max(30),
  monthly_income: z.number().min(0).max(10_000_000),
  source: z.string().trim().max(200).nullable().optional(),
});

const student = [authJwt, requireRole('student')];

/** GET /api/me/records — full academic history + household snapshots */
router.get('/records', ...student, handle(async (req, res) => {
  const [academic, household] = await Promise.all([
    query(`SELECT id, term, cgpa, attendance_pct, institution, created_at
           FROM academic_records WHERE student_id = $1 ORDER BY term`, [req.user.id]),
    query(`SELECT id, family_size, earners, monthly_income, source, created_at
           FROM household_records WHERE student_id = $1 ORDER BY created_at DESC`, [req.user.id]),
  ]);
  res.json({ academic: academic.rows, household: household.rows });
}));

/** POST /api/me/academic — add/replace a term (renewal upload, M2.10) */
router.post('/academic', ...student, handle(async (req, res) => {
  const d = validate(academicSchema, req.body);
  const { rows } = await query(
    `INSERT INTO academic_records (student_id, term, cgpa, attendance_pct, institution)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (student_id, term) DO UPDATE SET
       cgpa = $3, attendance_pct = $4,
       institution = COALESCE($5, academic_records.institution),
       updated_at = now()
     RETURNING *`,
    [req.user.id, d.term, d.cgpa ?? null, d.attendance_pct ?? null, d.institution ?? null],
  );

  // renewal: tell providers holding this student's approved applications
  const { rows: providers } = await query(
    `SELECT DISTINCT p.provider_id, p.title, a.id AS application_id
     FROM applications a JOIN programs p ON p.id = a.program_id
     WHERE a.student_id = $1 AND a.status = 'approved'`,
    [req.user.id],
  );
  for (const pr of providers) {
    const client = await getClient();
    try {
      await notify(client, {
        userId: pr.provider_id,
        applicationId: pr.application_id,
        kind: `renewal_upload:${req.user.id}:${d.term}`,
        title: `Renewal record uploaded — ${pr.title}`,
        body: `${req.user.name} added term ${d.term}${d.cgpa != null ? ` (CGPA ${d.cgpa})` : ''}. Review it before the next installment.`,
        dedupHours: 24,
      });
    } finally {
      client.release();
    }
  }
  res.status(201).json({ record: rows[0], providers_notified: providers.length });
}));

/** POST /api/me/household — append a new snapshot (history kept) */
router.post('/household', ...student, handle(async (req, res) => {
  const d = validate(householdSchema, req.body);
  const { rows } = await query(
    `INSERT INTO household_records (student_id, family_size, earners, monthly_income, source)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.id, d.family_size, d.earners, d.monthly_income, d.source ?? null],
  );
  res.status(201).json({ record: rows[0] });
}));

export default router;
