import { Pool } from 'pg';
import { query } from '../db';
import { UnusedIndex } from '../types';

export async function analyzeUnusedIndexes(
  client: Pool,
  limit: number
): Promise<UnusedIndex[]> {
  const rows = await query<{
    schemaname: string;
    tablename: string;
    indexname: string;
    index_size: string;
    idx_scan: string;
    idx_tup_read: string;
    indexdef: string;
  }>(
    client,
    `SELECT
       s.schemaname,
       s.relname AS tablename,
       s.indexrelname AS indexname,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
       s.idx_scan,
       s.idx_tup_read,
       i.indexdef
     FROM pg_stat_user_indexes s
     JOIN pg_indexes i
       ON s.schemaname = i.schemaname
      AND s.relname = i.tablename
      AND s.indexrelname = i.indexname
     JOIN pg_index ix ON s.indexrelid = ix.indexrelid
     WHERE s.idx_scan < 10
       AND NOT ix.indisprimary
       AND NOT ix.indisunique
       AND pg_relation_size(s.indexrelid) > 8192
     ORDER BY pg_relation_size(s.indexrelid) DESC
     LIMIT $1`,
    [limit]
  );

  return rows.map((r) => ({
    schema: r.schemaname,
    table: r.tablename,
    index: r.indexname,
    indexSize: r.index_size,
    indexScans: parseInt(r.idx_scan),
    reason:
      parseInt(r.idx_scan) === 0
        ? 'Never used since last statistics reset'
        : `Only used ${r.idx_scan} times — likely not worth the write overhead`,
  }));
}