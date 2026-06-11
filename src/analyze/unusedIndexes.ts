import { Pool } from 'pg';
import { query } from '../db';
import { UnusedIndex } from '../types';

export async function analyzeUnusedIndexes(client: Pool, limit: number): Promise<{ indexes: UnusedIndex[]; error?: string }> {
  try {
    const rows = await query<{ schemaname: string; tablename: string; indexname: string; index_size: string; idx_scan: string; is_fk_supporting: boolean; }>(
      client,
      `SELECT
        s.schemaname,
        s.relname AS tablename,
        s.indexrelname AS indexname,
        pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
        s.idx_scan,
        EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
          WHERE c.contype = 'f'
            AND c.conrelid = (
            SELECT oid FROM pg_class
              WHERE relname = s.relname
              AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = s.schemaname)
            )
            AND s.indexrelname ILIKE '%' || a.attname || '%'
        ) AS is_fk_supporting
      FROM pg_stat_user_indexes s
      JOIN pg_indexes i ON s.schemaname = i.schemaname AND s.relname = i.tablename AND s.indexrelname = i.indexname
      JOIN pg_index ix ON s.indexrelid = ix.indexrelid
      WHERE s.idx_scan < 10
        AND NOT ix.indisprimary
        AND NOT ix.indisunique
        AND pg_relation_size(s.indexrelid) > 8192
      ORDER BY pg_relation_size(s.indexrelid) DESC
      LIMIT $1`,
      [limit]
    );

    return {
      indexes: rows.map((r) => ({
        schema: r.schemaname,
        table: r.tablename,
        index: r.indexname,
        indexSize: r.index_size,
        indexScans: parseInt(r.idx_scan),
        isFkSupporting: r.is_fk_supporting,
        reason: r.is_fk_supporting
          ? `Only ${r.idx_scan} scans — but likely supports a foreign key. Do NOT drop without verifying FK performance impact.`
          : parseInt(r.idx_scan) === 0
            ? 'Never used since last statistics reset'
            : `Only used ${r.idx_scan} times — likely not worth the write overhead`,
      })),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { indexes: [], error: message };
  }
}
