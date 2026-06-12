import fs from 'fs';
import path from 'path';
import { AnalysisResult, DiffReport } from './types';

interface BaselineFile {
  savedAt: string;
  result: AnalysisResult;
}

export function saveBaseline(result: AnalysisResult, outPath: string): void {
  const data = JSON.stringify({ savedAt: new Date().toISOString(), result }, null, 2);
  fs.writeFileSync(path.resolve(outPath), data, 'utf-8');
}

export function loadBaseline(filePath: string): BaselineFile {
  const raw = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const parsed = JSON.parse(raw) as BaselineFile;
  // analyzedAt is serialised as a string — restore it as a Date
  parsed.result.analyzedAt = new Date(parsed.result.analyzedAt);
  return parsed;
}

export function diffBaseline(baseline: AnalysisResult, current: AnalysisResult): DiffReport {
  const baselineQueryIds = new Set(baseline.slowQueries.map((q) => q.queryId));
  const currentQueryIds  = new Set(current.slowQueries.map((q) => q.queryId));

  const baselineIndexes = new Set(baseline.unusedIndexes.map((i) => `${i.schema}.${i.index}`));
  const currentIndexes  = new Set(current.unusedIndexes.map((i) => `${i.schema}.${i.index}`));

  return {
    scoreBefore: baseline.healthScore.total,
    scoreAfter:  current.healthScore.total,
    scoreDelta:  current.healthScore.total - baseline.healthScore.total,
    gradeBefore: baseline.healthScore.grade,
    gradeAfter:  current.healthScore.grade,

    newSlowQueries: current.slowQueries
      .filter((q) => !baselineQueryIds.has(q.queryId))
      .map((q) => q.query.slice(0, 80)),

    resolvedSlowQueries: baseline.slowQueries
      .filter((q) => !currentQueryIds.has(q.queryId))
      .map((q) => q.query.slice(0, 80)),

    newUnusedIndexes: current.unusedIndexes
      .filter((i) => !baselineIndexes.has(`${i.schema}.${i.index}`))
      .map((i) => `${i.schema}.${i.index}`),

    cacheHitBefore: baseline.cacheHitRate,
    cacheHitAfter:  current.cacheHitRate,

    blockedBefore: baseline.locks.filter((l) => l.blockedBy !== null).length,
    blockedAfter:  current.locks.filter((l) => l.blockedBy !== null).length,

    idleInTxBefore: baseline.locks.filter((l) => l.isIdleInTransaction).length,
    idleInTxAfter:  current.locks.filter((l) => l.isIdleInTransaction).length,
  };
}
