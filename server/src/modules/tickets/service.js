import { getClient } from '../../config/db.js';
import { notify } from '../../lib/notify.js';
import * as repo from './repository.js';

function err(message, code, status = 400, details) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  if (details) e.details = details;
  return e;
}

/** Create a ticket (H2-2) — optionally carrying the assistant chat transcript. */
export async function create(user, data) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const ticket = await repo.insertTicket(client, {
      user_id: user.id,
      category: data.category,
      subject: data.subject,
      priority: data.priority,
      application_id: data.application_id,
      chat_transcript: data.chat_transcript,
    });
    await repo.insertMessage(client, {
      ticketId: ticket.id, authorId: user.id, body: data.body, attachments: data.attachments ?? [],
    });
    await notify(client, {
      userId: user.id,
      kind: `ticket_created:${ticket.id}`,
      title: `Ticket TKT-${ticket.id} created`,
      body: `"${data.subject}" — the help desk usually replies within one working day.`,
    });
    await client.query('COMMIT');
    return ticket;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function listMine(user, filters) {
  const rows = await repo.listMine(user.id, filters);
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { items: rows.map(({ total_count, ...t }) => t), page: filters.page, limit: filters.limit, total };
}

export async function getTicket(user, id) {
  const t = await repo.findTicket(id);
  if (!t) throw err('Ticket not found', 'NOT_FOUND', 404);
  const isAdmin = user.role === 'admin';
  if (!isAdmin && Number(t.user_id) !== user.id) throw err('Not your ticket', 'FORBIDDEN', 403);
  const messages = await repo.messagesFor(id, { includeInternal: isAdmin });
  if (!isAdmin) delete t.user_email;
  return { ticket: t, messages };
}

/** Reply (owner or admin). Owner reply on a resolved ticket reopens it. */
export async function reply(user, id, { body, internal = false, attachments = [] }) {
  const t = await repo.findTicket(id);
  if (!t) throw err('Ticket not found', 'NOT_FOUND', 404);
  const isAdmin = user.role === 'admin';
  if (!isAdmin && Number(t.user_id) !== user.id) throw err('Not your ticket', 'FORBIDDEN', 403);
  if (internal && !isAdmin) throw err('Internal notes are admin-only', 'FORBIDDEN', 403);
  if (t.status === 'closed') throw err('Ticket is closed', 'TICKET_CLOSED', 409);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const message = await repo.insertMessage(client, {
      ticketId: id, authorId: user.id, body, internal, attachments,
    });
    let status = t.status;
    if (!internal) {
      if (!isAdmin && t.status === 'resolved') status = 'in_progress'; // reopen
      if (isAdmin && t.status === 'open') status = 'in_progress';
      if (status !== t.status) await repo.setStatus(client, id, status);
      if (isAdmin) {
        await notify(client, {
          userId: t.user_id,
          kind: `ticket_reply:${id}:${message.id}`,
          title: `Help desk replied — TKT-${id}`,
          body: body.slice(0, 200),
        });
      }
    }
    await client.query('COMMIT');
    return { message, status };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Admin: open | in_progress | resolved | closed; resolve notifies + asks for a rating. */
export async function setStatus(admin, id, { status }) {
  const t = await repo.findTicket(id);
  if (!t) throw err('Ticket not found', 'NOT_FOUND', 404);
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const updated = await repo.setStatus(client, id, status);
    if (status === 'resolved' && t.status !== 'resolved') {
      await notify(client, {
        userId: t.user_id,
        kind: `ticket_resolved:${id}`,
        title: `TKT-${id} resolved`,
        body: `"${t.subject}" was marked resolved. Rate the help you got, or reply to reopen it.`,
      });
    }
    await client.query('COMMIT');
    return { ticket: updated };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function assign(admin, id, { assignee_id }) {
  const row = await repo.assign(id, assignee_id ?? admin.id);
  if (!row) throw err('Ticket not found', 'NOT_FOUND', 404);
  return { ticket: row };
}

/** Satisfaction rating after resolve (H2-4). */
export async function rate(user, id, { rating, comment }) {
  const row = await repo.rate(id, user.id, rating, comment);
  if (!row) {
    throw err('Only your own resolved tickets can be rated', 'NOT_RATEABLE', 409);
  }
  return { ticket: row };
}

export async function inbox(admin, filters) {
  const rows = await repo.inbox({ ...filters, meId: admin.id });
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    items: rows.map(({ total_count, ...t }) => t),
    counts: await repo.inboxCounts(),
    page: filters.page, limit: filters.limit, total,
  };
}
