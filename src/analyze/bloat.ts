import { Pool } from 'pg';
import { query } from '../db';
import { BloatedIndex, BloatedTable } from '../types';

export async function analyzeBloat(client: Pool, limit: number): Promise<{ indexes: BloatedIndex[]; tables: BloatedTable[]; error?: string }> {
  try {
    const [indexes, tables] = await Promise.all([
      analyzeIndexBloat(client, limit),
      analyzeTableBloat(client, limit),
    ]);
    return { indexes, tables };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { indexes: [], tables: [], error: message };
  }
}

async function analyzeIndexBloat(client: Pool, limit: number): Promise<BloatedIndex[]> {
  const rows = await query<{ schemaname: string; tablename: string; indexname: string; index_size: string; bloat_size: string; bloat_pct: number; }>(
    client,
    `WITH btree_indexes AS (
        SELECT
          s.schemaname,
          s.relname      AS tablename,
          s.indexrelname AS indexname,
          s.indexrelid,
          pg_relation_size(s.indexrelid) AS index_bytes,
          c.reltuples,
          c.relpages
        FROM pg_stat_user_indexes s
        JOIN pg_class c ON c.oid = s.indexrelid
        JOIN pg_index i ON i.indexrelid = s.indexrelid
        WHERE c.relam = (SELECT oid FROM pg_am WHERE amname = 'btree')
        AND pg_relation_size(s.indexrelid) > 102400
     ),
     estimates AS (
        SELECT *,
          GREATEST(CEIL(reltuples * 40.0 / (8192 - 24)), 1)::bigint AS est_pages
        FROM btree_indexes
      )
      SELECT
        schemaname,
        tablename,
        indexname,
        pg_size_pretty(index_bytes) AS index_size,
        pg_size_pretty(GREATEST(index_bytes - est_pages * 8192, 0)) AS bloat_size,
        CASE
          WHEN relpages > 0
          THEN ROUND((GREATEST(relpages - est_pages, 0))::numeric / relpages * 100, 1)
          ELSE 0
        END AS bloat_pct
      FROM estimates
      WHERE relpages > est_pages
        AND ROUND((GREATEST(relpages - est_pages, 0))::numeric / NULLIF(relpages,0) * 100, 1) > 30
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

async function analyzeTableBloat(client: Pool, limit: number): Promise<BloatedTable[]> {
  const rows = await query<{ schemaname: string; tablename: string; n_dead_tup: string; n_live_tup: string; table_size: string; dead_tuple_pct: number; last_autovacuum: string | null; last_vacuum: string | null; }>(
    client,
    `SELECT
        schemaname,
        relname AS tablename,
        n_dead_tup,
        n_live_tup,
        pg_size_pretty(pg_total_relation_size(relid)) AS table_size,
        CASE WHEN n_live_tup > 0
          THEN ROUND(n_dead_tup::numeric / n_live_tup * 100, 1)
          ELSE 0
        END AS dead_tuple_pct,
        TO_CHAR(last_autovacuum, 'YYYY-MM-DD HH24:MI') AS last_autovacuum,
        TO_CHAR(last_vacuum,     'YYYY-MM-DD HH24:MI') AS last_vacuum
      FROM pg_stat_user_tables
      WHERE n_dead_tup > 1000
        AND (n_dead_tup::float / NULLIF(n_live_tup, 0)) > 0.1
      ORDER BY n_dead_tup DESC
      LIMIT $1`,
    [limit]
  );

  return rows.map((r) => ({
    schema: r.schemaname,
    table: r.tablename,
    deadTuples: parseInt(r.n_dead_tup),
    liveTuples: parseInt(r.n_live_tup),
    tableSize: r.table_size,
    deadTuplePct: parseFloat(String(r.dead_tuple_pct)),
    lastAutovacuum: r.last_autovacuum,
    lastVacuum: r.last_vacuum,
  }));
}