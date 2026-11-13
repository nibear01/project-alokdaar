import { getClient } from '../../config/db.js';
import { notify } from '../../lib/notify.js';
import { evaluate } from './eligibility.js';
import * as repo from './repository.js';

function err(message, code, status = 400, details) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  if (details) e.details = details;
  return e;
}

const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

function withEligibility(program, snapshot) {
  const result = evaluate(program.criteria, program.required_docs, snapshot);
  return {
    ...program,
    eligibility: result,
    days_left: program.deadline
      ? Math.max(0, Math.ceil((new Date(program.deadline) - Date.now()) / 864e5))
      : null,
  };
}

/** Find scholarships (FR-DA-01/02): filters + per-card eligibility badge. */
export async function search(user, f) {
  const [snapshot, programs] = await Promise.all([
    repo.studentSnapshot(user.id),
    repo.openPrograms(user.id, f),
  ]);
  let items = programs.map((p) => withEligibility(p, snapshot));
  const matching = items.filter((p) => p.eligibility.eligible).length;
  if (f.eligible === 'true') items = items.filter((p) => p.eligibility.eligible);

  const total = items.length;
  const start = (f.page - 1) * f.limit;
  return {
    items: items.slice(start, start + f.limit),
    page: f.page,
    limit: f.limit,
    total,
    matching_profile: matching,
  };
}

/** Programme detail (FR-DA-05): checklist ✓/✗ + vault doc status + apply gate. */
export async function detail(user, programId) {
  const [snapshot, program] = await Promise.all([
    repo.studentSnapshot(user.id),
    repo.programForStudent(user.id, programId),
  ]);
  if (!program) throw err('Programme not found', 'NOT_FOUND', 404);
  const p = withEligibility(program, snapshot);
  return {
    program: p,
    can_apply:
      p.status === 'open' &&
      p.eligibility.eligible &&
      !p.application_id &&
      (!p.deadline || new Date(p.deadline) > new Date()),
  };
}

export async function bookmark(user, programId, on) {
  const program = await repo.programForStudent(user.id, programId);
  if (!program) throw err('Programme not found', 'NOT_FOUND', 404);
  if (on) await repo.addBookmark(user.id, programId);
  else await repo.removeBookmark(user.id, programId);
  return { program_id: programId, bookmarked: on };
}

export async function bookmarks(user) {
  const snapshot = await repo.studentSnapshot(user.id);
  const rows = await repo.listBookmarks(user.id);
  return { items: rows.map((p) => withEligibility(p, snapshot)) };
}

/** Step 0: start the wizard — drafts allowed only for eligible students (RULES §2). */
export async function createDraft(user, { program_id }) {
  const { can_apply, program } = await detail(user, program_id);
  if (program.application_id) {
    throw err('You already have an application for this programme', 'APPLICATION_EXISTS', 409, {
      application_id: program.application_id,
      status: program.application_status,
    });
  }
  if (!can_apply) {
    throw err('You are not eligible for this programme', 'NOT_ELIGIBLE', 403, {
      checks: program.eligibility.checks.filter((c) => !c.pass),
      program_status: program.status,
    });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const draft = await repo.insertDraft(client, { programId: program_id, studentId: user.id });
    await repo.insertEvent(client, {
      applicationId: draft.id,
      from: null,
      to: 'draft',
      actorId: user.id,
      actorRole: 'student',
      note: 'wizard_started',
    });
    await client.query('COMMIT');
    return draft;
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      throw err('You already have an application for this programme', 'APPLICATION_EXISTS', 409);
    }
    throw e;
  } finally {
    client.release();
  }
}

function assertEditable(app) {
  if (app.status === 'draft') return;
  const editable = ['submitted', 'under_review'].includes(app.status);
  const beforeDeadline = !app.deadline || new Date(app.deadline) > new Date();
  if (!editable || !beforeDeadline) {
    throw err(
      beforeDeadline
        ? `Cannot edit a ${app.status} application`
        : 'Editing is locked after the deadline',
      beforeDeadline ? 'INVALID_STATUS' : 'DEADLINE_PASSED',
      409,
    );
  }
}

