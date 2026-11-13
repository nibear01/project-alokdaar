import { Router } from 'express';
import { authJwt, requireRole } from '../../middleware/auth.js';
import { verifyAccessToken } from '../../utils/tokens.js';
import {
  orderSchema,
  ipnSchema,
  listCampaignsQuerySchema,
  mineQuerySchema,
  providerQuerySchema,
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

/** Attach req.user when a valid token is present; stay anonymous otherwise. */
function authOptional(req, _res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Bearer' && token) {
    try {
      const p = verifyAccessToken(token);
      req.user = { id: Number(p.sub), role: p.role, name: p.name };
    } catch {
      /* anonymous */
    }
  }
  next();
}

// ---- public campaign pages ----

/** GET /api/campaigns — cards + general fund (FR-DN-01) */
router.get(
  '/campaigns',
  handle(async (req, res) => {
    const filters = validate(listCampaignsQuerySchema, req.query);
    res.json(await service.listCampaigns(filters));
  }),
);

/** GET /api/campaigns/:id — detail + recent anonymised donations (FR-DN-02) */
router.get(
  '/campaigns/:id',
  handle(async (req, res) => {
    res.json(await service.campaignDetail(Number(req.params.id)));
  }),
);

// ---- checkout + gateway ----

/** POST /api/donations/order — signed-in or guest (FR-DN-03) */
router.post(
  '/donations/order',
  authOptional,
  handle(async (req, res) => {
    const data = validate(orderSchema, req.body);
    res.status(201).json(await service.createOrder(req.user ?? null, data));
  }),
);

/** POST /api/donations/ipn — SSLCommerz webhook; urlencoded or JSON (FR-DN-09) */
router.post(
  '/donations/ipn',
  handle(async (req, res) => {
    const data = validate(ipnSchema, req.body ?? {});
    res.json(await service.handleIpn(data));
  }),
);

/** POST /api/donations/:id/dev-confirm — simulate validated IPN (dev only) */
router.post(
  '/donations/:id/dev-confirm',
  handle(async (req, res) => {
    res.json(await service.devConfirm(Number(req.params.id)));
  }),
);

/** GET /api/donations/:id/status?tran_id=… — verifying screen poll (FR-DN-04) */
router.get(
  '/donations/:id/status',
  authOptional,
  handle(async (req, res) => {
    res.json(await service.statusOf(req.user ?? null, Number(req.params.id), req.query.tran_id));
  }),
);

// ---- donor account ----

/** GET /api/donations/mine — history + recurring list (FR-DN-06) */
router.get(
  '/donations/mine',
  authJwt,
  handle(async (req, res) => {
    const filters = validate(mineQuerySchema, req.query);
    res.json(await service.listMine(req.user, filters));
  }),
);

/** POST /api/donations/:id/recurring/pause|resume|cancel (FR-DN-06) */
for (const action of ['pause', 'resume', 'cancel']) {
  router.post(
    `/donations/:id/recurring/${action}`,
    authJwt,
    handle(async (req, res) => {
      res.json(await service.setRecurring(req.user, Number(req.params.id), action));
    }),
  );
}

/** GET /api/donations/:id/receipt — printable JSON (FR-DN-05) */
router.get(
  '/donations/:id/receipt',
  authJwt,
  handle(async (req, res) => {
    res.json(await service.receipt(req.user, Number(req.params.id)));
  }),
);

/** GET /api/donations/impact — anonymised donor impact (FR-DN-07) */
router.get(
  '/donations/impact',
  authJwt,
  handle(async (req, res) => {
    res.json({ impact: await service.donorImpact(req.user) });
  }),
);

// ---- provider ----

/** GET /api/providers/donations?format=csv — received + split + export (FR-DN-08) */
router.get(
  '/providers/donations',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const filters = validate(providerQuerySchema, req.query);
    const result = await service.providerReceived(req.user, filters);
    if (result.csv !== undefined) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="donations.csv"');
      return res.send(result.csv);
    }
    res.json(result);
  }),
);

export default router;
