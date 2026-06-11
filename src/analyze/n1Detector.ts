import { Pool } from 'pg';
import { query } from '../db';
import { N1Pattern } from '../types';

export async function detectN1Patterns(client: Pool, limit: number): Promise<{ patterns: N1Pattern[]; hasExtension: boolean; error?: string }> {
  try {
    const extCheck = await query<{ count: string }>(
      client,
      `SELECT COUNT(*) as count FROM pg_extension WHERE extname = 'pg_stat_statements'`
    );
    const hasExtension = parseInt(extCheck[0]?.count ?? '0') > 0;
    if (!hasExtension) return { patterns: [], hasExtension: false };

    const rows = await query<{ queryid: string; query: string; calls: string; mean_exec_time: number; total_exec_time: number; rows: string; calls_rank: string; }>(
      client,
      `SELECT
        queryid::text,
        query,
        calls,
        mean_exec_time,
        total_exec_time,
        rows,
        RANK() OVER (ORDER BY calls DESC)::text AS calls_rank
      FROM pg_stat_statements
      WHERE calls > 100
        AND (rows::float / NULLIF(calls, 0)) BETWEEN 0 AND 5
        AND query ILIKE 'SELECT%'
        AND query ILIKE '%WHERE%=%'
        AND query NOT ILIKE '%IN (%'
        AND query NOT ILIKE '%pg_stat%'
        AND query NOT ILIKE '%pg_catalog%'
        AND mean_exec_time < 50
      ORDER BY calls DESC
      LIMIT $1`,
      [limit]
    );

    const patterns: N1Pattern[] = rows.map((r) => {
      const calls = parseInt(r.calls);
      const rows_ = parseInt(r.rows);
      const rowsPerCall = calls > 0 ? (rows_ / calls).toFixed(1) : '0';
      const rank = parseInt(r.calls_rank);

      let reason = `Called ${calls.toLocaleString()} times (rank #${rank} by frequency), averaging ${rowsPerCall} rows/call. `;
      reason += rank <= 5 ? 'Top-5 most-called query with single-row returns — strong N+1 signal.' : 'High-frequency single-row lookup — verify if called inside a loop.';

      return {
        query: r.query.replace(/\s+/g, ' ').trim().slice(0, 500),
        calls,
        meanTimeMs: Math.round(r.mean_exec_time),
        totalTimeMs: Math.round(r.total_exec_time),
        callsRank: rank,
        suspicionReason: reason,
        label: 'Potential N+1 — verify manually',
      };
    });

    return { patterns, hasExtension: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { patterns: [], hasExtension: false, error: message };
  }
}