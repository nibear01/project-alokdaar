import * as repo from './repository.js';

function err(message, code, status = 400, details) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  if (details) e.details = details;
  return e;
}

function assertProvider(context, actor) {
  if (actor.role === 'student') throw err('Forbidden for students', 'FORBIDDEN', 403);
  if (actor.role === 'provider' && Number(context.provider_id) !== actor.id) {
    throw err('Not your program', 'FORBIDDEN', 403);
  }
}

/** Deterministic-looking Meet stub (real Google Calendar API when creds exist). */
function generateMeetLink() {
  const chars = 'abcdefghijkmnpqrstuvwxyz';
  const part = (n) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `https://meet.google.com/${part(3)}-${part(4)}-${part(3)}`;
}

async function notifyStudent(client, { userId, applicationId, interviewId, kind, title, body }) {
  // in-app always
  await repo.insertNotification(client, {
    userId, applicationId, interviewId, kind, channel: 'in_app', title, body, status: 'sent',
  });
  // email — SendGrid only when configured; otherwise log as skipped
  const hasSendGrid = Boolean(process.env.SENDGRID_API_KEY);
  await repo.insertNotification(client, {
    userId, applicationId, interviewId, kind, channel: 'email', title, body,
    status: hasSendGrid ? 'pending' : 'skipped',
  });
  // sms — gateway (Twilio/BulkSMSBD) not wired yet: record intent
  await repo.insertNotification(client, {
    userId, applicationId, interviewId, kind, channel: 'sms', title, body, status: 'skipped',
  });
  if (hasSendGrid) {
    try {
      const sg = (await import('@sendgrid/mail')).default;
      sg.setApiKey(process.env.SENDGRID_API_KEY);
      await sg.send({
        to: process.env.NOTIFY_EMAIL_FALLBACK || 'dev@alokdaar.local',
        from: process.env.FROM_EMAIL || 'noreply@alokdaar.local',
        subject: title,
        text: body,
      });
      await client.query(
        `UPDATE notifications SET status = 'sent'
         WHERE interview_id = $1 AND channel = 'email' AND kind = $2`,
        [interviewId, kind],
      );
    } catch {
      await client.query(
        `UPDATE notifications SET status = 'failed'
         WHERE interview_id = $1 AND channel = 'email' AND kind = $2`,
        [interviewId, kind],
      );
    }
  }
}

// --- weekly slot templates (FR-RS-06) ---

export async function addSlot(programId, actor, input) {
  const { query } = await import('../../config/db.js');
  const { rows } = await query(`SELECT provider_id FROM programs WHERE id = $1`, [programId]);
  if (!rows[0]) throw err('Program not found', 'PROGRAM_NOT_FOUND', 404);
  if (actor.role === 'provider' && Number(rows[0].provider_id) !== actor.id) {
    throw err('Not your program', 'FORBIDDEN', 403);
  }
  const slot = await repo.createSlot(programId, input);
  return { slot };
}

export async function getSlots(programId, actor) {
  const { query } = await import('../../config/db.js');
  const { rows } = await query(`SELECT provider_id FROM programs WHERE id = $1`, [programId]);
  if (!rows[0]) throw err('Program not found', 'PROGRAM_NOT_FOUND', 404);
  if (actor.role === 'provider' && Number(rows[0].provider_id) !== actor.id) {
    throw err('Not your program', 'FORBIDDEN', 403);
  }
  return { slots: await repo.listSlots(programId) };
}

export async function removeSlot(slotId, actor) {
  const { query } = await import('../../config/db.js');
  const { rows } = await query(
    `SELECT s.*, p.provider_id FROM interview_slots s JOIN programs p ON p.id = s.program_id WHERE s.id = $1`,
    [slotId],
  );
  if (!rows[0]) throw err('Slot not found', 'SLOT_NOT_FOUND', 404);
  if (actor.role === 'provider' && Number(rows[0].provider_id) !== actor.id) {
    throw err('Not your program', 'FORBIDDEN', 403);
  }
  await repo.deleteSlot(slotId);
  return { deleted: true };
}

