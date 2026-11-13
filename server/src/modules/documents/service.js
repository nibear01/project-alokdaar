import { getClient } from '../../config/db.js';
import { notify } from '../../lib/notify.js';
import * as cloudinary from '../../services/cloudinary.js';
import * as ocr from '../../services/ocr.js';
import * as repo from './repository.js';
import { DOCUMENT_KINDS } from './schemas.js';

function err(message, code, status = 400, details) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  if (details) e.details = details;
  return e;
}

const KIND_LABELS = {
  birth_certificate: 'Birth Certificate',
  transcript: 'Transcript',
  income_certificate: 'Income Certificate',
  institution_id: 'Institution ID',
};

function assertOwnDocument(doc, user) {
  if (!doc || doc.deleted_at) throw err('Document not found', 'NOT_FOUND', 404);
  if (user.role === 'student' && Number(doc.student_id) !== user.id) {
    throw err('Not your document', 'FORBIDDEN', 403);
  }
}

// ---------------------------------------------------------------- student side

/** Presigned Cloudinary params (FR-DV-01). Dev fallback: register with file_url. */
export function requestUploadSign(user, data) {
  if (!cloudinary.isConfigured()) {
    return {
      dev: true,
      message:
        'Cloudinary is not configured — POST /api/documents with a file_url instead (dev only)',
    };
  }
  const publicId = `doc_${user.id}_${data.kind}_${Date.now()}`;
  return {
    dev: false,
    ...cloudinary.signUpload({ folder: `alokdaar/documents/${user.id}`, publicId }),
  };
}

/**
 * Register an uploaded file → status 'processing', then run OCR + profile compare
 * (ARCHITECTURE §5.4). Replaces any active document of the same kind when
 * `replace: true` (re-upload after reject, or Replace in the preview modal).
 */
