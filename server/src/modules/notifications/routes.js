import { Router } from 'express';
import { authJwt } from '../../middleware/auth.js';
import {
  listQuerySchema,
  preferencesSchema,
  inboundSmsSchema,
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

/** GET /api/notifications — my center + unread badge (FR-M2-03) */
router.get(
  '/',
  authJwt,
  handle(async (req, res) => {
    const filters = validate(listQuerySchema, req.query);
    res.json(await service.listMine(req.user, filters));
  }),
);

/** GET /api/notifications/preferences */
router.get(
  '/preferences',
  authJwt,
  handle(async (req, res) => {
    res.json({ preferences: await service.getPreferences(req.user) });
  }),
);

/** PUT /api/notifications/preferences — email/SMS toggles (in-app always on) */
router.put(
  '/preferences',
  authJwt,
  handle(async (req, res) => {
    const data = validate(preferencesSchema, req.body);
    res.json(await service.updatePreferences(req.user, data));
  }),
);

/** POST /api/notifications/read-all */
router.post(
  '/read-all',
  authJwt,
  handle(async (req, res) => {
    res.json(await service.markAllRead(req.user));
  }),
);

/** POST /api/notifications/:id/read */
router.post(
  '/:id/read',
  authJwt,
  handle(async (req, res) => {
    res.json(await service.markRead(req.user, Number(req.params.id)));
  }),
);

/**
 * POST /api/notifications/sms/inbound — SMS gateway webhook (no JWT; optional
 * shared secret via SMS_WEBHOOK_SECRET). "STATUS <application_id>" → SMS reply.
 */
router.post(
  '/sms/inbound',
  handle(async (req, res) => {
    service.assertWebhookSecret(req);
    const data = validate(inboundSmsSchema, req.body ?? {});
    res.json(await service.handleInboundSms(data));
  }),
);

export default router;
