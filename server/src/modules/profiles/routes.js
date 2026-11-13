import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { authJwt, requireRole } from '../../middleware/auth.js';

/**
 * Student profile (district/upazila/level/institution) — the impact map and
 * dropout recommendations aggregate on this. Carved out here to unblock M6.1;
 * Rafi's M2.9 academic/household CRUD extends the same table.
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

const profileSchema = z
  .object({
    district: z.string().trim().min(2).max(100).nullable().optional(),
    upazila: z.string().trim().min(2).max(100).nullable().optional(),
    education_level: z.string().trim().min(2).max(50).nullable().optional(),
    institution: z.string().trim().min(2).max(200).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

/** GET /api/me/profile — profile + latest academic/household snapshot */
router.get(
  '/profile',
  authJwt,
  requireRole('student'),
  handle(async (req, res) => {
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.phone, u.locale,
              sp.district, sp.upazila, sp.education_level, sp.institution,
              (SELECT to_jsonb(la) FROM latest_academic la WHERE la.student_id = u.id) AS academic,
              (SELECT to_jsonb(lh) FROM latest_household lh WHERE lh.student_id = u.id) AS household
       FROM users u
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id],
    );
    res.json({ profile: rows[0] });
  }),
);

/** PUT /api/me/profile — upsert district/upazila/level/institution */
router.put(
  '/profile',
  authJwt,
  requireRole('student'),
  handle(async (req, res) => {
    const result = profileSchema.safeParse(req.body);
    if (!result.success) {
      const err = new Error('Validation failed');
      err.status = 400;
      err.code = 'VALIDATION_ERROR';
      err.details = result.error.flatten().fieldErrors;
      throw err;
    }
    const d = result.data;
    const { rows } = await query(
      `INSERT INTO student_profiles (user_id, district, upazila, education_level, institution)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         district        = COALESCE($2, student_profiles.district),
         upazila         = COALESCE($3, student_profiles.upazila),
         education_level = COALESCE($4, student_profiles.education_level),
         institution     = COALESCE($5, student_profiles.institution),
         updated_at      = now()
       RETURNING *`,
      [req.user.id, d.district ?? null, d.upazila ?? null, d.education_level ?? null, d.institution ?? null],
    );
    res.json({ profile: rows[0] });
  }),
);

export default router;
