import { query } from '../../config/db.js';

export async function insertTicket(client, data) {
  const { rows } = await client.query(
    `INSERT INTO tickets (user_id, category, subject, priority, application_id, chat_transcript)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [data.user_id, data.category, data.subject, data.priority ?? 'normal',
      data.application_id ?? null,
      data.chat_transcript ? JSON.stringify(data.chat_transcript) : null],
  );
  return rows[0];
}

export async function insertMessage(client, { ticketId, authorId, body, internal = false, attachments = [] }) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `INSERT INTO ticket_messages (ticket_id, author_id, body, internal, attachments)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [ticketId, authorId, body, internal, JSON.stringify(attachments)],
  );
  return rows[0];
}

export async function findTicket(id) {
  const { rows } = await query(
    `SELECT t.*, u.name AS user_name, u.email AS user_email, u.role AS user_role,
            au.name AS assignee_name
     FROM tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN users au ON au.id = t.assignee_id
     WHERE t.id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function messagesFor(ticketId, { includeInternal }) {
  const { rows } = await query(
    `SELECT m.id, m.body, m.internal, m.attachments, m.created_at,
            u.name AS author_name, u.role AS author_role
     FROM ticket_messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.ticket_id = $1 ${includeInternal ? '' : 'AND NOT m.internal'}
     ORDER BY m.created_at`,
    [ticketId],
  );
  return rows;
}

export async function listMine(userId, { status, page, limit }) {
  const where = ['t.user_id = $1'];
  const params = [userId];
  if (status) { params.push(status); where.push(`t.status = $${params.length}::ticket_status`); }
  params.push(limit, (page - 1) * limit);
  const { rows } = await query(
    `SELECT t.id, t.category, t.subject, t.status, t.priority, t.rating, t.created_at,
            t.resolved_at,
            (SELECT max(m.created_at) FROM ticket_messages m
              WHERE m.ticket_id = t.id AND NOT m.internal) AS last_message_at,
            count(*) OVER() AS total_count
     FROM tickets t
     WHERE ${where.join(' AND ')}
     ORDER BY t.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

/** Admin inbox (FR-AI-03): filters + age; overdue = open/in_progress older than 48h. */
export async function inbox(f) {
  const where = ['TRUE'];
  const params = [];
  if (f.status) { params.push(f.status); where.push(`t.status = $${params.length}::ticket_status`); }
  if (f.category) { params.push(f.category); where.push(`t.category = $${params.length}`); }
  if (f.priority) { params.push(f.priority); where.push(`t.priority = $${params.length}::ticket_priority`); }
  if (f.assignee === 'unassigned') where.push('t.assignee_id IS NULL');
  else if (f.assignee === 'me') { params.push(f.meId); where.push(`t.assignee_id = $${params.length}`); }
  params.push(f.limit, (f.page - 1) * f.limit);
  const { rows } = await query(
    `SELECT t.id, t.category, t.subject, t.status, t.priority, t.created_at, t.rating,
            u.name AS user_name, au.name AS assignee_name,
            (t.status IN ('open', 'in_progress')
              AND t.created_at < now() - interval '48 hours') AS overdue,
            count(*) OVER() AS total_count
     FROM tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN users au ON au.id = t.assignee_id
     WHERE ${where.join(' AND ')}
     ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1
              WHEN 'resolved' THEN 2 ELSE 3 END,
              CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
              t.created_at
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

export async function inboxCounts() {
  const { rows } = await query(
    `SELECT
       count(*) FILTER (WHERE status = 'open') AS open,
       count(*) FILTER (WHERE status = 'in_progress') AS in_progress,
       count(*) FILTER (WHERE status IN ('open', 'in_progress')
                          AND created_at < now() - interval '48 hours') AS overdue,
       round(avg(rating) FILTER (WHERE rating IS NOT NULL), 2) AS avg_rating
     FROM tickets`,
  );
  return rows[0];
}

export async function setStatus(client, id, status) {
  const { rows } = await client.query(
    `UPDATE tickets
     SET status = $2::ticket_status,
         resolved_at = CASE WHEN $2::ticket_status IN ('resolved', 'closed')
                            THEN COALESCE(resolved_at, now()) ELSE resolved_at END,
         updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, status],
  );
  return rows[0];
}

export async function assign(id, assigneeId) {
  const { rows } = await query(
    `UPDATE tickets SET assignee_id = $2,
       status = CASE WHEN status = 'open' THEN 'in_progress'::ticket_status ELSE status END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, assigneeId],
  );
  return rows[0] || null;
}

export async function rate(id, userId, rating, comment) {
  const { rows } = await query(
    `UPDATE tickets SET rating = $3, rating_comment = $4, updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status IN ('resolved', 'closed')
     RETURNING id, rating, rating_comment`,
    [id, userId, rating, comment ?? null],
  );
  return rows[0] || null;
}
