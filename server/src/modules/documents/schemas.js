import { z } from 'zod';

export const DOCUMENT_KINDS = [
  'birth_certificate',
  'transcript',
  'income_certificate',
  'institution_id',
];

const kind = z.enum(DOCUMENT_KINDS);

// Figma H1-2: "PDF, JPG or PNG · max 5 MB"
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const mime = z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const fileName = z.string().trim().min(1).max(255);
const fileSize = z.number().int().positive().max(MAX_FILE_BYTES);

/** POST /api/documents/upload-sign */
export const uploadSignSchema = z.object({
  kind,
  file_name: fileName,
  mime_type: mime,
  file_size_bytes: fileSize,
});

/** POST /api/documents — register after the client-side Cloudinary upload */
export const registerSchema = z
  .object({
    kind,
    file_name: fileName,
    mime_type: mime,
    file_size_bytes: fileSize,
    cloudinary_public_id: z.string().trim().min(1).max(255).optional(),
    // dev fallback only (Cloudinary unconfigured) — service enforces it
    file_url: z.string().trim().url().max(2000).optional(),
    replace: z.boolean().optional().default(false),
  })
  .refine((d) => d.cloudinary_public_id || d.file_url, {
    message: 'cloudinary_public_id (or file_url in dev) is required',
    path: ['cloudinary_public_id'],
  });

/** POST /api/documents/:id/confirm — resolve OCR mismatches (H1-4) */
export const confirmSchema = z.object({
  resolutions: z
    .record(
      z.enum(['full_name', 'cgpa', 'institution', 'monthly_income']),
      z.enum(['document', 'profile']),
    )
    .refine((r) => Object.keys(r).length > 0, { message: 'At least one resolution required' }),
});

/** POST /api/documents/:id/reject — remarks required (RULES §2 Documents) */
export const rejectSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
});

/** GET /api/documents/queue — admin verification queue (FR-DV-05) */
export const queueQuerySchema = z.object({
  status: z.enum(['processing', 'action_required', 'pending', 'verified', 'rejected']).optional(),
  kind: kind.optional(),
  mismatch: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(['oldest', 'newest']).default('oldest'),
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
