import * as repo from './repository.js';
import { notify } from '../../lib/notify.js';

function err(message, code, status = 400, details) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  if (details) e.details = details;
  return e;
}

// --- decision rules (Application Lifecycle State Diagram) ---

const DECISION_TO = {
  shortlist: 'shortlisted',
  approve: 'approved',
  reject: 'rejected',
  waitlist: 'waitlisted',
};

const DECISION_FROM = {
  shortlist: ['submitted', 'under_review'],
  approve: ['submitted', 'under_review', 'shortlisted', 'waitlisted'],
  reject: ['submitted', 'under_review', 'shortlisted', 'waitlisted'],
  waitlist: ['submitted', 'under_review', 'shortlisted'],
};

function assertOwnership(detail, actor) {
  if (actor.role === 'student') throw err('Forbidden for students', 'FORBIDDEN', 403);
  if (actor.role === 'provider' && Number(detail.provider_id) !== actor.id) {
    throw err('Not your program', 'FORBIDDEN', 403);
  }
}

function rowToQueueItem(row) {
  const { total_count, student_id, student_name, student_email, score_breakdown, ...app } = row;
  return {
    ...app,
    student: { id: student_id, name: student_name, email: student_email },
    breakdown: score_breakdown,
  };
}

/**
 * Review queue for a program (FR-RS-01).
 * Access: owning provider or admin.
 */
export async function getQueue(programId, actor, filters) {
  const { query } = await import('../../config/db.js');
  const { rows } = await query(`SELECT provider_id FROM programs WHERE id = $1`, [programId]);
  if (!rows[0]) throw err('Program not found', 'PROGRAM_NOT_FOUND', 404);
  if (actor.role === 'provider' && Number(rows[0].provider_id) !== actor.id) {
    throw err('Not your program', 'FORBIDDEN', 403);
  }
  if (actor.role === 'student') throw err('Forbidden for students', 'FORBIDDEN', 403);

  const rowsQ = await repo.queueForProgram(programId, filters);
  const total = rowsQ.length ? Number(rowsQ[0].total_count) : 0;
  return {
    applications: rowsQ.map(rowToQueueItem),
    page: filters.page,
    limit: filters.limit,
    total,
  };
}

/**
 * Applicant detail (FR-RS-03).
 * Access: owning provider, the student themselves, or admin.
 */
export async function getDetail(applicationId, actor) {
  const detail = await repo.findDetail(applicationId);
  if (!detail) throw err('Application not found', 'APPLICATION_NOT_FOUND', 404);

  if (actor.role === 'student' && Number(detail.student_id) !== actor.id) {
    throw err('Forbidden', 'FORBIDDEN', 403);
  }
  if (actor.role === 'provider' && Number(detail.provider_id) !== actor.id) {
    throw err('Forbidden', 'FORBIDDEN', 403);
  }

  const [trend, household, events] = await Promise.all([
    repo.academicTrend(detail.student_id),
    repo.householdRecord(detail.student_id),
    repo.timeline(detail.application_id ?? detail.id),
  ]);

  const {
    student_name, student_email, student_phone, student_locale,
    program_title, amount_per_student, seats, deadline, program_status, provider_id,
    statement, score_breakdown, score, rank, status, duplicate_aid,
    decision_remarks, force_reason, submitted_at, decided_at,
    program_id, student_id,
    id,
  } = detail;

  return {
    application: {
      id, program_id, student_id, statement, status, score, rank,
      score_breakdown, duplicate_aid, decision_remarks, force_reason,
      submitted_at, decided_at,
    },
    student: {
      id: student_id, name: student_name, email: student_email,
      phone: student_phone, locale: student_locale,
    },
    program: {
      id: program_id, title: program_title, amount_per_student, seats,
      deadline, status: program_status,
    },
    academic_trend: trend,
    household,
    timeline: events,
    // "Why this rank?" — convenience views of the stored breakdown
    score_explanation: {
      total: score_breakdown?.total ?? score,
      weights: score_breakdown
        ? {
            merit: score_breakdown.merit?.weight,
            need: score_breakdown.need?.weight,
            attendance: score_breakdown.attendance?.weight,
          }
        : null,
      parts: score_breakdown,
    },
  };
}

