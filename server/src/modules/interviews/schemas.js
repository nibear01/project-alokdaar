import { z } from 'zod';

/** Weekly slot template — FR-RS-06 weekly slot picker */
export const slotCreateSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'HH:MM or HH:MM:SS'),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'HH:MM or HH:MM:SS'),
  duration_minutes: z.number().int().min(5).max(480).default(30),
}).refine((v) => v.end_time > v.start_time, {
  message: 'end_time must be after start_time',
  path: ['end_time'],
});

export const slotQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

/** New interview form — direct datetime (picked from expanded weekly slots) */
export const interviewCreateSchema = z.object({
  slot_start: z.string().datetime({ offset: true }),
  duration_minutes: z.number().int().min(5).max(480).optional(),
  mode: z.enum(['online', 'in_person', 'phone']).default('online'),
  notes: z.string().trim().max(2000).optional(),
});

export const rescheduleSchema = z.object({
  slot_start: z.string().datetime({ offset: true }),
  duration_minutes: z.number().int().min(5).max(480).optional(),
  mode: z.enum(['online', 'in_person', 'phone']).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/** FR-RS-09 student asks for another slot */
export const requestSlotSchema = z.object({
  proposed_slot_start: z.string().datetime({ offset: true }),
  note: z.string().trim().max(1000).optional(),
});

export const interviewStatusSchema = z.object({
  status: z.enum(['completed', 'no_show', 'cancelled']),
  notes: z.string().trim().max(2000).optional(),
});

export const bucketQuerySchema = z.object({
  bucket: z.enum(['upcoming', 'past', 'no_show', 'reschedule_requested']).default('upcoming'),
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
