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

const searchSchema = z.object({
  search: z.string().trim().max(200).optional(),
  district: z.string().trim().max(100).optional(),
  education_level: z.string().trim().max(50).optional(),
  min_amount: z.coerce.number().positive().optional(),
  deadline_within_days: z.coerce.number().int().min(1).max(365).optional(),
  eligible: z.enum(['true', 'false']).optional(),
  sort: z.enum(['deadline', 'amount', 'newest']).default('deadline'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
const createDraftSchema = z.object({ program_id: z.coerce.number().int().positive() });
const statementSchema = z.object({ statement: z.string().max(10_000) });
const mineSchema = z.object({
  status: z.enum(['draft', 'submitted', 'under_review', 'shortlisted',
    'approved', 'waitlisted', 'rejected', 'withdrawn']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const student = [authJwt, requireRole('student')];

/** GET /api/discovery/programs — find scholarships (FR-DA-01/02) */
router.get('/programs', ...student, handle(async (req, res) => {
  res.json(await service.search(req.user, validate(searchSchema, req.query)));
}));

/** GET /api/discovery/programs/:id — detail + checklist + can_apply (FR-DA-05) */
router.get('/programs/:id', ...student, handle(async (req, res) => {
  res.json(await service.detail(req.user, Number(req.params.id)));
}));

/** PUT/DELETE /api/discovery/bookmarks/:programId (FR-DA-03) */
router.put('/bookmarks/:programId', ...student, handle(async (req, res) => {
  res.json(await service.bookmark(req.user, Number(req.params.programId), true));
}));
router.delete('/bookmarks/:programId', ...student, handle(async (req, res) => {
  res.json(await service.bookmark(req.user, Number(req.params.programId), false));
}));

/** GET /api/discovery/bookmarks — saved list with live eligibility */
router.get('/bookmarks', ...student, handle(async (req, res) => {
  res.json(await service.bookmarks(req.user));
}));

/** POST /api/discovery/applications — start the 4-step wizard (FR-DA-04) */
router.post('/applications', ...student, handle(async (req, res) => {
  const draft = await service.createDraft(req.user, validate(createDraftSchema, req.body));
  res.status(201).json({ application: draft });
}));

/** GET /api/discovery/applications — My Applications tabs (FR-DA-06) */
router.get('/applications', ...student, handle(async (req, res) => {
  res.json(await service.listMine(req.user, validate(mineSchema, req.query)));
}));

/** GET /api/discovery/applications/:id — own detail + timeline */
router.get('/applications/:id', ...student, handle(async (req, res) => {
  res.json(await service.getMine(req.user, Number(req.params.id)));
}));

/** PATCH /api/discovery/applications/:id — statement autosave / pre-deadline edit */
router.patch('/applications/:id', ...student, handle(async (req, res) => {
  res.json(await service.saveStatement(req.user, Number(req.params.id),
    validate(statementSchema, req.body)));
}));

/** POST /api/discovery/applications/:id/submit — step 4 confirm (FR-DA-04) */
router.post('/applications/:id/submit', ...student, handle(async (req, res) => {
  res.json({ application: await service.submit(req.user, Number(req.params.id)) });
}));

/** DELETE /api/discovery/applications/:id — discard a draft */
router.delete('/applications/:id', ...student, handle(async (req, res) => {
  res.json(await service.discardDraft(req.user, Number(req.params.id)));
}));

export default router;