/** Step 3 autosave + post-submit edits before the deadline (FR-DA-04/05). */
export async function saveStatement(user, id, { statement }) {
  const app = await repo.findOwn(user.id, id);
  if (!app) throw err('Application not found', 'NOT_FOUND', 404);
  assertEditable(app);
  const saved = await repo.saveStatement(id, statement);
  if (app.status !== 'draft') {
    await repo.insertEvent(null, {
      applicationId: id,
      from: app.status,
      to: app.status,
      actorId: user.id,
      actorRole: 'student',
      note: 'statement_edited_before_deadline',
    });
  }
  return { ...saved, words: wordCount(saved.statement), autosaved_at: new Date().toISOString() };
}

/** Step 4: review & submit (FR-DA-04) — re-checks everything server-side. */
export async function submit(user, id) {
  const app = await repo.findOwn(user.id, id);
  if (!app) throw err('Application not found', 'NOT_FOUND', 404);
  if (app.status !== 'draft') throw err(`Application is already ${app.status}`, 'INVALID_STATUS', 409);
  if (app.program_status !== 'open') throw err('Programme is no longer open', 'PROGRAM_CLOSED', 409);
  if (app.deadline && new Date(app.deadline) <= new Date()) {
    throw err('The deadline has passed', 'DEADLINE_PASSED', 409);
  }

  const words = wordCount(app.statement);
  if (words < 50) {
    throw err('Personal statement must be at least 50 words', 'STATEMENT_TOO_SHORT', 400, { words });
  }

  const snapshot = await repo.studentSnapshot(user.id);
  const elig = evaluate(app.criteria, app.required_docs, snapshot);
  if (!elig.eligible) {
    throw err('You no longer meet the eligibility criteria', 'NOT_ELIGIBLE', 409, {
      checks: elig.checks.filter((c) => !c.pass),
    });
  }
  if (elig.missing_docs.length) {
    throw err('Required documents are missing from your vault', 'DOCUMENTS_MISSING', 409, {
      missing: elig.missing_docs,
    });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const submitted = await repo.submit(client, id);
    if (!submitted) throw err('Already submitted', 'INVALID_STATUS', 409);
    await repo.insertEvent(client, {
      applicationId: id,
      from: 'draft',
      to: 'submitted',
      actorId: user.id,
      actorRole: 'student',
      note: `submitted: ${words} words, docs complete`,
    });
    await notify(client, {
      userId: user.id,
      applicationId: id,
      kind: `application_submitted:${id}`,
      title: 'Application sent',
      body: `Your application for ${app.program_title} was submitted. Track it in My Applications (ID APP-${id}).`,
    });
    await notify(client, {
      userId: app.provider_id,
      applicationId: id,
      kind: `application_received:${id}`,
      title: `New application — ${app.program_title}`,
      body: `A new application arrived and is ready for review.`,
    });
    await client.query('COMMIT');
    return submitted;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** My Applications list with status tabs + interview block (FR-DA-06). */
export async function listMine(user, filters) {
  const rows = await repo.listOwn(user.id, filters);
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    items: rows.map(({ total_count, ...a }) => a),
    page: filters.page,
    limit: filters.limit,
    total,
  };
}

/** Own application detail: timeline, interview, edit/withdraw affordances. */
export async function getMine(user, id) {
  const app = await repo.findOwn(user.id, id);
  if (!app) throw err('Application not found', 'NOT_FOUND', 404);
  const beforeDeadline = !app.deadline || new Date(app.deadline) > new Date();
  const snapshot = await repo.studentSnapshot(user.id);
  return {
    application: app,
    events: await repo.eventsFor(id),
    eligibility: evaluate(app.criteria, app.required_docs, snapshot),
    can_edit: app.status === 'draft' || (['submitted', 'under_review'].includes(app.status) && beforeDeadline),
    can_withdraw: !['draft', 'rejected', 'withdrawn'].includes(app.status) &&
      (beforeDeadline || app.status === 'approved' || app.status === 'waitlisted'),
    statement_words: wordCount(app.statement),
  };
}

/** Abandon the wizard — drafts are deleted, not "withdrawn". */
export async function discardDraft(user, id) {
  const deleted = await repo.deleteDraft(user.id, id);
  if (!deleted) throw err('No draft of yours with that id', 'NOT_FOUND', 404);
  return { deleted: true, id };
}