/** Expand weekly templates into concrete datetimes, filtering past + provider conflicts. */
export async function availableSlots(programId, actor, { from, to }) {
  const { query } = await import('../../config/db.js');
  const { rows: prog } = await query(`SELECT provider_id FROM programs WHERE id = $1`, [programId]);
  if (!prog[0]) throw err('Program not found', 'PROGRAM_NOT_FOUND', 404);
  if (actor.role === 'provider' && Number(prog[0].provider_id) !== actor.id) {
    throw err('Not your program', 'FORBIDDEN', 403);
  }

  const fromMs = from ? Date.parse(from) : Date.now();
  const toMs = to ? Date.parse(to) : fromMs + 14 * 24 * 3600 * 1000;
  const templates = await repo.listSlots(programId);
  const providerId = Number(prog[0].provider_id);

  const candidates = [];
  for (let day = new Date(fromMs); day <= new Date(toMs); day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    for (const t of templates) {
      if (t.weekday !== day.getUTCDay()) continue;
      const slotStart = `${date}T${t.start_time}Z`;
      if (Date.parse(slotStart) < fromMs || Date.parse(slotStart) >= toMs) continue;
      if (Date.parse(slotStart) < Date.now()) continue;
      candidates.push({ slot_start: slotStart, duration_minutes: t.duration_minutes, template_id: t.id });
    }
  }

  const open = [];
  for (const c of candidates) {
    const conflicts = await repo.findConflicts({
      slotStart: c.slot_start,
      durationMinutes: c.duration_minutes,
      providerId,
      studentId: -1, // provider-side picker: only provider conflicts matter here
    });
    if (conflicts.length === 0) open.push(c);
  }
  return { slots: open };
}

// --- schedule interview (FR-RS-06) ---

