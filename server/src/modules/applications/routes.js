import { Router } from 'express';
import { authJwt, requireRole } from '../../middleware/auth.js';
import { queueQuerySchema, decideSchema, withdrawSchema, validate } from './schemas.js';
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

/**
 * POST /api/applications/:id/pre-approve-check — FR-RS-04
 * Duplicate-aid conflict lookup before approval (Sequence 1, steps 8–11).
 */
router.post(
  '/:id/pre-approve-check',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const result = await service.preApproveCheck(Number(req.params.id), req.user);
    res.json(result);
  }),
);

/**
 * POST /api/applications/:id/decide — FR-RS-05
 * Body: { decision: shortlist|approve|reject|waitlist, remarks?, message?, force_reason?, position? }
 */
router.post(
  '/:id/decide',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const input = validate(decideSchema, req.body);
    const result = await service.decide(Number(req.params.id), req.user, input);
    res.json(result);
  }),
);

/** POST /api/applications/:id/withdraw — FR-DA-05 + auto-promote FR-RS-08 */
router.post(
  '/:id/withdraw',
  authJwt,
  requireRole('student'),
  handle(async (req, res) => {
    const input = validate(withdrawSchema, req.body ?? {});
    const result = await service.withdraw(Number(req.params.id), req.user, input);
    res.json(result);
  }),
);

/** GET /api/applications/:id — applicant detail + breakdown + trend (FR-RS-03) */
router.get(
  '/:id',
  authJwt,
  handle(async (req, res) => {
    const result = await service.getDetail(Number(req.params.id), req.user);
    res.json(result);
  }),
);

export default router;
