import { Pool } from 'pg';
import { query } from '../db';
import { BloatedIndex } from '../types';

export async function analyzeBloat(
  client: Pool,
  limit: number
): Promise<BloatedIndex[]> {
  const rows = await query<{
    schemaname: string;
    tablename: string;
    indexname: string;
    index_size: string;
    real_size: string;
    bloat_size: string;
    bloat_pct: number;
  }>(
    client,
    `WITH index_info AS (
       SELECT
         s.schemaname,
         s.relname AS tablename,
         s.indexrelname AS indexname,
         s.indexrelid,
         c.relpages,
         c.reltuples,
         pg_relation_size(s.indexrelid) AS index_bytes
       FROM pg_stat_user_indexes s
       JOIN pg_class c ON c.oid = s.indexrelid
       WHERE pg_relation_size(s.indexrelid) > 102400
     )
     SELECT
       schemaname,
       tablename,
       indexname,
       pg_size_pretty(index_bytes) AS index_size,
       pg_size_pretty(
         GREATEST(index_bytes - (relpages * 8192), 0)
       ) AS bloat_size,
       pg_size_pretty(index_bytes) AS real_size,
       CASE
         WHEN index_bytes > 0
         THEN ROUND(
           GREATEST(index_bytes - (relpages * 8192), 0)::numeric
           / index_bytes * 100, 1
         )
         ELSE 0
       END AS bloat_pct
     FROM index_info
     WHERE CASE
       WHEN index_bytes > 0
       THEN (GREATEST(index_bytes - (relpages * 8192), 0)::numeric / index_bytes * 100)
       ELSE 0
     END > 30
     ORDER BY bloat_pct DESC
     LIMIT $1`,
    [limit]
  );

  return rows.map((r) => ({
    schema: r.schemaname,
    table: r.tablename,
    index: r.indexname,
    indexSize: r.index_size,
    bloatEstimate: r.bloat_size,
    bloatPercent: parseFloat(String(r.bloat_pct)),
  }));
}