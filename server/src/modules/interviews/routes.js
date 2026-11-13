import { Router } from 'express';
import { authJwt, requireRole } from '../../middleware/auth.js';
import {
  slotCreateSchema,
  slotQuerySchema,
  interviewCreateSchema,
  rescheduleSchema,
  requestSlotSchema,
  interviewStatusSchema,
  bucketQuerySchema,
  validate,
} from './schemas.js';
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

// --- weekly slot templates (FR-RS-06) ---

router.get(
  '/programs/:id/slots',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    res.json(await service.getSlots(Number(req.params.id), req.user));
  }),
);

router.post(
  '/programs/:id/slots',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const input = validate(slotCreateSchema, req.body);
    res.status(201).json(await service.addSlot(Number(req.params.id), req.user, input));
  }),
);

router.delete(
  '/slots/:id',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    res.json(await service.removeSlot(Number(req.params.id), req.user));
  }),
);

router.get(
  '/programs/:id/slots/available',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const q = validate(slotQuerySchema, req.query);
    res.json(await service.availableSlots(Number(req.params.id), req.user, q));
  }),
);

// --- scheduling (FR-RS-06) ---

router.post(
  '/applications/:id/interview',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const input = validate(interviewCreateSchema, req.body);
    const result = await service.schedule(Number(req.params.id), req.user, input);
    res.status(201).json(result);
  }),
);

router.get(
  '/applications/:id/interview',
  authJwt,
  handle(async (req, res) => {
    const { pool } = await import('../../config/db.js');
    const { rows } = await pool.query(
      `SELECT i.*, p.title AS program_title
       FROM interviews i
       JOIN applications a ON a.id = i.application_id
       JOIN programs p ON p.id = i.program_id
       WHERE i.application_id = $1
       ORDER BY i.slot_start DESC`,
      [Number(req.params.id)],
    );
    if (req.user.role === 'student') {
      const { rows: own } = await pool.query(`SELECT student_id FROM applications WHERE id = $1`, [
        Number(req.params.id),
      ]);
      if (!own[0] || Number(own[0].student_id) !== req.user.id) {
        const e = new Error('Not your application');
        e.status = 403;
        e.code = 'FORBIDDEN';
        throw e;
      }
    }
    res.json({ interviews: rows });
  }),
);

// --- list (FR-RS-07) ---

router.get(
  '/programs/:id/interviews',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const { bucket } = validate(bucketQuerySchema, req.query);
    res.json(await service.listForProgram(Number(req.params.id), req.user, bucket));
  }),
);

router.get(
  '/interviews/mine',
  authJwt,
  requireRole('student'),
  handle(async (req, res) => {
    res.json(await service.listMine(req.user));
  }),
);

// --- reschedule / outcomes (FR-RS-07) ---

router.post(
  '/interviews/:id/reschedule',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const input = validate(rescheduleSchema, req.body);
    res.json(await service.reschedule(Number(req.params.id), req.user, input));
  }),
);

router.post(
  '/interviews/:id/status',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const input = validate(interviewStatusSchema, req.body);
    res.json(await service.setStatus(Number(req.params.id), req.user, input));
  }),
);

// --- student slot request (FR-RS-09) ---

router.post(
  '/interviews/:id/request-slot',
  authJwt,
  requireRole('student'),
  handle(async (req, res) => {
    const input = validate(requestSlotSchema, req.body);
    res.json(await service.requestSlot(Number(req.params.id), req.user, input));
  }),
);

export default router;
