import { AnalysisResult, HealthScore } from './types';

export function computeHealthScore(result: Omit<AnalysisResult, 'healthScore'>): HealthScore {
  // ── Slow Queries (0-25) ──────────────────────────────────────────────────────
  // 25 = no slow queries
  // deduct 5 per slow query found, min 0
  const slowQueryScore = Math.max(0, 25 - result.slowQueries.length * 5);

  // ── Index Health (0-25) ──────────────────────────────────────────────────────
  // 25 = no unused or bloated indexes
  // deduct 3 per unused index, 4 per bloated index, min 0
  const indexScore = Math.max(
    0,
    25 - result.unusedIndexes.length * 3 - result.bloatedIndexes.length * 4
  );

  // ── Cache Hit Rate (0-25) ────────────────────────────────────────────────────
  // 100% hit = 25, 90% = 15, 80% = 5, <80% = 0
  let cacheScore: number;
  if (result.cacheHitRate >= 99) cacheScore = 25;
  else if (result.cacheHitRate >= 95) cacheScore = 20;
  else if (result.cacheHitRate >= 90) cacheScore = 15;
  else if (result.cacheHitRate >= 85) cacheScore = 8;
  else if (result.cacheHitRate >= 80) cacheScore = 4;
  else cacheScore = 0;

  // ── Lock Health (0-25) ───────────────────────────────────────────────────────
  // 25 = no blocked queries
  // deduct 8 per blocked query, 3 per long-running query, min 0
  const blockedCount = result.locks.filter((l) => l.blockedBy !== null).length;
  const longRunning = result.locks.filter((l) => {
    const secs = parseInt(l.duration.replace('s', '')) || 0;
    return secs > 30;
  }).length;
  const lockScore = Math.max(0, 25 - blockedCount * 8 - longRunning * 3);

  const total = slowQueryScore + indexScore + cacheScore + lockScore;

  let grade: HealthScore['grade'];
  if (total >= 90) grade = 'A';
  else if (total >= 75) grade = 'B';
  else if (total >= 60) grade = 'C';
  else if (total >= 40) grade = 'D';
  else grade = 'F';

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
