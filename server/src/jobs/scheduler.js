import { getClient, query } from '../config/db.js';
import { notify } from '../lib/notify.js';

/**
 * In-process scheduler (ARCHITECTURE §9: "Render worker or in-process scheduler").
 * Runs every 15 minutes; each job is independent and failure-isolated. Reminder
 * jobs dedupe through notify({ dedupHours }), so a restart never double-sends.
 * Disable with JOBS_ENABLED=false (tests, one-off scripts).
 */

const INTERVAL_MS = 15 * 60 * 1000;
const STARTUP_DELAY_MS = 10 * 1000;

/** Auto-close open programs whose deadline passed or seats ran out (RULES §2, M4.1). */
export async function autoClosePrograms() {
  const { rows } = await query(
    `UPDATE programs
     SET status = 'closed', updated_at = now()
     WHERE status = 'open'
       AND ((deadline IS NOT NULL AND deadline < now())
            OR (seats > 0 AND seats_available <= 0))
     RETURNING id, title, provider_id,
               (deadline IS NOT NULL AND deadline < now()) AS deadline_passed`,
  );
  for (const p of rows) {
    const client = await getClient();
    try {
      await notify(client, {
        userId: p.provider_id,
        kind: `program_auto_closed:${p.id}`,
        title: `Programme closed: ${p.title}`,
        body: p.deadline_passed
          ? 'The application deadline has passed, so the programme was closed automatically.'
          : 'All seats are taken, so the programme was closed automatically.',
        dedupHours: 24,
      });
    } finally {
      client.release();
    }
  }
  return rows.length;
}

/** Remind providers 48h before an open programme's deadline (FR-M2-03). */
export async function programDeadlineReminders() {
  const { rows } = await query(
    `SELECT id, title, provider_id, seats, seats_available, deadline
     FROM programs
     WHERE status = 'open'
       AND deadline IS NOT NULL
       AND deadline BETWEEN now() AND now() + interval '48 hours'`,
  );
  let sent = 0;
  for (const p of rows) {
    const client = await getClient();
    try {
      const hours = Math.max(1, Math.round((new Date(p.deadline) - Date.now()) / 36e5));
      const r = await notify(client, {
        userId: p.provider_id,
        kind: `program_deadline:${p.id}`,
        title: `${p.title} closes in ~${hours}h`,
        body: `${p.seats_available} of ${p.seats} seats are still unfilled. The programme auto-closes at the deadline.`,
        dedupHours: 24,
      });
      if (!r.deduped) sent += 1;
    } finally {
      client.release();
    }
  }
  return sent;
}

/**
 * Nudge students who still have a rejected document 24h after the rejection
 * (FR-M2-03 + FR-DV-03). Student-side "unfinished application" reminders join
 * here once M2 adds drafts/bookmarks — noted in TASKS.
 */
export async function rejectedDocumentReminders() {
  const { rows } = await query(
    `SELECT id, student_id, kind
     FROM documents
     WHERE status = 'rejected'
       AND superseded_at IS NULL AND deleted_at IS NULL
       AND reviewed_at < now() - interval '24 hours'`,
  );
  let sent = 0;
  for (const d of rows) {
    const client = await getClient();
    try {
      const r = await notify(client, {
        userId: d.student_id,
        kind: `document_reupload_reminder:${d.id}`,
        title: 'A document still needs a re-upload',
        body: 'One of your documents was rejected. Re-upload it from your Document Vault so your applications stay complete.',
        dedupHours: 72,
      });
      if (!r.deduped) sent += 1;
    } finally {
      client.release();
    }
  }
  return sent;
}

const JOBS = [autoClosePrograms, programDeadlineReminders, rejectedDocumentReminders];

async function tick() {
  for (const job of JOBS) {
    try {
      const result = await job();
      if (result) console.log(`[jobs] ${job.name}: ${result}`);
      await query(
        `INSERT INTO job_runs (name, last_run_at) VALUES ($1, now())
         ON CONFLICT (name) DO UPDATE SET last_run_at = now()`,
        [job.name],
      );
    } catch (err) {
      // DB down or job bug — log and keep the server healthy
      console.error(`[jobs] ${job.name} failed:`, err.message);
    }
  }
}

export function startJobs() {
  if (process.env.JOBS_ENABLED === 'false') {
    console.log('[jobs] disabled (JOBS_ENABLED=false)');
    return null;
  }
  setTimeout(tick, STARTUP_DELAY_MS);
  const handle = setInterval(tick, INTERVAL_MS);
  handle.unref?.(); // never keep the process alive on its own
  console.log('[jobs] scheduler on — every 15 min: auto-close, deadline + re-upload reminders');
  return handle;
}
