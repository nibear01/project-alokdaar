import { Router } from 'express';
import { z } from 'zod';
import { authJwt, requireRole } from '../../middleware/auth.js';
import * as assistant from '../assistant/service.js';
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

const chatSchema = z.object({
  message: z.string().trim().min(2).max(2000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000),
  })).max(20).optional().default([]),
  locale: z.enum(['en', 'bn']).optional().default('en'),
});
const createSchema = z.object({
  category: z.enum(['documents', 'payments', 'applications', 'account', 'other']),
  subject: z.string().trim().min(5).max(200),
  body: z.string().trim().min(10).max(5000),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  application_id: z.coerce.number().int().positive().optional(),
  chat_transcript: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000),
  })).max(40).optional(),
  attachments: z.array(z.object({ name: z.string().max(255), url: z.string().url().max(2000) }))
    .max(5).optional(),
});
const replySchema = z.object({
  body: z.string().trim().min(1).max(5000),
  internal: z.boolean().optional().default(false),
  attachments: z.array(z.object({ name: z.string().max(255), url: z.string().url().max(2000) }))
    .max(5).optional().default([]),
});
const mineSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const inboxSchema = mineSchema.extend({
  category: z.enum(['documents', 'payments', 'applications', 'account', 'other']).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  assignee: z.enum(['unassigned', 'me']).optional(),
});
const statusSchema = z.object({ status: z.enum(['open', 'in_progress', 'resolved', 'closed']) });
const assignSchema = z.object({ assignee_id: z.coerce.number().int().positive().optional() });
const rateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

/** POST /api/assistant/chat — retrieval + Gemini/dev answer (FR-AI-01) */
router.post('/assistant/chat', authJwt, handle(async (req, res) => {
  res.json(await assistant.chat(req.user, validate(chatSchema, req.body)));
}));

/** GET /api/applications/:id/ai-summary — reviewer panel (FR-AI-04, H2-7) */
router.get('/applications/:id/ai-summary', authJwt, requireRole('provider', 'admin'),
  handle(async (req, res) => {
    res.json(await assistant.reviewerSummary(req.user, Number(req.params.id),
      { refresh: req.query.refresh === 'true' }));
  }));

// ---- tickets ----

/** GET /api/tickets — admin inbox with counts (FR-AI-03); place before /:id */
router.get('/tickets', authJwt, requireRole('admin'), handle(async (req, res) => {
  res.json(await service.inbox(req.user, validate(inboxSchema, req.query)));
}));

/** GET /api/tickets/mine — my tickets by status (H2-3) */
router.get('/tickets/mine', authJwt, handle(async (req, res) => {
  res.json(await service.listMine(req.user, validate(mineSchema, req.query)));
}));

/** POST /api/tickets — create / escalate from chat (FR-AI-02, H2-2) */
router.post('/tickets', authJwt, handle(async (req, res) => {
  const ticket = await service.create(req.user, validate(createSchema, req.body));
  res.status(201).json({ ticket });
}));

/** GET /api/tickets/:id — thread (owner sees no internal notes) */
router.get('/tickets/:id', authJwt, handle(async (req, res) => {
  res.json(await service.getTicket(req.user, Number(req.params.id)));
}));

/** POST /api/tickets/:id/messages — reply or internal note (H2-4/H2-6) */
router.post('/tickets/:id/messages', authJwt, handle(async (req, res) => {
  res.status(201).json(await service.reply(req.user, Number(req.params.id),
    validate(replySchema, req.body)));
}));

/** POST /api/tickets/:id/status — admin lifecycle (resolve notifies + asks rating) */
router.post('/tickets/:id/status', authJwt, requireRole('admin'), handle(async (req, res) => {
  res.json(await service.setStatus(req.user, Number(req.params.id),
    validate(statusSchema, req.body)));
}));

/** POST /api/tickets/:id/assign — to someone, or to me when body empty */
router.post('/tickets/:id/assign', authJwt, requireRole('admin'), handle(async (req, res) => {
  res.json(await service.assign(req.user, Number(req.params.id),
    validate(assignSchema, req.body ?? {})));
}));

/** POST /api/tickets/:id/rate — satisfaction rating after resolve (H2-4) */
router.post('/tickets/:id/rate', authJwt, handle(async (req, res) => {
  res.json(await service.rate(req.user, Number(req.params.id), validate(rateSchema, req.body)));
}));

export default router;
