import * as repo from './repository.js';
import { computeScore, DEFAULT_SCORING, resolveScoringConfig } from './scoring.js';

function err(message, code, status = 400) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

async function assertOwnership(programId, actor) {
  const { query } = await import('../../config/db.js');
  const { rows } = await query(
    `SELECT id, provider_id FROM programs WHERE id = $1`,
    [programId],
  );
  if (!rows[0]) throw err('Program not found', 'PROGRAM_NOT_FOUND', 404);
  if (actor.role !== 'admin' && Number(rows[0].provider_id) !== actor.id) {
    throw err('Not your program', 'FORBIDDEN', 403);
  }
  return rows[0];
}

async function computeRanking(programId) {
  const weights = await repo.getWeights(programId);
  const storedConfig = await repo.getScoringConfig(programId);
  const config = resolveScoringConfig(storedConfig);

  const apps = await repo.getApplicationsWithInputs(programId);
  const computed = apps.map((a) => {
    const household =
      a.monthly_income !== null || a.family_size !== null
        ? { family_size: a.family_size, earners: a.earners, monthly_income: a.monthly_income }
        : null;
    const { score, breakdown } = computeScore(
      { cgpa: a.cgpa, attendance_pct: a.attendance_pct, household },
      weights,
      config,
    );
    return { id: a.id, score, breakdown };
  });

  computed.sort((x, y) => y.score - x.score || x.id - y.id);
  const ranked = computed.map((c, i) => ({ ...c, rank: i + 1 }));
  const count = await repo.saveRankedScores(programId, ranked);
  await repo.refreshDuplicateAidFlags(apps.map((a) => a.id));

  return { weights, config, ranked, count };
}

/** GET — weights + resolved scoring config (FR-RS-02). */
export async function getProgramWeights(programId) {
  const weights = await repo.getWeights(programId);
  const stored = await repo.getScoringConfig(programId);
  return { weights, scoring: resolveScoringConfig(stored) };
}

/**
 * PUT — weights (Σ=100) + optional per-program scoring config → re-rank.
 * Scoring keys not provided stay as-is; omitted config leaves defaults.
 */
export async function saveWeightsAndRerank(programId, actor, { weights, scoring }) {
  await assertOwnership(programId, actor);

  if (weights.merit + weights.need + weights.attendance !== 100) {
    throw err('Weights must sum to 100%', 'WEIGHTS_SUM');
  }

  const savedWeights = await repo.upsertWeights(programId, weights);

  let savedScoring;
  if (scoring) {
    // merge over current stored config so partial updates work
    const current = await repo.getScoringConfig(programId);
    savedScoring = await repo.saveScoringConfig(programId, { ...current, ...scoring });
  } else {
    savedScoring = resolveScoringConfig(await repo.getScoringConfig(programId));
  }

  const { ranked, count } = await computeRanking(programId);

  return {
    weights: savedWeights,
    scoring: resolveScoringConfig(savedScoring),
    reranked: true,
    applications_ranked: count,
    top5: ranked.slice(0, 5).map((r) => ({
      application_id: r.id,
      rank: r.rank,
      score: r.score,
    })),
  };
}

/** Recompute ranks for a program (manual refresh / after new submissions). */
export async function rerankProgram(programId) {
  const { weights, config, count } = await computeRanking(programId);
  return { weights, scoring: config, applications_ranked: count };
}

export { DEFAULT_SCORING };
