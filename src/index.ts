import { Pool } from 'pg';
import { createPool, getPostgresVersion, checkExtension, closePool, maskPassword } from './db';
import { analyzeSlowQueries } from './analyze/slowQueries';
import { analyzeUnusedIndexes } from './analyze/unusedIndexes';
import { analyzeBloat } from './analyze/bloat';
import { detectN1Patterns } from './analyze/n1Detector';
import { analyzeLocks } from './analyze/locks';
import { analyzeCacheHitRate } from './analyze/cacheHitRate';
import { analyzeMissingIndexes } from './analyze/missingIndexes';
import { analyzeReplication } from './analyze/replication';
import { computeHealthScore } from './score';
import { AnalysisResult, AnalyzeOptions } from './types';

export async function analyze(options: AnalyzeOptions): Promise<AnalysisResult> {
  const pool: Pool = createPool(options.conn, options.noSslVerify);
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const connectedTo = maskPassword(extractDbName(options.conn));
    const version = await getPostgresVersion(pool);
    const hasPgStatStatements = await checkExtension(pool, 'pg_stat_statements');

    if (!hasPgStatStatements) {
      warnings.push(
        'pg_stat_statements extension not enabled. Slow query and N+1 analysis skipped. ' +
        'Enable it with: CREATE EXTENSION pg_stat_statements;'
      );
    }

    const [
      cacheHitRate,
      { indexes: unusedIndexes, error: unusedErr },
      { indexes: bloatedIndexes, tables: bloatedTables, error: bloatErr },
      { locks, error: locksErr },
      { suggestions: missingIndexes, error: missingErr },
      { replicas: replication, error: replErr },
    ] = await Promise.all([
      analyzeCacheHitRate(pool),
      analyzeUnusedIndexes(pool, options.limit),
      analyzeBloat(pool, options.limit),
      analyzeLocks(pool, options.limit),
      analyzeMissingIndexes(pool, options.limit),
      analyzeReplication(pool),
    ]);

    if (unusedErr) errors.push(`Unused indexes: ${unusedErr}`);
    if (bloatErr) errors.push(`Bloat analysis: ${bloatErr}`);
    if (locksErr) errors.push(`Lock analysis: ${locksErr}`);
    if (missingErr) errors.push(`Missing indexes: ${missingErr}`);
    if (replErr) errors.push(`Replication: ${replErr}`);

    const [
      { queries: slowQueries, error: slowErr },
      { patterns: n1Patterns, error: n1Err },
    ] = await Promise.all([
      analyzeSlowQueries(pool, options.threshold, options.limit, options.fullQueries),
      detectN1Patterns(pool, options.limit),
    ]);

    if (slowErr) errors.push(`Slow queries: ${slowErr}`);
    if (n1Err) errors.push(`N+1 detection: ${n1Err}`);

    if (cacheHitRate < 85) warnings.push(`Cache hit rate is ${cacheHitRate}%. Consider increasing shared_buffers.`);

    const blockedLocks = locks.filter((l) => l.blockedBy !== null);
    if (blockedLocks.length > 0) warnings.push(`${blockedLocks.length} blocked query(ies) detected.`);

    const idleInTx = locks.filter((l) => l.isIdleInTransaction);
    if (idleInTx.length > 0) warnings.push(`${idleInTx.length} idle-in-transaction session(s) detected. These hold locks and can cause contention.`);

    const laggingReplicas = replication.filter((r) => r.isLagging);
    if (laggingReplicas.length > 0) warnings.push(`${laggingReplicas.length} replica(s) have replay lag > 60 seconds.`);

    const partial = {
      connectedTo, postgresVersion: version, analyzedAt: new Date(),
      slowQueries, unusedIndexes, bloatedIndexes, bloatedTables,
      n1Patterns, locks, missingIndexes, replication,
      indexRecommendations: [], cacheHitRate, warnings, errors,
    };

    return { ...partial, healthScore: computeHealthScore(partial) };
  } finally {
    await closePool();
  }
}

function extractDbName(conn: string): string {
  try {
    const url = new URL(conn);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return 'unknown';
  }
}

export * from './types';
