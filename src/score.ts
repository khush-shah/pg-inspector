import { AnalysisResult, HealthScore, WorkloadProfile, PROFILE_CONFIGS } from './types';

export function computeHealthScore(
  result: Omit<AnalysisResult, 'healthScore'>,
  profile: WorkloadProfile = 'oltp',
): HealthScore {
  const cfg = PROFILE_CONFIGS[profile];

  // ── Slow Queries (0–25) ──────────────────────────────────────────────────
  // Weight by fraction of total DB time consumed — not raw query count.
  // A weekly batch job at 200ms barely moves the needle.
  // A hot-path called 100k/day at 200ms is the real problem.
  const slowQueryTotalMs = result.slowQueries.reduce((sum, q) => sum + q.totalTimeMs, 0);
  const allMs = result.allQueryTotalMs ?? 0;

  let slowQueryScore: number;
  if (allMs === 0 || result.slowQueries.length === 0) {
    // No pg_stat_statements data or no slow queries → full score
    slowQueryScore = 25;
  } else {
    const slowFraction = Math.min(slowQueryTotalMs / allMs, 1);
    // 0% → 25pts  |  10% → 20pts  |  25% → 12pts  |  50%+ → 0pts
    slowQueryScore = Math.max(0, Math.round(25 * (1 - slowFraction * 2)));
  }

  // ── Index Health (0–25) ──────────────────────────────────────────────────
  const unusedPenalty = result.unusedIndexes.reduce(
    (sum, idx) => sum + (idx.isFkSupporting ? 1 : 3), 0,
  );
  const indexScore = Math.max(0, 25 - unusedPenalty - result.bloatedIndexes.length * 4);

  // ── Cache Hit Rate (0–25) — profile-aware ────────────────────────────────
  // OLAP databases are expected to have low cache hit rates; penalising them
  // identically to OLTP databases gives a meaningless score.
  let cacheScore: number;
  const chr = result.cacheHitRate;
  if      (chr >= cfg.cacheHitExcellent) cacheScore = 25;
  else if (chr >= cfg.cacheHitGood)      cacheScore = 20;
  else if (chr >= cfg.cacheHitFair)      cacheScore = 15;
  else if (chr >= cfg.cacheHitPoor)      cacheScore = 8;
  else if (chr >= cfg.cacheHitBad)       cacheScore = 4;
  else                                   cacheScore = 0;

  // ── Lock Health (0–25) — profile-aware long-running threshold ────────────
  // Long-running transactions are normal in OLAP (multi-minute reports).
  // For OLTP, anything over 30s is a problem.
  const blockedCount  = result.locks.filter((l) => l.blockedBy !== null).length;
  const idleInTxCount = result.locks.filter((l) => l.isIdleInTransaction).length;
  const longRunning   = result.locks.filter((l) => {
    const secs = parseInt(l.duration.replace('s', '')) || 0;
    return secs > cfg.longRunningTxSecs && !l.isIdleInTransaction;
  }).length;
  const lockScore = Math.max(0, 25 - blockedCount * 8 - idleInTxCount * 5 - longRunning * 3);

  const total = slowQueryScore + indexScore + cacheScore + lockScore;

  let grade: HealthScore['grade'];
  if      (total >= 90) grade = 'A';
  else if (total >= 75) grade = 'B';
  else if (total >= 60) grade = 'C';
  else if (total >= 40) grade = 'D';
  else                  grade = 'F';

  return {
    total,
    breakdown: {
      slowQueries: slowQueryScore,
      indexHealth: indexScore,
      cacheHitRate: cacheScore,
      lockHealth: lockScore,
    },
    grade,
  };
}
