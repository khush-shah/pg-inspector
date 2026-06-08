import { Pool } from 'pg';
import { query } from '../db';

export async function analyzeCacheHitRate(client: Pool): Promise<number> {
  const rows = await query<{
    heap_hit: string;
    heap_read: string;
    idx_hit: string;
    idx_read: string;
  }>(
    client,
    `SELECT
       SUM(heap_blks_hit)  AS heap_hit,
       SUM(heap_blks_read) AS heap_read,
       SUM(idx_blks_hit)   AS idx_hit,
       SUM(idx_blks_read)  AS idx_read
     FROM pg_statio_user_tables`
  );

  const r = rows[0];
  if (!r) return 100;

  const hit = parseFloat(r.heap_hit ?? '0') + parseFloat(r.idx_hit ?? '0');
  const read = parseFloat(r.heap_read ?? '0') + parseFloat(r.idx_read ?? '0');
  const total = hit + read;

  if (total === 0) return 100; // no activity yet

  return Math.round((hit / total) * 100 * 10) / 10; // one decimal
}
