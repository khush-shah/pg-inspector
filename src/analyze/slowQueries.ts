import { Pool } from 'pg';
import { query } from '../db';
import { SlowQuery } from '../types';

export async function analyzeSlowQueries(
  client: Pool,
  thresholdMs: number,
  limit: number
): Promise<{ queries: SlowQuery[]; hasExtension: boolean }> {
  // Check if pg_stat_statements is available
  const extCheck = await query<{ count: string }>(
    client,
    `SELECT COUNT(*) as count FROM pg_extension WHERE extname = 'pg_stat_statements'`
  );
  const hasExtension = parseInt(extCheck[0]?.count ?? '0') > 0;

  if (!hasExtension) {
    return { queries: [], hasExtension: false };
  }

  const rows = await query<{
    queryid: string;
    query: string;
    calls: string;
    total_exec_time: number;
    mean_exec_time: number;
    stddev_exec_time: number;
    rows: string;
    shared_blks_hit: string;
    shared_blks_read: string;
  }>(
    client,
    `SELECT
       queryid::text,
       query,
       calls,
       total_exec_time,
       mean_exec_time,
       stddev_exec_time,
       rows,
       shared_blks_hit,
       shared_blks_read
     FROM pg_stat_statements
     WHERE mean_exec_time > $1
       AND query NOT ILIKE '%pg_stat%'
       AND query NOT ILIKE '%pg_catalog%'
       AND calls > 2
     ORDER BY mean_exec_time DESC
     LIMIT $2`,
    [thresholdMs, limit]
  );

  const slowQueries: SlowQuery[] = rows.map((r) => {
    const hit = parseFloat(r.shared_blks_hit);
    const read = parseFloat(r.shared_blks_read);
    const total = hit + read;
    const hitPercent = total > 0 ? Math.round((hit / total) * 100) : 100;

    // Estimate p95 using mean + 1.645 * stddev (normal approximation)
    const p95 = r.mean_exec_time + 1.645 * r.stddev_exec_time;

    return {
      queryId: r.queryid,
      query: normalizeQuery(r.query),
      calls: parseInt(r.calls),
      totalTimeMs: Math.round(r.total_exec_time),
      meanTimeMs: Math.round(r.mean_exec_time),
      p95TimeMs: Math.round(p95),
      stddevTimeMs: Math.round(r.stddev_exec_time),
      rows: parseInt(r.rows),
      hitPercent,
    };
  });

  return { queries: slowQueries, hasExtension: true };
}

function normalizeQuery(q: string): string {
  // Trim and truncate long queries for display
  const trimmed = q.replace(/\s+/g, ' ').trim();
  return trimmed.length > 200 ? trimmed.slice(0, 197) + '...' : trimmed;
}
