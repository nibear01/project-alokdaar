import { query } from '../../config/db.js';
import * as sms from '../../services/sms.js';
import * as repo from './repository.js';

function err(message, code, status = 400, details) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  if (details) e.details = details;
  return e;
}

/** Notification center list + unread badge (FR-M2-03). */
export async function listMine(user, filters) {
  const rows = await repo.listForUser(user.id, filters);
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    items: rows.map(({ total_count, ...n }) => n),
    unread: await repo.unreadCount(user.id),
    page: filters.page,
    limit: filters.limit,
    total,
  };
}

export async function markRead(user, id) {
  const row = await repo.markRead(user.id, id);
  if (!row) throw err('Notification not found', 'NOT_FOUND', 404);
  return { id: row.id, read_at: row.read_at, unread: await repo.unreadCount(user.id) };
}

export async function markAllRead(user) {
  const marked = await repo.markAllRead(user.id);
  return { marked, unread: 0 };
}

export function getPreferences(user) {
  return repo.getPreferences(user.id);
}

export async function updatePreferences(user, data) {
  return { preferences: await repo.upsertPreferences(user.id, data) };
}

// ------------------------------------------------- STATUS shortcode (FR-M2-03)

const STATUS_RE = /^\s*status\s+(\d{1,12})\s*$/i;

export function parseShortcode(text) {
  const m = String(text || '').match(STATUS_RE);
  return m ? Number(m[1]) : null;
}

const STATUS_TEXT = {
  submitted: 'submitted and waiting for review',
  under_review: 'under review',
  shortlisted: 'shortlisted — watch for an interview slot',
  approved: 'approved — congratulations!',
  waitlisted: 'waitlisted',
  rejected: 'not selected this cycle',
  withdrawn: 'withdrawn',
};

/**
 * Inbound SMS webhook: "STATUS <application_id>" → reply with the current status.
 * Only answers the phone number that owns the application (no PII to strangers).
 * Always 200 to the gateway; `handled` says whether a reply was sent.
 */
export async function handleInboundSms({ from, text }) {
  const applicationId = parseShortcode(text);
  if (!applicationId) {
    return { handled: false, hint: 'Expected: STATUS <application_id>' };
  }

  const app = await repo.applicationForShortcode(applicationId);
  let reply;
  if (!app || !sms.samePhone(from, app.student_phone)) {
    // same message for "not found" and "not your application" — no enumeration
    reply = `Alokdaar: no application #${applicationId} is registered to this number.`;
  } else {
    reply = `Alokdaar: application #${app.id} (${app.program_title}) is ${STATUS_TEXT[app.status] || app.status}.`;
  }

  const result = await sms.send({ to: from, body: reply });
  if (app && sms.samePhone(from, app.student_phone)) {
    await query(
      `INSERT INTO notifications (user_id, application_id, kind, channel, title, body, status)
       VALUES ($1, $2, 'status_shortcode', 'sms', 'STATUS reply', $3, $4)`,
      [app.student_id, app.id, reply, result.sent ? 'sent' : result.failed ? 'failed' : 'skipped'],
    );
  }
  return { handled: true, replied: Boolean(result.sent || result.skipped) };
}

/** Shared-secret guard for the public webhook (set SMS_WEBHOOK_SECRET to enforce). */
export function assertWebhookSecret(req) {
  const expected = process.env.SMS_WEBHOOK_SECRET;
  if (!expected) return; // dev: open
  const got = req.get('x-webhook-secret') || req.query.secret;
  if (got !== expected) throw err('Bad webhook secret', 'UNAUTHENTICATED', 401);
}
