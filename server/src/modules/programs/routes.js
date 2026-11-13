import { Router } from 'express';
import { authJwt, requireRole } from '../../middleware/auth.js';
import {
  createProgramSchema,
  updateProgramSchema,
  listProgramsQuerySchema,
  validate,
} from './schemas.js';
import * as service from './service.js';
import * as rankingService from '../ranking/service.js';
import { weightsPutSchema, validate as validateRanking } from '../ranking/schemas.js';
import * as applicationService from '../applications/service.js';
import { queueQuerySchema, bulkDecideSchema, validate as validateQueue } from '../applications/schemas.js';

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

/** POST /api/programs — provider creates a draft (FR-M1-02) */
router.post(
  '/',
  authJwt,
  requireRole('provider'),
  handle(async (req, res) => {
    const data = validate(createProgramSchema, req.body);
    const program = await service.createProgram(req.user.id, data);
    res.status(201).json({ program });
  }),
);

/** GET /api/programs — list (provider: own; admin: all; mine= query) */
router.get(
  '/',
  authJwt,
  handle(async (req, res) => {
    const query = validate(listProgramsQuerySchema, req.query);
    const result = await service.listPrograms(req.user, query);
    res.json(result);
  }),
);

/** GET /api/programs/:id */
router.get(
  '/:id',
  authJwt,
  handle(async (req, res) => {
    const program = await service.getOwnedProgram(Number(req.params.id), req.user);
    res.json({ program });
  }),
);

/** PATCH /api/programs/:id — draft only */
router.patch(
  '/:id',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const data = validate(updateProgramSchema, req.body);
    const program = await service.updateProgram(Number(req.params.id), req.user, data);
    res.json({ program });
  }),
);

/** POST /api/programs/:id/publish | pause | resume | close */
for (const action of ['publish', 'pause', 'resume', 'close']) {
  router.post(
    `/:id/${action}`,
    authJwt,
    requireRole('provider', 'admin'),
    handle(async (req, res) => {
      const program = await service.transition(Number(req.params.id), req.user, action);
      res.json({ program, transitioned: action });
    }),
  );
}

/** POST /api/programs/:id/bulk-decide — bulk shortlist/reject (FR-RS-01) */
router.post(
  '/:id/bulk-decide',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const input = validateQueue(bulkDecideSchema, req.body);
    const result = await applicationService.bulkDecide(Number(req.params.id), req.user, input);
    res.json(result);
  }),
);

/** GET /api/programs/:id/applications — review queue (FR-RS-01) */
router.get(
  '/:id/applications',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const filters = validateQueue(queueQuerySchema, req.query);
    const result = await applicationService.getQueue(Number(req.params.id), req.user, filters);
    res.json(result);
  }),
);

/** GET /api/programs/:id/weights — weights + scoring config — FR-RS-02 */
router.get(
  '/:id/weights',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    await service.getOwnedProgram(Number(req.params.id), req.user);
    const result = await rankingService.getProgramWeights(Number(req.params.id));
    res.json(result);
  }),
);

/** PUT /api/programs/:id/weights — Σ=100, optional scoring config, re-ranks — FR-RS-02 */
router.put(
  '/:id/weights',
  authJwt,
  requireRole('provider', 'admin'),
  handle(async (req, res) => {
    const { scoring, ...weights } = validateRanking(weightsPutSchema, req.body);
    const result = await rankingService.saveWeightsAndRerank(Number(req.params.id), req.user, {
      weights,
      scoring,
    });
    res.json(result);
  }),
);

export default router;