// --- pre-approve duplicate-aid check (FR-RS-04, Sequence 1) ---

export async function preApproveCheck(applicationId, actor) {
  const row = await repo.findForDecision(applicationId);
  if (!row) throw err('Application not found', 'APPLICATION_NOT_FOUND', 404);
  assertOwnership(row, actor);

  const conflicts = await repo.findActiveScholarships(row.student_id, row.id);
  return {
    application_id: row.id,
    conflict: conflicts.length > 0,
    existing: conflicts[0] || null,
    seats_available: row.seats_available,
    amount_per_student: row.amount_per_student,
  };
}

// --- decide (FR-RS-05) ---

async function applyDecision(client, row, input, actor) {
  const toStatus = DECISION_TO[input.decision];
  const allowedFrom = DECISION_FROM[input.decision];

  if (!allowedFrom.includes(row.status)) {
    throw err(
      `Cannot ${input.decision} an application in status "${row.status}" (allowed from: ${allowedFrom.join(', ')})`,
      'INVALID_TRANSITION',
      409,
    );
  }

  if (input.decision === 'reject' && !input.remarks) {
    throw err('Remarks are required to reject', 'REMARKS_REQUIRED');
  }

  let seatsAvailable = row.seats_available;
  let waitlistPosition = null;
  let existing = null;

  if (input.decision === 'approve') {
    // duplicate-aid guard — live query, not the cached flag
    const conflicts = await repo.findActiveScholarships(row.student_id, row.id);
    if (conflicts.length > 0 && !input.force_reason) {
      throw err(
        'Student already holds an active scholarship — provide force_reason to override',
        'DUPLICATE_AID',
        409,
        { existing: conflicts[0] },
      );
    }
    existing = conflicts[0] || null;

    const seats = await repo.decrementSeats(client, row.program_id);
    if (seats === null) {
      throw err('No seats left — use waitlist instead', 'SEATS_EXHAUSTED', 409);
    }
    seatsAvailable = seats;
    await repo.removeFromWaitlist(client, row.id);
  }

  if (input.decision === 'waitlist') {
    const position = input.position ?? (await repo.nextWaitlistPosition(client, row.program_id));
    await repo.removeFromWaitlist(client, row.id); // re-waitlisting safety
    await repo.shiftWaitlist(client, row.program_id, position);
    await repo.insertWaitlist(client, {
      programId: row.program_id,
      applicationId: row.id,
      position,
    });
    waitlistPosition = position;
  }

  if (input.decision === 'reject' || input.decision === 'shortlist') {
    await repo.removeFromWaitlist(client, row.id);
  }

  const note =
    input.decision === 'reject'
      ? input.remarks
      : input.decision === 'approve'
        ? [input.message, input.force_reason && `forced: ${input.force_reason}`].filter(Boolean).join(' | ')
        : input.remarks ?? null;

  const updated = await repo.updateDecision(client, row.id, {
    toStatus,
    remarks: input.decision === 'approve' ? input.message ?? input.remarks ?? null : input.remarks ?? null,
    forceReason: input.decision === 'approve' ? input.force_reason ?? null : null,
  });

  await repo.insertEvent(client, {
    applicationId: row.id,
    fromStatus: row.status,
    toStatus,
    actorId: actor.id,
    actorRole: actor.role,
    note,
  });

  return {
    application: updated,
    seats_available: seatsAvailable,
    waitlist_position: waitlistPosition,
    duplicate_aid_override: input.decision === 'approve' ? existing : null,
  };
}

