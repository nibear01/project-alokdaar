import * as repo from './repository.js';

/**
 * Program lifecycle (Program Lifecycle State Diagram):
 *
 *   draft --publish--> open --pause--> paused --resume--> open
 *   open|paused --close--> closed            (manual)
 *   open|paused --auto--> closed             (deadline passed / fund exhausted)
 *
 * draft can be edited; open/paused edit-locked after publish except fund/deadline? RULES:
 * "Auto-close when deadline passes or fund exhausted."
 */

const TRANSITIONS = {
  publish: { from: ['draft'], to: 'open' },
  pause: { from: ['open'], to: 'paused' },
  resume: { from: ['paused'], to: 'open' },
  close: { from: ['open', 'paused'], to: 'closed' },
};

function lifecycleError(message, code, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function assertEditable(program) {
  if (program.status !== 'draft') {
    throw lifecycleError(
      'Only draft programs can be edited — publish rules apply after open',
      'PROGRAM_LOCKED',
      409,
    );
  }
}

export async function createProgram(providerId, input) {
  return repo.insertProgram(providerId, input);
}

export async function getProgram(id) {
  const program = await repo.findProgramById(id);
  if (!program) throw lifecycleError('Program not found', 'PROGRAM_NOT_FOUND', 404);
  return program;
}

/** Provider must own the program (admins pass through). */
export async function getOwnedProgram(id, actor) {
  const program = await getProgram(id);
  if (actor.role !== 'admin' && Number(program.provider_id) !== actor.id) {
    throw lifecycleError('Not your program', 'FORBIDDEN', 403);
  }
  return program;
}

export async function updateProgram(id, actor, input) {
  const program = await getOwnedProgram(id, actor);
  assertEditable(program);
  return repo.updateProgram(id, input);
}

export async function transition(id, actor, action) {
  const rule = TRANSITIONS[action];
  if (!rule) throw lifecycleError('Unknown lifecycle action', 'UNKNOWN_ACTION', 404);

  const program = await getOwnedProgram(id, actor);
  if (!rule.from.includes(program.status)) {
    throw lifecycleError(
      `Cannot ${action} a program in status "${program.status}" (allowed from: ${rule.from.join(', ')})`,
      'INVALID_TRANSITION',
      409,
    );
  }

  // publish sanity: needs seats + fund + deadline
  if (action === 'publish') {
    if (!Number(program.seats)) {
      throw lifecycleError('Set seats before publishing', 'SEATS_REQUIRED');
    }
    if (!Number(program.amount_per_student)) {
      throw lifecycleError('Set amount_per_student before publishing', 'AMOUNT_REQUIRED');
    }
    if (program.deadline && new Date(program.deadline) <= new Date()) {
      throw lifecycleError('Deadline is in the past', 'DEADLINE_PAST');
    }
  }

  const updated = await repo.transitionStatus(id, rule.from, rule.to);
  if (!updated) {
    throw lifecycleError('Concurrent status change — reload and retry', 'CONFLICT', 409);
  }
  return updated;
}

export async function listPrograms(actor, query) {
  const filters = {
    status: query.status,
    page: query.page,
    limit: query.limit,
  };
  // mine=true → only caller's programs; otherwise admins see all, providers see own
  if (query.mine === true || actor.role === 'provider') {
    filters.providerId = actor.id;
  }
  if (actor.role === 'admin' && query.mine !== true && !query.provider_id) {
    delete filters.providerId; // admin sees everything unless filtering own
  }
  const rows = await repo.listPrograms(filters);
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    programs: rows.map(({ total_count, ...p }) => p),
    page: query.page,
    limit: query.limit,
    total,
  };
}
