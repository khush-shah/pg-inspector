import { Pool } from 'pg';
import { query } from '../db';
import { SlowQuery } from '../types';

export async function analyzeSlowQueries(client: Pool, thresholdMs: number, limit: number, fullQueries = false): Promise<{ queries: SlowQuery[]; hasExtension: boolean; error?: string }> {
  try {
    const extCheck = await query<{ count: string }>(client, `SELECT COUNT(*) as count FROM pg_extension WHERE extname = 'pg_stat_statements'`);
    const hasExtension = parseInt(extCheck[0]?.count ?? '0') > 0;
    if (!hasExtension) return { queries: [], hasExtension: false };

    const rows = await query<{ queryid: string; query: string; calls: string; total_exec_time: number; mean_exec_time: number; stddev_exec_time: number; min_exec_time: number; max_exec_time: number; rows: string; shared_blks_hit: string; shared_blks_read: string; shared_blks_written: string; temp_blks_written: string; }>(
      client,
      `SELECT
        queryid::text,
        query,
        calls,
        total_exec_time,
        mean_exec_time,
        stddev_exec_time,
        min_exec_time,
        max_exec_time,
        rows,
        shared_blks_hit,
        shared_blks_read,
        shared_blks_written,
        temp_blks_written
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
      const maxLen = fullQueries ? Infinity : 500;

      return {
        queryId: r.queryid,
        query: normalizeQuery(r.query, maxLen),
        fullQuery: r.query,
        calls: parseInt(r.calls),
        totalTimeMs: Math.round(r.total_exec_time),
        meanTimeMs: Math.round(r.mean_exec_time),
        minTimeMs: Math.round(r.min_exec_time),
        maxTimeMs: Math.round(r.max_exec_time),
        stddevTimeMs: Math.round(r.stddev_exec_time),
        rows: parseInt(r.rows),
        hitPercent,
        spillsToDisk: parseInt(r.temp_blks_written) > 0,
        tempBlksWritten: parseInt(r.temp_blks_written),
        sharedBlksWritten: parseInt(r.shared_blks_written),
      };
    });

    return { queries: slowQueries, hasExtension: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { queries: [], hasExtension: false, error: message };
  }
}

function normalizeQuery(q: string, maxLen: number): string {
  const trimmed = q.replace(/\s+/g, ' ').trim();
  return isFinite(maxLen) && trimmed.length > maxLen ? trimmed.slice(0, maxLen - 3) + '...' : trimmed;
}
