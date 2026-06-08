import { Pool } from 'pg';
import { query } from '../db';
import { N1Pattern } from '../types';

export async function detectN1Patterns(
  client: Pool,
  limit: number
): Promise<{ patterns: N1Pattern[]; hasExtension: boolean }> {
  const extCheck = await query<{ count: string }>(
    client,
    `SELECT COUNT(*) as count FROM pg_extension WHERE extname = 'pg_stat_statements'`
  );
  const hasExtension = parseInt(extCheck[0]?.count ?? '0') > 0;

  if (!hasExtension) {
    return { patterns: [], hasExtension: false };
  }

  const rows = await query<{
    queryid: string;
    query: string;
    calls: string;
    mean_exec_time: number;
    total_exec_time: number;
    rows: string;
  }>(
    client,
    `SELECT
       queryid::text,
       query,
       calls,
       mean_exec_time,
       total_exec_time,
       rows
     FROM pg_stat_statements
     WHERE calls > 50
       AND (rows::float / NULLIF(calls, 0)) BETWEEN 0 AND 3
       AND (
         query ILIKE '%WHERE%id =%'
         OR query ILIKE '%WHERE%_id =%'
         OR query ILIKE '%WHERE%uuid =%'
       )
       AND query ILIKE 'SELECT%'
       AND query NOT ILIKE '%pg_stat%'
       AND query NOT ILIKE '%pg_catalog%'
     ORDER BY calls DESC
     LIMIT $1`,
    [limit]
  );

  const patterns: N1Pattern[] = rows.map((r) => {
    const calls = parseInt(r.calls);
    const rows_ = parseInt(r.rows);
    const rowsPerCall = calls > 0 ? (rows_ / calls).toFixed(1) : '0';

    let reason = `Called ${calls.toLocaleString()} times, averaging ${rowsPerCall} rows/call. `;
    if (calls > 1000) {
      reason += 'High call frequency with single-row returns strongly suggests N+1.';
    } else {
      reason += 'Pattern matches single-row lookup — verify if called inside a loop.';
    }

    return {
      query: r.query.replace(/\s+/g, ' ').trim().slice(0, 200),
      calls,
      meanTimeMs: Math.round(r.mean_exec_time),
      totalTimeMs: Math.round(r.total_exec_time),
      suspicionReason: reason,
    };
  });

  return { patterns, hasExtension: true };
}