export async function schedule(applicationId, actor, input) {
  const context = await repo.findContext(applicationId);
  if (!context) throw err('Application not found', 'APPLICATION_NOT_FOUND', 404);
  assertProvider(context, actor);

  if (context.status !== 'shortlisted') {
    throw err(
      `Interviews can only be scheduled for shortlisted applications (current: ${context.status})`,
      'INVALID_APPLICATION_STATUS',
      409,
    );
  }

  const duration = input.duration_minutes ?? 30;
  if (Date.parse(input.slot_start) < Date.now()) {
    throw err('slot_start must be in the future', 'PAST_SLOT');
  }

  const conflicts = await repo.findConflicts({
    slotStart: input.slot_start,
    durationMinutes: duration,
    providerId: context.provider_id,
    studentId: context.student_id,
  });
  if (conflicts.length > 0) {
    throw err('Time slot conflicts with an existing interview', 'SLOT_CONFLICT', 409, {
      conflicts,
    });
  }

  const { getClient } = await import('../../config/db.js');
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const meetLink = input.mode === 'online' ? generateMeetLink() : null;
    const interview = await repo.createInterview(client, {
      programId: context.program_id,
      applicationId,
      slotStart: input.slot_start,
      durationMinutes: duration,
      mode: input.mode,
      meetLink,
      notes: input.notes,
      createdBy: actor.id,
    });

    const start = new Date(input.slot_start);
    const when = start.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    await notifyStudent(client, {
      userId: context.student_id,
      applicationId,
      interviewId: interview.id,
      kind: 'interview_scheduled',
      title: `Interview scheduled — ${context.program_title}`,
      body: `Your interview for "${context.program_title}" is on ${when} (${input.mode}).` +
        (meetLink ? ` Join: ${meetLink}` : ''),
    });

    await client.query('COMMIT');
    return { interview, meet_link: meetLink };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// --- list (FR-RS-07) ---

export async function listForProgram(programId, actor, bucket) {
  const { query } = await import('../../config/db.js');
  const { rows } = await query(`SELECT provider_id FROM programs WHERE id = $1`, [programId]);
  if (!rows[0]) throw err('Program not found', 'PROGRAM_NOT_FOUND', 404);
  if (actor.role === 'provider' && Number(rows[0].provider_id) !== actor.id) {
    throw err('Not your program', 'FORBIDDEN', 403);
  }
  const interviews = await repo.listByProgram(programId, bucket);
  return { bucket, interviews };
}

export async function listMine(actor) {
  if (actor.role !== 'student') throw err('Students only', 'FORBIDDEN', 403);
  const interviews = await repo.listForStudent(actor.id);
  return { interviews };
}

// --- reschedule by provider (FR-RS-07) ---

export async function reschedule(interviewId, actor, input) {
  const iv = await repo.findById(interviewId);
  if (!iv) throw err('Interview not found', 'INTERVIEW_NOT_FOUND', 404);
  assertProvider(iv, actor);

  if (!['scheduled', 'reschedule_requested'].includes(iv.status)) {
    throw err(`Cannot reschedule in status "${iv.status}"`, 'INVALID_TRANSITION', 409);
  }
  if (Date.parse(input.slot_start) < Date.now()) {
    throw err('slot_start must be in the future', 'PAST_SLOT');
  }

  const duration = input.duration_minutes ?? iv.duration_minutes;
  const conflicts = await repo.findConflicts({
    slotStart: input.slot_start,
    durationMinutes: duration,
    providerId: iv.provider_id,
    studentId: iv.student_id,
    excludeId: iv.id,
  });
  if (conflicts.length > 0) {
    throw err('Time slot conflicts with an existing interview', 'SLOT_CONFLICT', 409, { conflicts });
  }

  const { getClient } = await import('../../config/db.js');
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const updated = await repo.updateInterview(client, iv.id, {
      slot_start: input.slot_start,
      duration_minutes: input.duration_minutes,
      mode: input.mode,
      notes: input.notes,
      status: 'scheduled',
      reschedule_note: null,
      proposed_slot_start: null,
      meet_link: (input.mode ?? iv.mode) === 'online' && !iv.meet_link ? generateMeetLink() : iv.meet_link,
    });

    const when = new Date(input.slot_start).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    await notifyStudent(client, {
      userId: iv.student_id,
      applicationId: iv.application_id,
      interviewId: iv.id,
      kind: 'interview_rescheduled',
      title: `Interview rescheduled — ${iv.program_title}`,
      body: `Your interview for "${iv.program_title}" moved to ${when} (UTC).` +
        (updated.meet_link ? ` Join: ${updated.meet_link}` : ''),
    });

    await client.query('COMMIT');
    return { interview: updated };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// --- student requests another slot (FR-RS-09) ---

export async function requestSlot(interviewId, actor, input) {
  const iv = await repo.findById(interviewId);
  if (!iv) throw err('Interview not found', 'INTERVIEW_NOT_FOUND', 404);
  if (actor.role !== 'student' || Number(iv.student_id) !== actor.id) {
    throw err('Not your interview', 'FORBIDDEN', 403);
  }
  if (iv.status !== 'scheduled') {
    throw err(`Cannot request a slot in status "${iv.status}"`, 'INVALID_TRANSITION', 409);
  }

  const updated = await repo.updateInterview(
    (await import('../../config/db.js')).pool,
    iv.id,
    {
      status: 'reschedule_requested',
      proposed_slot_start: input.proposed_slot_start,
      reschedule_note: input.note ?? null,
    },
  );
  return { interview: updated };
}

// --- provider marks outcome (FR-RS-07 no-show / past handling) ---

export async function setStatus(interviewId, actor, input) {
  const iv = await repo.findById(interviewId);
  if (!iv) throw err('Interview not found', 'INTERVIEW_NOT_FOUND', 404);
  assertProvider(iv, actor);

  if (!['scheduled', 'reschedule_requested'].includes(iv.status)) {
    throw err(`Cannot change status from "${iv.status}"`, 'INVALID_TRANSITION', 409);
  }

  const updated = await repo.updateInterview((await import('../../config/db.js')).pool, iv.id, {
    status: input.status,
    notes: input.notes,
  });
  return { interview: updated };
}
