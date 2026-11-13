import { Router } from 'express';
import { z } from 'zod';
import { authJwt, requireRole } from '../../middleware/auth.js';
import * as repo from './repository.js';

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

const summarySchema = z.object({
  program_id: z.coerce.number().int().positive().optional(),
  provider_id: z.coerce.number().int().positive().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

/** GET /api/impact/public — landing headline numbers, no auth (FR-IM-06) */
router.get('/impact/public', handle(async (_req, res) => {
  res.json({ summary: await repo.publicSummary() });
}));

/** GET /api/impact/summary — per-district tile-map data + CSV (FR-IM-01/04) */
router.get(
  '/impact/summary',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const f = validate(summarySchema, req.query);
    // providers see their own slice unless they ask for a programme they own
    const providerId = req.user.role === 'provider' ? req.user.id : f.provider_id ?? null;
    const rows = await repo.byDistrict({
      program_id: f.program_id ?? null,
      provider_id: providerId,
      from: f.from ?? null,
      to: f.to ?? null,
    });
    if (f.format === 'csv') {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [
        'district,students_supported,funds_committed_bdt,funds_raised_bdt,unfunded_eligible,donations',
        ...rows.map((r) => [r.district, r.students_supported, r.funds_committed,
          r.funds_raised, r.unfunded_eligible, r.donations].map(esc).join(',')),
      ].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="impact-by-district.csv"');
      return res.send(csv);
    }
    res.json({ by_district: rows });
  }),
);

/** GET /api/impact/districts/:district — panel + upazila drill-down (FR-IM-03/04) */
router.get(
  '/impact/districts/:district',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const district = String(req.params.district).slice(0, 100);
    res.json({ district, ...(await repo.districtDetail(district)) });
  }),
);

/** GET /api/analytics/overview — funnel, weekly donations, programme progress (M6.8) */
router.get(
  '/analytics/overview',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const providerId = req.user.role === 'provider' ? req.user.id : null;
    res.json(await repo.overview(providerId));
  }),
);

export default router;