export async function decide(applicationId, actor, input) {
  const row = await repo.findForDecision(applicationId);
  if (!row) throw err('Application not found', 'APPLICATION_NOT_FOUND', 404);
  assertOwnership(row, actor);

  const { getClient } = await import('../../config/db.js');
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await applyDecision(client, row, input, actor);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** FR-RS-01: bulk shortlist/reject — per-item validation, partial success reported. */
export async function bulkDecide(programId, actor, input) {
  const { query } = await import('../../config/db.js');
  const { rows } = await query(`SELECT provider_id FROM programs WHERE id = $1`, [programId]);
  if (!rows[0]) throw err('Program not found', 'PROGRAM_NOT_FOUND', 404);
  if (actor.role === 'provider' && Number(rows[0].provider_id) !== actor.id) {
    throw err('Not your program', 'FORBIDDEN', 403);
  }

  const { getClient } = await import('../../config/db.js');
  const client = await getClient();
  const updated = [];
  const skipped = [];

  try {
    await client.query('BEGIN');

    for (const appId of input.application_ids) {
      const row = await repo.findForDecision(appId);
      if (!row || Number(row.program_id) !== Number(programId)) {
        skipped.push({ id: appId, reason: 'NOT_IN_PROGRAM' });
        continue;
      }
      try {
        const result = await applyDecision(
          client,
          { ...row, seats_available: row.seats_available, provider_id: rows[0].provider_id },
          { decision: input.decision, remarks: input.remarks },
          actor,
        );
        updated.push(result.application);
      } catch (e) {
        skipped.push({ id: appId, reason: e.code || 'ERROR', message: e.message });
      }
    }

    await client.query('COMMIT');
    return { decision: input.decision, updated, skipped, counts: { updated: updated.length, skipped: skipped.length } };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// --- withdraw + auto-promote (FR-DA-05, FR-RS-08) ---

/**
 * Student withdraws own application.
 * Deadline lock applies to pre-decision states only (RULES: edit-locked after
 * deadline); waitlisted/approved may withdraw anytime so seat release +
 * auto-promote stay available post-deadline.
 * Approved withdrawal frees a seat → promotes the next waitlisted applicant.
 */
export async function withdraw(applicationId, actor, input) {
  if (actor.role !== 'student') throw err('Students only', 'FORBIDDEN', 403);
  const row = await repo.findForDecision(applicationId);
  if (!row) throw err('Application not found', 'APPLICATION_NOT_FOUND', 404);
  if (Number(row.student_id) !== actor.id) throw err('Not your application', 'FORBIDDEN', 403);

  const PRE_DECISION = ['submitted', 'under_review', 'shortlisted'];
  if (PRE_DECISION.includes(row.status) && Date.parse(row.deadline) < Date.now()) {
    throw err('Edit/withdraw is locked after the deadline', 'DEADLINE_PASSED', 409, {
      deadline: row.deadline,
    });
  }
  if (['rejected', 'withdrawn'].includes(row.status)) {
    throw err(`Cannot withdraw from status "${row.status}"`, 'INVALID_TRANSITION', 409);
  }
  if (row.status === 'draft') {
    // M2 wizard drafts are discarded, not withdrawn (DELETE /api/discovery/applications/:id)
    throw err('Drafts are deleted, not withdrawn', 'INVALID_TRANSITION', 409);
  }

  const wasApproved = row.status === 'approved';
  const { getClient } = await import('../../config/db.js');
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: updatedRows } = await client.query(
      `UPDATE applications
       SET status = 'withdrawn', updated_at = now()
       WHERE id = $1
       RETURNING id, program_id, student_id, status, rank, score`,
      [row.id],
    );
    await repo.insertEvent(client, {
      applicationId: row.id,
      fromStatus: row.status,
      toStatus: 'withdrawn',
      actorId: actor.id,
      actorRole: 'student',
      note: input.reason ?? null,
    });
    await repo.removeFromWaitlist(client, row.id);
    const cancelledInterviews = await repo.cancelOpenInterviews(client, row.id);

    let promoted = null;
    let seatsAvailable = row.seats_available;

    if (wasApproved) {
      seatsAvailable = await repo.freeSeat(client, row.program_id);

      const next = await repo.findNextWaitlist(client, row.program_id);
      if (next) {
        // consume the freed seat for the promote — net seat change zero
        const seats = await repo.decrementSeats(client, row.program_id);
        if (seats !== null) {
          seatsAvailable = seats;
          const { rows: promoRows } = await client.query(
            `UPDATE applications
             SET status = 'approved', decided_at = now(), updated_at = now()
             WHERE id = $1
             RETURNING id, program_id, student_id, status, rank, score, decided_at`,
            [next.application_id],
          );
          promoted = promoRows[0];
          await repo.removeFromWaitlist(client, next.application_id);
          await repo.insertEvent(client, {
            applicationId: next.application_id,
            fromStatus: 'waitlisted',
            toStatus: 'approved',
            actorId: null,
            actorRole: 'system',
            note: 'Auto-promoted: seat freed by withdrawal',
          });
          await notify(client, {
            userId: next.student_id,
            applicationId: next.application_id,
            kind: 'waitlist_promoted',
            title: `You've been promoted — ${row.program_title}`,
            body: `A seat opened up for "${row.program_title}" and you've been approved (rank #${next.rank}).`,
          });
        }
      }
    }

    await client.query('COMMIT');
    const { rows: finalRow } = await client.query(
      `SELECT id, program_id, student_id, status, rank, score FROM applications WHERE id = $1`,
      [row.id],
    );
    return {
      application: finalRow[0],
      promoted,
      seats_available: seatsAvailable,
      cancelled_interviews: cancelledInterviews,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// --- waitlist view / reorder / manual promote (FR-RS-08) ---

async function assertProgramOwned(programId, actor) {
  const { query } = await import('../../config/db.js');
  const { rows } = await query(`SELECT provider_id FROM programs WHERE id = $1`, [programId]);
  if (!rows[0]) throw err('Program not found', 'PROGRAM_NOT_FOUND', 404);
  if (actor.role === 'provider' && Number(rows[0].provider_id) !== actor.id) {
    throw err('Not your program', 'FORBIDDEN', 403);
  }
}

export async function listWaitlist(programId, actor) {
  await assertProgramOwned(programId, actor);
  const waitlist = await repo.listWaitlist(programId);
  return { waitlist, total: waitlist.length };
}

export async function reorderWaitlist(programId, actor, applicationIds) {
  await assertProgramOwned(programId, actor);
  const current = await repo.listWaitlist(programId);
  const currentIds = current.map((r) => Number(r.application_id));
  const nextIds = applicationIds.map(Number);
  const sameSet =
    nextIds.length === currentIds.length &&
    new Set(nextIds).size === nextIds.length &&
    nextIds.every((id) => currentIds.includes(id));
  if (!sameSet) {
    throw err(
      'Reorder must include exactly the current waitlist entries, each once',
      'WAITLIST_MISMATCH',
      409,
      { expected: currentIds, received: nextIds },
    );
  }

  const { getClient } = await import('../../config/db.js');
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // offset first so the unique (program_id, position) constraint never fires mid-swap
    await client.query(`UPDATE waitlist SET position = position + 100000 WHERE program_id = $1`, [programId]);
    for (let i = 0; i < nextIds.length; i++) {
      await client.query(
        `UPDATE waitlist SET position = $1 WHERE program_id = $2 AND application_id = $3`,
        [i + 1, programId, nextIds[i]],
      );
    }
    await client.query('COMMIT');
    return { waitlist: await repo.listWaitlist(programId) };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Manual promote — only waitlisted rows; reuses approve rules (seats, duplicate-aid, events). */
export async function promoteFromWaitlist(programId, applicationId, actor, input = {}) {
  await assertProgramOwned(programId, actor);
  const row = await repo.findForDecision(applicationId);
  if (!row || Number(row.program_id) !== Number(programId)) {
    throw err('Application not in this program', 'NOT_IN_PROGRAM', 404);
  }
  if (row.status !== 'waitlisted') {
    throw err(
      `Only waitlisted applications can be promoted (current: ${row.status})`,
      'INVALID_TRANSITION',
      409,
    );
  }
  return decide(applicationId, actor, { decision: 'approve', ...input });
}
