import { AnalysisResult, HealthScore } from './types';

export function computeHealthScore(result: Omit<AnalysisResult, 'healthScore'>): HealthScore {
  const slowQueryScore = Math.max(0, 25 - result.slowQueries.length * 5);

  const unusedPenalty = result.unusedIndexes.reduce(
    (sum, idx) => sum + (idx.isFkSupporting ? 1 : 3), 0
  );
  const indexScore = Math.max(0, 25 - unusedPenalty - result.bloatedIndexes.length * 4);

  let cacheScore: number;
  if (result.cacheHitRate >= 99) cacheScore = 25;
  else if (result.cacheHitRate >= 95) cacheScore = 20;
  else if (result.cacheHitRate >= 90) cacheScore = 15;
  else if (result.cacheHitRate >= 85) cacheScore = 8;
  else if (result.cacheHitRate >= 80) cacheScore = 4;
  else cacheScore = 0;

  const blockedCount = result.locks.filter((l) => l.blockedBy !== null).length;
  const idleInTxCount = result.locks.filter((l) => l.isIdleInTransaction).length;
  const longRunning = result.locks.filter((l) => {
    const secs = parseInt(l.duration.replace('s', '')) || 0;
    return secs > 30 && !l.isIdleInTransaction;
  }).length;
  const lockScore = Math.max(0, 25 - blockedCount * 8 - idleInTxCount * 5 - longRunning * 3);

  const total = slowQueryScore + indexScore + cacheScore + lockScore;

  let grade: HealthScore['grade'];
  if (total >= 90) grade = 'A';
  else if (total >= 75) grade = 'B';
  else if (total >= 60) grade = 'C';
  else if (total >= 40) grade = 'D';
  else grade = 'F';

  return {
    total,
    breakdown: { slowQueries: slowQueryScore, indexHealth: indexScore, cacheHitRate: cacheScore, lockHealth: lockScore },
    grade,
  };
}
