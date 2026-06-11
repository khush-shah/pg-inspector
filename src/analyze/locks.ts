import { Pool } from 'pg';
import { query } from '../db';
import { LockInfo } from '../types';

export async function analyzeLocks(client: Pool, limit: number): Promise<{ locks: LockInfo[]; error?: string }> {
  try {
    const rows = await query<{ pid: number; duration: string; state: string; wait_event_type: string | null; wait_event: string | null; blocked_by: number | null; query: string; locktype: string | null; relation: string | null; is_idle_in_transaction: boolean; }>(
      client,
      `SELECT
        a.pid,
        COALESCE(EXTRACT(EPOCH FROM (now() - a.query_start))::int || 's', '0s') AS duration,
        a.state,
        a.wait_event_type,
        a.wait_event,
        (SELECT pid FROM pg_stat_activity WHERE pid = ANY(pg_blocking_pids(a.pid)) LIMIT 1) AS blocked_by,
        LEFT(a.query, 500) AS query,
        l.locktype,
        COALESCE(c.relname, '') AS relation,
        a.state = 'idle in transaction' AS is_idle_in_transaction
      FROM pg_stat_activity a
      LEFT JOIN pg_locks l ON l.pid = a.pid AND l.granted = false
      LEFT JOIN pg_class c ON c.oid = l.relation
      WHERE a.pid != pg_backend_pid()
        AND a.query_start IS NOT NULL
        AND (a.state != 'idle' OR a.state = 'idle in transaction')
        AND EXTRACT(EPOCH FROM (now() - a.query_start)) > 1
      ORDER BY is_idle_in_transaction DESC, blocked_by NULLS LAST, duration DESC
      LIMIT $1`,
      [limit]
    );

    return {
      locks: rows.map((r) => ({
        pid: r.pid,
        duration: r.duration,
        state: r.state,
        waitEventType: r.wait_event_type,
        waitEvent: r.wait_event,
        blockedBy: r.blocked_by,
        query: r.query,
        lockType: r.locktype,
        relation: r.relation || null,
        isIdleInTransaction: r.is_idle_in_transaction,
      })),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { locks: [], error: message };
  }
}
