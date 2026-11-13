import { z } from 'zod';

const bdt = z.number().nonnegative().max(999999999);

export const createProgramSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).optional().default(''),
  criteria: z
    .object({
      min_cgpa: z.number().min(0).max(4).optional(),
      max_household_income: z.number().nonnegative().optional(),
      districts: z.array(z.string().trim().min(1)).optional(),
      education_levels: z.array(z.string().trim().min(1)).optional(),
    })
    .optional()
    .default({}),
  total_fund: bdt.default(0),
  amount_per_student: bdt.default(0),
  seats: z.number().int().nonnegative().default(0),
  required_docs: z.array(z.string().trim()).optional().default([]),
  deadline: z.string().datetime({ offset: true }).optional().nullable(),
  location_district: z.string().trim().max(100).optional().nullable(),
  education_level: z.string().trim().max(50).optional().nullable(),
});

export const updateProgramSchema = createProgramSchema.partial().extend({
  status: z.never().optional(), // status changes only via lifecycle endpoints
});

export const listProgramsQuerySchema = z.object({
  status: z.enum(['draft', 'open', 'paused', 'closed']).optional(),
  mine: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
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
