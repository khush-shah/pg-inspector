import { Pool } from 'pg';
import { query } from '../db';
import { MissingIndex } from '../types';

export async function analyzeMissingIndexes(client: Pool, limit: number): Promise<{ suggestions: MissingIndex[]; error?: string }> {
    try {
        const rows = await query<{ schemaname: string; tablename: string; seq_scans: string; seq_tup_read: string; idx_scans: string; table_size: string; live_tuples: string; }>(
            client,
            `SELECT
            schemaname,
            relname AS tablename,
            seq_scan AS seq_scans,
            seq_tup_read,
            idx_scan AS idx_scans,
            pg_size_pretty(pg_total_relation_size(relid)) AS table_size,
            n_live_tup AS live_tuples
        FROM pg_stat_user_tables
        WHERE seq_scan > 50
            AND n_live_tup > 1000
            AND (idx_scan::float / NULLIF(seq_scan + idx_scan, 0)) < 0.5
        ORDER BY seq_tup_read DESC
        LIMIT $1`,
            [limit]
        );

        return {
            suggestions: rows.map((r) => ({
                schema: r.schemaname,
                table: r.tablename,
                seqScans: parseInt(r.seq_scans),
                seqTupRead: parseInt(r.seq_tup_read),
                idxScans: parseInt(r.idx_scans),
                tableSize: r.table_size,
                liveTuples: parseInt(r.live_tuples),
                suggestion: `Table "${r.tablename}" has ${parseInt(r.seq_scans).toLocaleString()} sequential scans reading ${parseInt(r.seq_tup_read).toLocaleString()} tuples. Review WHERE clauses on queries hitting this table and consider adding an index.`,
            })),
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { suggestions: [], error: message };
    }
}
