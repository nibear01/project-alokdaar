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

const bdt = z.number().positive().max(10_000_000);
const scheduleSchema = z
  .object({
    months: z.number().int().min(1).max(36).optional(),
    amount: bdt.optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    custom: z.array(z.object({
      amount: bdt,
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })).min(1).max(36).optional(),
  })
  .refine((d) => d.months || d.custom?.length, { message: 'months or custom[] required' });
const disburseSchema = z.object({
  method: z.enum(['bkash', 'nagad', 'bank', 'cash']),
  ref: z.string().trim().min(3).max(100),
  amount: bdt.optional(),
  note: z.string().trim().max(500).optional(),
});
const voidSchema = z.object({ reason: z.string().trim().min(5).max(1000) });
const pageSchema = z.object({
  program_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const mgmt = [authJwt, requireRole('provider', 'admin')];

/** POST /api/applications/:id/installments — schedule (approved apps; FR-M3-01) */
router.post('/applications/:id/installments', ...mgmt, handle(async (req, res) => {
  res.status(201).json(await service.createSchedule(req.user, Number(req.params.id),
    validate(scheduleSchema, req.body)));
}));

/** GET /api/applications/:id/installments — schedule + totals (student sees own) */
router.get('/applications/:id/installments', authJwt, handle(async (req, res) => {
  res.json(await service.schedule(req.user, Number(req.params.id)));
}));

/** POST /api/installments/:id/disburse — record payment + chain entry (M5.9/10) */
router.post('/installments/:id/disburse', ...mgmt, handle(async (req, res) => {
  res.status(201).json(await service.disburse(req.user, Number(req.params.id),
    validate(disburseSchema, req.body)));
}));

/** POST /api/disbursements/:id/void — reason required; append-only (RULES §2) */
router.post('/disbursements/:id/void', ...mgmt, handle(async (req, res) => {
  res.json(await service.voidDisbursement(req.user, Number(req.params.id),
    validate(voidSchema, req.body)));
}));

/** POST /api/disbursements/:id/confirm-receipt — student (M5.12) */
router.post('/disbursements/:id/confirm-receipt', authJwt, requireRole('student'),
  handle(async (req, res) => {
    res.json(await service.confirmReceipt(req.user, Number(req.params.id)));
  }));

/** GET /api/me/payments — student payment history (M5.12) */
router.get('/me/payments', authJwt, requireRole('student'), handle(async (req, res) => {
  res.json(await service.myPayments(req.user));
}));

/** GET /api/ledger — provider/admin view; /verify walks the chain (M5.10) */
router.get('/ledger', ...mgmt, handle(async (req, res) => {
  res.json(await service.ledger(req.user, validate(pageSchema, req.query)));
}));
router.get('/ledger/verify', ...mgmt, handle(async (_req, res) => {
  res.json(await service.verify());
}));

/** GET /api/ledger/public — anonymised, no auth (trust & transparency band) */
router.get('/ledger/public', handle(async (req, res) => {
  res.json(await service.publicLedger(validate(pageSchema, req.query)));
}));

/** POST /api/applications/:id/award-letter — issue (idempotent) (M5.11) */
router.post('/applications/:id/award-letter', ...mgmt, handle(async (req, res) => {
  const result = await service.issueAward(req.user, Number(req.params.id));
  res.status(result.created ? 201 : 200).json(result);
}));

/** GET /api/applications/:id/award-letter?format=html — printable + QR */
router.get('/applications/:id/award-letter', authJwt, handle(async (req, res) => {
  const result = await service.awardLetter(req.user, Number(req.params.id), req.query.format);
  if (result.html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(result.html);
  }
  res.json(result);
}));

/** GET /api/verify/award/:code — public authenticity page (initials only) */
router.get('/verify/award/:code', handle(async (req, res) => {
  res.json(await service.verifyAward(String(req.params.code).slice(0, 64)));
}));

export default router;