export async function registerUpload(user, data) {
  if (data.file_url && !data.cloudinary_public_id) {
    if (process.env.NODE_ENV === 'production' || cloudinary.isConfigured()) {
      throw err('Direct file_url uploads are dev-only', 'CLOUDINARY_REQUIRED', 400);
    }
  }

  const existing = await repo.findActive(user.id, data.kind);
  if (existing && !data.replace) {
    throw err(
      `You already have a ${KIND_LABELS[data.kind]} — pass replace: true to supersede it`,
      'DOCUMENT_EXISTS',
      409,
      { existing_id: existing.id, existing_status: existing.status },
    );
  }

  const client = await getClient();
  let doc;
  try {
    await client.query('BEGIN');
    if (existing) {
      await repo.supersede(client, existing.id);
      await repo.insertEvent(client, {
        documentId: existing.id,
        from: existing.status,
        to: existing.status,
        actorId: user.id,
        note: 'superseded_by_replacement',
      });
    }
    doc = await repo.insertDocument(client, {
      student_id: user.id,
      kind: data.kind,
      cloudinary_public_id: data.cloudinary_public_id,
      file_url:
        data.file_url ??
        (data.cloudinary_public_id ? cloudinary.urlFor(data.cloudinary_public_id) : null),
      file_name: data.file_name,
      mime_type: data.mime_type,
      file_size_bytes: data.file_size_bytes,
      supersedes_id: existing?.id ?? null,
    });
    await repo.insertEvent(client, {
      documentId: doc.id,
      from: null,
      to: 'processing',
      actorId: user.id,
      note: existing ? 'reuploaded' : 'uploaded',
    });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // fire-and-forget: OCR must never block the upload response
  runOcr(doc.id).catch((e) => console.error(`[documents] OCR for #${doc.id} failed:`, e));

  if (existing?.cloudinary_public_id) cloudinary.destroy(existing.cloudinary_public_id);

  return doc;
}

/** OCR + compare job: processing → action_required (mismatch) | pending. */
export async function runOcr(documentId) {
  const doc = await repo.findById(documentId);
  if (!doc || doc.status !== 'processing') return null;

  const profile = await repo.studentProfile(doc.student_id);
  let provider = 'none';
  let fields = {};
  let mismatch = [];
  let note = null;
  try {
    const result = await ocr.extract({
      kind: doc.kind,
      fileUrl: doc.file_url,
      fileName: doc.file_name,
      profile,
    });
    provider = result.provider;
    fields = result.fields;
    mismatch = ocr.compareToProfile(doc.kind, fields, profile);
  } catch (e) {
    // OCR down ≠ pipeline stuck: hand to admin for manual review
    note = `ocr_failed: ${e.message}`;
  }

  const status = mismatch.length > 0 ? 'action_required' : 'pending';
  const updated = await repo.saveOcrResult(documentId, { provider, fields, mismatch, status });
  if (!updated) return null; // raced with a replace/delete

  await repo.insertEvent(null, {
    documentId,
    from: 'processing',
    to: status,
    actorId: null,
    note: note ?? (mismatch.length ? `ocr_mismatch: ${mismatch.map((m) => m.field).join(', ')}` : 'ocr_clean'),
  });

  if (status === 'action_required') {
    const client = await getClient();
    try {
      await notify(client, {
        userId: doc.student_id,
        kind: 'document_action_required',
        title: `${KIND_LABELS[doc.kind]}: check what we read`,
        body: `Some fields on your ${KIND_LABELS[doc.kind]} do not match your profile. Confirm which value is correct so it can be verified.`,
      });
    } finally {
      client.release();
    }
  }
  return updated;
}

/** Vault list + "3 of 4 verified" progress (Figma H1-1). */
export async function listMine(user) {
  const documents = await repo.listForStudent(user.id);
  const byKind = Object.fromEntries(documents.map((d) => [d.kind, d]));
  return {
    documents,
    missing_kinds: DOCUMENT_KINDS.filter((k) => !byKind[k]),
    progress: {
      verified: documents.filter((d) => d.status === 'verified').length,
      total: DOCUMENT_KINDS.length,
    },
  };
}

/** Document detail + verification history (student: own only; admin: any). */
export async function getDocument(user, id) {
  const doc = await repo.findById(id);
  assertOwnDocument(doc, user);
  const events = await repo.eventsFor(id);
  if (user.role === 'student') {
    const { student_name, student_email, ...own } = doc;
    return { document: own, events };
  }
  const profile = await repo.studentProfile(doc.student_id);
  return { document: doc, events, profile };
}

/** Student resolves OCR mismatches (H1-4) → pending. Profile is never silently
 *  rewritten; the chosen value is recorded for the admin to see (RULES §2). */
export async function confirmMismatch(user, id, { resolutions }) {
  const doc = await repo.findById(id);
  assertOwnDocument(doc, user);
  if (user.role !== 'student') throw err('Only the student can confirm', 'FORBIDDEN', 403);
  if (doc.status !== 'action_required') {
    throw err(`Cannot confirm a ${doc.status} document`, 'INVALID_STATUS', 409);
  }

  const mismatch = doc.mismatch.map((m) => ({ ...m, resolution: resolutions[m.field] ?? m.resolution }));
  const unresolved = mismatch.filter((m) => !m.resolution).map((m) => m.field);
  if (unresolved.length) {
    throw err('Every mismatched field needs a resolution', 'UNRESOLVED_FIELDS', 400, {
      fields: unresolved,
    });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const updated = await repo.saveMismatchResolution(client, id, mismatch);
    await repo.insertEvent(client, {
      documentId: id,
      from: 'action_required',
      to: 'pending',
      actorId: user.id,
      note: `student_confirmed: ${mismatch.map((m) => `${m.field}=${m.resolution}`).join(', ')}`,
    });
    await client.query('COMMIT');
    return updated;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Soft delete own document (preview modal → Delete). History rows remain. */
export async function removeDocument(user, id) {
  const doc = await repo.findById(id);
  assertOwnDocument(doc, user);
  if (user.role !== 'student') throw err('Only the owner can delete', 'FORBIDDEN', 403);
  await repo.softDelete(id);
  await repo.insertEvent(null, {
    documentId: id,
    from: doc.status,
    to: doc.status,
    actorId: user.id,
    note: 'deleted_by_student',
  });
  if (doc.cloudinary_public_id) cloudinary.destroy(doc.cloudinary_public_id);
  return { deleted: true, id: doc.id };
}

// ---------------------------------------------------------------- admin side

/** Verification queue + stat-card counts (FR-DV-05, Figma H1-8). */
export async function adminQueue(filters) {
  const rows = await repo.queue(filters);
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items = rows.map(({ total_count, student_id, student_name, student_email, ...d }) => ({
    ...d,
    mismatch_count: d.mismatch.length,
    student: { id: student_id, name: student_name, email: student_email },
  }));
  return {
    items,
    counts: await repo.queueCounts(),
    page: filters.page,
    limit: filters.limit,
    total,
  };
}

async function adminDecide(admin, id, { status, reason, noteForEvent }) {
  const doc = await repo.findById(id);
  if (!doc || doc.deleted_at || doc.superseded_at) throw err('Document not found', 'NOT_FOUND', 404);
  if (!['pending', 'action_required'].includes(doc.status)) {
    throw err(`Document is already ${doc.status}`, 'INVALID_STATUS', 409);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const updated = await repo.decide(client, id, {
      status,
      reviewerId: admin.id,
      rejectReason: reason,
    });
    await repo.insertEvent(client, {
      documentId: id,
      from: doc.status,
      to: status,
      actorId: admin.id,
      note: noteForEvent,
    });
    await notify(client, {
      userId: doc.student_id,
      kind: `document_${status}`,
      title: `${KIND_LABELS[doc.kind]} ${status}`,
      body:
        status === 'verified'
          ? `Your ${KIND_LABELS[doc.kind]} has been verified. It will be reused in every application automatically.`
          : `Your ${KIND_LABELS[doc.kind]} was rejected: ${reason} You can re-upload it from your Document Vault.`,
    });
    await client.query('COMMIT');
    return updated;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export function verifyDocument(admin, id) {
  return adminDecide(admin, id, { status: 'verified', reason: null, noteForEvent: 'admin_verified' });
}

export function rejectDocument(admin, id, { reason }) {
  return adminDecide(admin, id, { status: 'rejected', reason, noteForEvent: 'admin_rejected' });
}
