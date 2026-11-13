import { z } from 'zod';

/** GET /api/notifications */
export const listQuerySchema = z.object({
  unread: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** PUT /api/notifications/preferences — in-app cannot be disabled */
export const preferencesSchema = z
  .object({
    email_enabled: z.boolean().optional(),
    sms_enabled: z.boolean().optional(),
  })
  .refine((d) => d.email_enabled !== undefined || d.sms_enabled !== undefined, {
    message: 'Nothing to update',
  });

/**
 * POST /api/notifications/sms/inbound — gateway webhook. Field names differ per
 * provider, so accept the common aliases and normalise in the service.
 */
export const inboundSmsSchema = z
  .object({
    from: z.string().trim().max(32).optional(),
    sender: z.string().trim().max(32).optional(),
    msisdn: z.string().trim().max(32).optional(),
    text: z.string().trim().max(500).optional(),
    message: z.string().trim().max(500).optional(),
    body: z.string().trim().max(500).optional(),
  })
  .transform((d) => ({
    from: d.from ?? d.sender ?? d.msisdn ?? '',
    text: d.text ?? d.message ?? d.body ?? '',
  }));

export function validate(schema, data) {
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
