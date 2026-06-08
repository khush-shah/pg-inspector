import { Pool } from 'pg';
import { createPool, getPostgresVersion, checkExtension, closePool } from './db';
import { analyzeSlowQueries } from './analyze/slowQueries';
import { analyzeUnusedIndexes } from './analyze/unusedIndexes';
import { analyzeBloat } from './analyze/bloat';
import { detectN1Patterns } from './analyze/n1Detector';
import { analyzeLocks } from './analyze/locks';
import { analyzeCacheHitRate } from './analyze/cacheHitRate';
import { computeHealthScore } from './score';
import { AnalysisResult, AnalyzeOptions } from './types';

export async function analyze(options: AnalyzeOptions): Promise<AnalysisResult> {
  const pool: Pool = createPool(options.conn);
  const warnings: string[] = [];

  try {
    // Parallel execution where possible
    const [
      version,
      hasPgStatStatements,
      cacheHitRate,
      unusedIndexes,
      bloatedIndexes,
      locks,
    ] = await Promise.all([
      getPostgresVersion(pool),
      checkExtension(pool, 'pg_stat_statements'),
      analyzeCacheHitRate(pool),
      analyzeUnusedIndexes(pool, options.limit),
      analyzeBloat(pool, options.limit),
      analyzeLocks(pool, options.limit),
    ]);

    if (!hasPgStatStatements) {
      warnings.push(
        'pg_stat_statements extension not enabled. Slow query and N+1 analysis skipped. ' +
        'Enable it with: CREATE EXTENSION pg_stat_statements;'
      );
    }

    // These depend on pg_stat_statements
    const [{ queries: slowQueries }, { patterns: n1Patterns }] = await Promise.all([
      analyzeSlowQueries(pool, options.threshold, options.limit),
      detectN1Patterns(pool, options.limit),
    ]);

    if (cacheHitRate < 85) {
      warnings.push(
        `Cache hit rate is ${cacheHitRate}%. Consider increasing shared_buffers in postgresql.conf.`
      );
    }

    const blockedLocks = locks.filter((l) => l.blockedBy !== null);
    if (blockedLocks.length > 0) {
      warnings.push(`${blockedLocks.length} blocked query(ies) detected. Check for lock contention.`);
    }

    // Extract DB name from connection string for display
    const connectedTo = extractDbName(options.conn);

    const partial = {
      connectedTo,
      postgresVersion: version,
      analyzedAt: new Date(),
      slowQueries,
      unusedIndexes,
      bloatedIndexes,
      n1Patterns,
      locks,
      indexRecommendations: [],
      cacheHitRate,
      warnings,
    };

    const healthScore = computeHealthScore(partial);

    return { ...partial, healthScore };
  } finally {
    await closePool();
  }
}

function extractDbName(conn: string): string {
  try {
    const url = new URL(conn);
    const db = url.pathname.replace('/', '');
    return `${url.hostname}/${db}`;
  } catch {
    return 'unknown';
  }
}

// Re-export types for library consumers
export * from './types';
