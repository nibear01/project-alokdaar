import { z } from 'zod';

export const queueQuerySchema = z.object({
  status: z
    .enum(['submitted', 'under_review', 'shortlisted', 'approved', 'waitlisted', 'rejected', 'withdrawn'])
    .optional(),
  search: z.string().trim().max(120).optional(),
  duplicate: z.enum(['true', 'false']).optional(),
  sort: z.enum(['rank', 'score', 'submitted_at']).default('rank'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** FR-RS-05 decision modals */
export const decideSchema = z
  .object({
    decision: z.enum(['shortlist', 'approve', 'reject', 'waitlist']),
    remarks: z.string().trim().min(3).max(1000).optional(),
    message: z.string().trim().max(1000).optional(),
    force_reason: z.string().trim().min(3).max(1000).optional(),
    position: z.number().int().min(1).optional(),
    committed_amount: z.number().nonnegative().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.decision === 'reject' && !val.remarks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['remarks'],
        message: 'Remarks are required to reject',
      });
    }
    if (val.decision === 'waitlist' && !val.remarks && !val.position) {
      // position optional (auto next); remarks optional — nothing required
    }
  });

/** FR-RS-01 bulk shortlist/reject */
export const bulkDecideSchema = z.object({
  application_ids: z.array(z.number().int().positive()).min(1).max(100),
  decision: z.enum(['shortlist', 'reject']),
  remarks: z.string().trim().min(3).max(1000).optional(),
}).superRefine((val, ctx) => {
  if (val.decision === 'reject' && !val.remarks) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['remarks'],
      message: 'Remarks are required to reject',
    });
  }
});

export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const e = new Error('Validation failed');
    e.status = 400;
    e.code = 'VALIDATION_ERROR';
    e.details = result.error.flatten().fieldErrors;
    throw e;
  }
  return result.data;
}
