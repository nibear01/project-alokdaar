import { Router } from 'express';
import { z } from 'zod';
import { authJwt, requireRole } from '../../middleware/auth.js';
import * as service from './service.js';

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

const recomputeSchema = z.object({ student_id: z.coerce.number().int().positive().optional() });
const listSchema = z.object({
  level: z.enum(['low', 'medium', 'high']).optional(),
  status: z.enum(['open', 'monitoring', 'resolved']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const noteSchema = z.object({ body: z.string().trim().min(2).max(2000) });
const statusSchema = z.object({ status: z.enum(['open', 'monitoring', 'resolved']) });

const guard = [authJwt, requireRole('provider', 'admin')];

/** POST /api/dropout/recompute — re-score all (or one) students (FR-M3-05) */
router.post('/recompute', ...guard, handle(async (req, res) => {
  res.json(await service.recompute(validate(recomputeSchema, req.body ?? {})));
}));

/** GET /api/dropout/cases — worst first */
router.get('/cases', ...guard, handle(async (req, res) => {
  res.json(await service.listCases(validate(listSchema, req.query)));
}));

/** GET /api/dropout/cases/:id — factors + trend + notes + recommendations */
router.get('/cases/:id', ...guard, handle(async (req, res) => {
  res.json(await service.getCase(Number(req.params.id)));
}));

/** POST /api/dropout/cases/:id/notes — follow-up note */
router.post('/cases/:id/notes', ...guard, handle(async (req, res) => {
  res.status(201).json(await service.addNote(req.user, Number(req.params.id), validate(noteSchema, req.body)));
}));

/** POST /api/dropout/cases/:id/status — open | monitoring | resolved */
router.post('/cases/:id/status', ...guard, handle(async (req, res) => {
  res.json(await service.setStatus(Number(req.params.id), validate(statusSchema, req.body)));
}));

/** POST /api/dropout/cases/:id/recommend — send the student open matches */
router.post('/cases/:id/recommend', ...guard, handle(async (req, res) => {
  res.json(await service.recommend(Number(req.params.id)));
}));

export default router;
