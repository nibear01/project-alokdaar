import { Router } from 'express';
import { authJwt, requireRole } from '../../middleware/auth.js';
import {
  uploadSignSchema,
  registerSchema,
  confirmSchema,
  rejectSchema,
  queueQuerySchema,
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

// ---- admin queue (before /:id) ----

/** GET /api/documents/queue — verification queue + counts (FR-DV-05) */
router.get(
  '/queue',
  authJwt,
  requireRole('admin'),
  handle(async (req, res) => {
    const filters = validate(queueQuerySchema, req.query);
    res.json(await service.adminQueue(filters));
  }),
);

// ---- student vault ----

/** GET /api/documents — my vault + progress (FR-DV-04) */
router.get(
  '/',
  authJwt,
  requireRole('student'),
  handle(async (req, res) => {
    res.json(await service.listMine(req.user));
  }),
);

/** POST /api/documents/upload-sign — presigned Cloudinary params (FR-DV-01) */
router.post(
  '/upload-sign',
  authJwt,
  requireRole('student'),
  handle(async (req, res) => {
    const data = validate(uploadSignSchema, req.body);
    res.json(service.requestUploadSign(req.user, data));
  }),
);

/** POST /api/documents — register upload, kick OCR (FR-DV-01/02) */
router.post(
  '/',
  authJwt,
  requireRole('student'),
  handle(async (req, res) => {
    const data = validate(registerSchema, req.body);
    const document = await service.registerUpload(req.user, data);
    res.status(201).json({ document });
  }),
);

/** GET /api/documents/:id — detail + verification history (student own / admin) */
router.get(
  '/:id',
  authJwt,
  requireRole('student', 'admin'),
  handle(async (req, res) => {
    res.json(await service.getDocument(req.user, Number(req.params.id)));
  }),
);

/** POST /api/documents/:id/confirm — resolve OCR mismatches → pending (FR-DV-02) */
router.post(
  '/:id/confirm',
  authJwt,
  requireRole('student'),
  handle(async (req, res) => {
    const data = validate(confirmSchema, req.body);
    const document = await service.confirmMismatch(req.user, Number(req.params.id), data);
    res.json({ document });
  }),
);

/** DELETE /api/documents/:id — soft delete own document (FR-DV-01) */
router.delete(
  '/:id',
  authJwt,
  requireRole('student'),
  handle(async (req, res) => {
    res.json(await service.removeDocument(req.user, Number(req.params.id)));
  }),
);

// ---- admin decisions ----

/** POST /api/documents/:id/verify (FR-DV-05) */
router.post(
  '/:id/verify',
  authJwt,
  requireRole('admin'),
  handle(async (req, res) => {
    const document = await service.verifyDocument(req.user, Number(req.params.id));
    res.json({ document });
  }),
);

/** POST /api/documents/:id/reject — reason required (FR-DV-05, RULES §2) */
router.post(
  '/:id/reject',
  authJwt,
  requireRole('admin'),
  handle(async (req, res) => {
    const data = validate(rejectSchema, req.body);
    const document = await service.rejectDocument(req.user, Number(req.params.id), data);
    res.json({ document });
  }),
);

export default router;
