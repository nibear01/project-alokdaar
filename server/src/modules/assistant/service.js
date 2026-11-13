import { query } from '../../config/db.js';
import * as gemini from '../../services/gemini.js';

function err(message, code, status = 400) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/** Live retrieval (FR-AI-01): open programmes matching the question + the user's own state. */
async function retrieve(user, question) {
  const terms = question.toLowerCase().match(/[a-zঀ-৿]{4,}/g)?.slice(0, 6) ?? [];
  const like = terms.length ? `%(${terms.join('|')})%` : '%';
  const { rows: programs } = await query(
    `SELECT id, title, amount_per_student, deadline, location_district, seats_available
     FROM programs
     WHERE status = 'open'
       AND (title ~* $1 OR description ~* $1 OR $2 = 0)
     ORDER BY deadline ASC NULLS LAST
     LIMIT 3`,
    [terms.join('|') || '.', terms.length],
  );

  let account = {};
  if (user.role === 'student') {
    const { rows } = await query(
      `SELECT
         (SELECT count(*) FROM documents d WHERE d.student_id = $1
            AND d.superseded_at IS NULL AND d.deleted_at IS NULL AND d.status = 'verified') AS docs_verified,
         (SELECT count(*) FROM documents d WHERE d.student_id = $1
            AND d.superseded_at IS NULL AND d.deleted_at IS NULL AND d.status = 'rejected') AS docs_rejected,
         (SELECT count(*) FROM applications a WHERE a.student_id = $1 AND a.status <> 'withdrawn') AS applications,
         (SELECT count(*) FROM applications a WHERE a.student_id = $1 AND a.status = 'approved') AS approved`,
      [user.id],
    );
    account = rows[0];
  }
  return { programs, account, like };
}

function devAnswer(user, question, ctx) {
  const parts = [];
  if (ctx.account.docs_rejected > 0) {
    parts.push(
      `One of your documents was rejected — open your Document Vault, read the rejection reason, and re-upload it (daylight, whole page in frame).`,
    );
  }
  if (/status|অবস্থা/i.test(question) && ctx.account.applications > 0) {
    parts.push(
      `You have ${ctx.account.applications} application(s)${ctx.account.approved ? `, ${ctx.account.approved} approved` : ''}. Track each one in My Applications, or text STATUS <application id> to our SMS number.`,
    );
  }
  if (ctx.programs.length) {
    parts.push(
      `Programmes still open for you: ${ctx.programs
        .map((p) => `${p.title} (৳${p.amount_per_student}${p.deadline ? `, closes ${new Date(p.deadline).toDateString()}` : ''})`)
        .join('; ')}.`,
    );
  }
  if (!parts.length) {
    parts.push(
      'I could not match that to your account or an open programme. Try rephrasing, or create a ticket and a person from the help desk will take over.',
    );
  }
  return parts.join('\n\n');
}

/**
 * Assistant chat (FR-AI-01): retrieval + Gemini when configured, deterministic
 * dev answer otherwise. Always returns programme cards + a suggest_ticket flag
 * ("answer before ticket creation", ARCHITECTURE §5.8).
 */
export async function chat(user, { message, history = [], locale = 'en' }) {
  const ctx = await retrieve(user, message);
  let reply;
  let provider = 'dev';
  if (gemini.isConfigured()) {
    try {
      const sys =
        `You are the Alokdaar scholarship platform assistant for Bangladesh students. ` +
        `Answer in ${locale === 'bn' ? 'Bangla' : 'English'}, briefly and concretely. ` +
        `Use ONLY these facts. Open programmes: ${JSON.stringify(ctx.programs)}. ` +
        `User account: ${JSON.stringify(ctx.account)}. If the question needs a human, say a ticket can be created.`;
      const convo = history.slice(-6).map((m) => `${m.role}: ${m.content}`).join('\n');
      reply = await gemini.generate(`${convo}\nuser: ${message}`, { system: sys });
      provider = 'gemini';
    } catch {
      reply = devAnswer(user, message, ctx);
    }
  } else {
    reply = devAnswer(user, message, ctx);
  }
  const unresolved = /could not match|create a ticket|help desk/i.test(reply);
  return {
    reply,
    provider,
    programs: ctx.programs,
    suggest_ticket: unresolved,
  };
}

// ---- reviewer summary + originality flag (FR-AI-04, H2-7 → N1-3) ----

const TEMPLATE_PHRASES = [
  'since my childhood i have always dreamt',
  'i come from a humble family background',
  'education is the backbone of a nation',
  'i promise to serve my country',
  'poverty is the main obstacle in my life',
];

function devSummary(statement) {
  const sentences = statement.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter((s) => s.length > 15);
  const summary = sentences.slice(0, 3).map((s) => `• ${s.trim()}`);
  const text = statement.toLowerCase();
  const hits = TEMPLATE_PHRASES.filter((p) => text.includes(p));
  const words = statement.split(/\s+/).length;
  const uniq = new Set(statement.toLowerCase().split(/\s+/)).size;
  const repetition = words > 40 ? 1 - uniq / words : 0;
  const score = Math.min(95, hits.length * 35 + Math.round(repetition * 60));
  return {
    summary,
    originality: {
      flagged: score >= 35,
      confidence: score,
      note: hits.length
        ? `Matches ${hits.length} phrase(s) common in coaching-centre templates.`
        : 'No template phrases matched.',
      advisory: 'Advisory only — never reject on this signal alone (RULES).',
    },
  };
}

/** Summarise a personal statement ≤3 lines + originality flag; cached on the row. */
export async function reviewerSummary(actor, applicationId, { refresh = false } = {}) {
  const { rows } = await query(
    `SELECT a.id, a.statement, a.ai_summary, p.provider_id
     FROM applications a JOIN programs p ON p.id = a.program_id
     WHERE a.id = $1`,
    [applicationId],
  );
  const app = rows[0];
  if (!app) throw err('Application not found', 'NOT_FOUND', 404);
  if (actor.role === 'provider' && Number(app.provider_id) !== actor.id) {
    throw err('Not your programme', 'FORBIDDEN', 403);
  }
  if (!app.statement || app.statement.trim().length < 30) {
    throw err('No personal statement to summarise', 'NO_STATEMENT', 409);
  }
  if (app.ai_summary && !refresh) return { ...app.ai_summary, cached: true };

  let result;
  let provider = 'dev';
  if (gemini.isConfigured()) {
    try {
      const text = await gemini.generate(
        `Summarise this scholarship personal statement in at most 3 bullet lines, then on a new line rate ` +
        `TEMPLATE_LIKELIHOOD 0-100 (how likely it is copied from a generic template) with one short reason.\n\n${app.statement}`,
      );
      const conf = Number(text.match(/TEMPLATE_LIKELIHOOD\s*:?\s*(\d{1,3})/i)?.[1] ?? 0);
      result = {
        summary: text.split('\n').filter((l) => l.trim().startsWith('•') || l.trim().startsWith('-')).slice(0, 3),
        originality: {
          flagged: conf >= 50,
          confidence: conf,
          note: text.split(/TEMPLATE_LIKELIHOOD[^\n]*/i)[1]?.trim() || '',
          advisory: 'Advisory only — never reject on this signal alone (RULES).',
        },
      };
      provider = 'gemini';
    } catch {
      result = devSummary(app.statement);
    }
  } else {
    result = devSummary(app.statement);
  }

  const payload = { ...result, provider, generated_at: new Date().toISOString() };
  await query(`UPDATE applications SET ai_summary = $2 WHERE id = $1`, [applicationId, JSON.stringify(payload)]);
  return { ...payload, cached: false };
}
