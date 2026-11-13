import * as repo from './repository.js';

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
