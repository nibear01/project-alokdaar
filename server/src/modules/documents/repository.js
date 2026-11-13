import { query } from '../../config/db.js';

const ACTIVE = 'superseded_at IS NULL AND deleted_at IS NULL';

/** Student profile values OCR compares against (users + latest academic/household). */
export async function studentProfile(studentId) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.phone,
            la.cgpa, la.institution,
            lh.monthly_income
     FROM users u
     LEFT JOIN latest_academic la ON la.student_id = u.id
     LEFT JOIN latest_household lh ON lh.student_id = u.id
     WHERE u.id = $1`,
    [studentId],
  );
  return rows[0] || null;
}

/** Vault list for one student (active docs only) — FR-DV-04. */
export async function listForStudent(studentId) {
  const { rows } = await query(
    `SELECT id, kind, status, file_name, mime_type, file_size_bytes,
            cloudinary_public_id, file_url, ocr_provider, mismatch,
            reject_reason, reviewed_at, created_at, updated_at
     FROM documents
     WHERE student_id = $1 AND ${ACTIVE}
     ORDER BY kind`,
    [studentId],
  );
  return rows;
}

export async function findById(id, client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT d.*, u.name AS student_name, u.email AS student_email
     FROM documents d
     JOIN users u ON u.id = d.student_id
     WHERE d.id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function findActive(studentId, kind) {
  const { rows } = await query(
    `SELECT * FROM documents
     WHERE student_id = $1 AND kind = $2 AND ${ACTIVE}`,
    [studentId, kind],
  );
  return rows[0] || null;
}

export async function insertDocument(client, data) {
  const { rows } = await client.query(
    `INSERT INTO documents
       (student_id, kind, status, cloudinary_public_id, file_url, file_name,
        mime_type, file_size_bytes, supersedes_id)
     VALUES ($1, $2, 'processing', $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      data.student_id,
      data.kind,
      data.cloudinary_public_id ?? null,
      data.file_url ?? null,
      data.file_name,
      data.mime_type,
      data.file_size_bytes,
      data.supersedes_id ?? null,
    ],
  );
  return rows[0];
}

export async function supersede(client, id) {
  await client.query(
    `UPDATE documents SET superseded_at = now(), updated_at = now() WHERE id = $1`,
    [id],
  );
}

export async function softDelete(id) {
  const { rows } = await query(
    `UPDATE documents SET deleted_at = now(), updated_at = now()
     WHERE id = $1 RETURNING id`,
    [id],
  );
  return rows[0] || null;
}

export async function saveOcrResult(id, { provider, fields, mismatch, status }) {
  const { rows } = await query(
    `UPDATE documents
     SET ocr_provider = $2, ocr_fields = $3, mismatch = $4, status = $5, updated_at = now()
     WHERE id = $1 AND status = 'processing'
     RETURNING *`,
    [id, provider, JSON.stringify(fields), JSON.stringify(mismatch), status],
  );
  return rows[0] || null;
}

export async function saveMismatchResolution(client, id, mismatch) {
  const { rows } = await client.query(
    `UPDATE documents
     SET mismatch = $2, mismatch_resolved_at = now(), status = 'pending', updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, JSON.stringify(mismatch)],
  );
  return rows[0];
}

export async function decide(client, id, { status, reviewerId, rejectReason }) {
  const { rows } = await client.query(
    `UPDATE documents
     SET status = $2, reviewed_by = $3, reviewed_at = now(),
         reject_reason = $4, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, status, reviewerId, rejectReason ?? null],
  );
  return rows[0];
}

export async function insertEvent(client, { documentId, from, to, actorId, note }) {
  const run = client ? client.query.bind(client) : query;
  await run(
    `INSERT INTO document_events (document_id, from_status, to_status, actor_id, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [documentId, from ?? null, to, actorId ?? null, note ?? null],
  );
}

export async function eventsFor(documentId) {
  const { rows } = await query(
    `SELECT e.id, e.from_status, e.to_status, e.note, e.created_at,
            u.name AS actor_name, u.role AS actor_role
     FROM document_events e
     LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.document_id = $1
     ORDER BY e.created_at`,
    [documentId],
  );
  return rows;
}

/** Admin verification queue (FR-DV-05): filters + pagination, oldest first by default. */
export async function queue(filters) {
  const where = [ACTIVE];
  const params = [];

  if (filters.status) {
    params.push(filters.status);
    where.push(`d.status = $${params.length}::document_status`);
  } else {
    where.push(`d.status IN ('pending', 'action_required')`);
  }
  if (filters.kind) {
    params.push(filters.kind);
    where.push(`d.kind = $${params.length}::document_kind`);
  }
  if (filters.mismatch === 'true') where.push(`jsonb_array_length(d.mismatch) > 0`);
  if (filters.mismatch === 'false') where.push(`jsonb_array_length(d.mismatch) = 0`);
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }

  const order = filters.sort === 'newest' ? 'd.created_at DESC' : 'd.created_at ASC';
  params.push(filters.limit, (filters.page - 1) * filters.limit);

  const { rows } = await query(
    `SELECT d.id, d.kind, d.status, d.file_name, d.mismatch, d.created_at,
            u.id AS student_id, u.name AS student_name, u.email AS student_email,
            count(*) OVER() AS total_count
     FROM documents d
     JOIN users u ON u.id = d.student_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${order}, d.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

/** Queue header counts (Figma H1-8 stat cards). */
export async function queueCounts() {
  const { rows } = await query(
    `SELECT
       count(*) FILTER (WHERE status IN ('pending', 'action_required')) AS pending,
       count(*) FILTER (WHERE status IN ('pending', 'action_required')
                          AND jsonb_array_length(mismatch) > 0) AS mismatched,
       count(*) FILTER (WHERE status IN ('pending', 'action_required')
                          AND created_at < now() - interval '48 hours') AS overdue_48h,
       count(*) FILTER (WHERE status = 'verified'
                          AND reviewed_at >= date_trunc('day', now())) AS verified_today
     FROM documents
     WHERE ${ACTIVE}`,
  );
  return rows[0];
}
