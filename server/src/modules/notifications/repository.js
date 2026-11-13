import { query } from '../../config/db.js';

/** In-app notification center rows (email/SMS rows are delivery logs, not shown). */
export async function listForUser(userId, { unread, page, limit }) {
  const where = [`user_id = $1`, `channel = 'in_app'`];
  const params = [userId];
  if (unread === 'true') where.push('read_at IS NULL');
  if (unread === 'false') where.push('read_at IS NOT NULL');
  params.push(limit, (page - 1) * limit);

  const { rows } = await query(
    `SELECT id, kind, title, body, application_id, interview_id, read_at, created_at,
            count(*) OVER() AS total_count
     FROM notifications
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

export async function unreadCount(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS unread FROM notifications
     WHERE user_id = $1 AND channel = 'in_app' AND read_at IS NULL`,
    [userId],
  );
  return rows[0].unread;
}

export async function markRead(userId, id) {
  const { rows } = await query(
    `UPDATE notifications SET read_at = COALESCE(read_at, now())
     WHERE id = $1 AND user_id = $2 AND channel = 'in_app'
     RETURNING id, read_at`,
    [id, userId],
  );
  return rows[0] || null;
}

export async function markAllRead(userId) {
  const { rowCount } = await query(
    `UPDATE notifications SET read_at = now()
     WHERE user_id = $1 AND channel = 'in_app' AND read_at IS NULL`,
    [userId],
  );
  return rowCount;
}

export async function getPreferences(userId) {
  const { rows } = await query(
    `SELECT COALESCE(p.email_enabled, TRUE) AS email_enabled,
            COALESCE(p.sms_enabled, TRUE) AS sms_enabled
     FROM users u
     LEFT JOIN notification_preferences p ON p.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  );
  return rows[0] || { email_enabled: true, sms_enabled: true };
}

export async function upsertPreferences(userId, { email_enabled, sms_enabled }) {
  const current = await getPreferences(userId);
  const next = {
    email_enabled: email_enabled ?? current.email_enabled,
    sms_enabled: sms_enabled ?? current.sms_enabled,
  };
  const { rows } = await query(
    `INSERT INTO notification_preferences (user_id, email_enabled, sms_enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET email_enabled = $2, sms_enabled = $3, updated_at = now()
     RETURNING email_enabled, sms_enabled`,
    [userId, next.email_enabled, next.sms_enabled],
  );
  return rows[0];
}

/** STATUS <application_id> lookup: application + owning student's phone. */
export async function applicationForShortcode(applicationId) {
  const { rows } = await query(
    `SELECT a.id, a.status, a.student_id, u.phone AS student_phone, p.title AS program_title
     FROM applications a
     JOIN users u ON u.id = a.student_id
     JOIN programs p ON p.id = a.program_id
     WHERE a.id = $1`,
    [applicationId],
  );
  return rows[0] || null;
}
