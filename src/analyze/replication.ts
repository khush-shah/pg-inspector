import { Pool } from 'pg';
import { query } from '../db';
import { ReplicationInfo } from '../types';

export async function analyzeReplication(client: Pool): Promise<{ replicas: ReplicationInfo[]; error?: string }> {
    try {
        const rows = await query<{ application_name: string; state: string; write_lag_secs: number | null; flush_lag_secs: number | null; replay_lag_secs: number | null; sync_state: string; }>(
            client,
            `SELECT
        application_name,
        state,
        EXTRACT(EPOCH FROM write_lag)::int  AS write_lag_secs,
        EXTRACT(EPOCH FROM flush_lag)::int  AS flush_lag_secs,
        EXTRACT(EPOCH FROM replay_lag)::int AS replay_lag_secs,
        sync_state
       FROM pg_stat_replication`
        );

        return {
            replicas: rows.map((r) => ({
                applicationName: r.application_name,
                state: r.state,
                writeLagSecs: r.write_lag_secs ?? 0,
                flushLagSecs: r.flush_lag_secs ?? 0,
                replayLagSecs: r.replay_lag_secs ?? 0,
                syncState: r.sync_state,
                isLagging: (r.replay_lag_secs ?? 0) > 60,
            })),
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { replicas: [], error: message };
    }
}
