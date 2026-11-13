import { z } from 'zod';

const weightsBase = z.object({
  merit: z.number().int().min(0).max(100),
  need: z.number().int().min(0).max(100),
  attendance: z.number().int().min(0).max(100),
});

const sumHundred = (w) => w.merit + w.need + w.attendance === 100;

export const weightsSchema = weightsBase.refine(sumHundred, {
  message: 'Weights must sum to 100%',
  path: ['sum'],
});

/** Optional per-program normalization params — all optional, positive numbers. */
export const scoringSchema = z
  .object({
    max_cgpa: z.number().positive().max(10).optional(),
    need_reference_income: z.number().positive().max(10000000).optional(),
    attendance_max: z.number().positive().max(1000).optional(),
  })
  .strict();

/** PUT body: weights required (Σ=100), scoring optional. */
export const weightsPutSchema = weightsBase
  .extend({ scoring: scoringSchema.optional() })
  .refine(sumHundred, {
    message: 'Weights must sum to 100%',
    path: ['sum'],
  });

export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const e = new Error('Validation failed');
    e.status = 400;
    e.code = 'VALIDATION_ERROR';
    e.details = result.error.flatten().fieldErrors;
    if (e.details.sum) {
      e.code = 'WEIGHTS_SUM';
      e.message = 'Weights must sum to 100%';
      e.details = undefined;
    }
    throw e;
  }
  return result.data;
}
