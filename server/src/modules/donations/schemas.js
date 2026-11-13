import { z } from 'zod';

/** POST /api/donations/order — presets ৳500/1,000/5,000 or custom (Figma R2-3) */
export const orderSchema = z.object({
  program_id: z.coerce.number().int().positive().nullable().optional().default(null),
  amount: z.number().min(10).max(10_000_000),
  tip_amount: z.number().min(0).max(10_000_000).optional().default(0),
  recurring: z.boolean().optional().default(false),
  anonymous: z.boolean().optional().default(false),
  // guest details — required when not signed in (service enforces)
  donor_name: z.string().trim().min(2).max(120).optional(),
  donor_email: z.string().trim().email().max(255).optional(),
  donor_phone: z.string().trim().min(7).max(20).optional(),
});

/** POST /api/donations/ipn — gateway field names (extra keys ignored) */
export const ipnSchema = z
  .object({
    tran_id: z.string().trim().min(1).max(64),
    val_id: z.string().trim().max(128).optional(),
    status: z.string().trim().max(32).optional(),
    amount: z.coerce.number().optional(),
  })
  .passthrough();

export const listCampaignsQuerySchema = z.object({
  closing_soon: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const mineQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /api/providers/donations */
export const providerQuerySchema = z.object({
  program_id: z.coerce.number().int().positive().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  format: z.enum(['json', 'csv']).default('json'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

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
