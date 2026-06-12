import { Pool } from 'pg';
import { query } from '../db';
import { PlanWarning } from '../types';

export interface ExplainResult {
  queryId: string;
  planWarnings: PlanWarning[];
  estimatedCost: number;
  error?: string;
}

// Only EXPLAIN queries we can safely parse: non-truncated DML statements that
// aren't prepared-statement fragments (which contain $1 placeholders that EXPLAIN
// would reject without bound values).
function isExplainable(q: string): boolean {
  const normalized = q.trim().toUpperCase();
  return (
    (normalized.startsWith('SELECT') ||
     normalized.startsWith('UPDATE') ||
     normalized.startsWith('DELETE') ||
     normalized.startsWith('INSERT')) &&
    !q.endsWith('...') &&  // truncated by pg_stat_statements — skip
    !q.startsWith('$')     // prepared statement fragment — skip
  );
}

function extractWarnings(plan: any[]): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  if (!plan?.[0]?.Plan) return warnings;

  const root = plan[0].Plan;
  const totalCost: number = root['Total Cost'] ?? 0;

  if (totalCost > 100_000) {
    warnings.push({
      type: 'high_cost',
      message: `High estimated cost: ${totalCost.toLocaleString()}. Consider query optimisation or additional indexes.`,
    });
  }

  function walk(node: any): void {
    if (!node) return;

    const nodeType: string = node['Node Type'] ?? '';
    const rows: number    = node['Plan Rows'] ?? 0;
    const relation: string = node['Relation Name'] ?? '';

    if (nodeType === 'Seq Scan' && rows > 1_000) {
      warnings.push({
        type: 'seq_scan',
        message: `Sequential scan on "${relation}" (est. ${rows.toLocaleString()} rows) — consider an index on the filter column.`,
      });
    }

    if (nodeType === 'Sort') {
      const method: string = node['Sort Method'] ?? '';
      if (method.includes('external')) {
        warnings.push({
          type: 'sort_spill',
          message: `Sort may spill to disk — consider increasing work_mem.`,
        });
      }
    }

    if (nodeType === 'Nested Loop') {
      const loops: number = node['Actual Loops'] ?? node['Plan Rows'] ?? 0;
      if (loops > 100) {
        warnings.push({
          type: 'nested_loop',
          message: `Nested loop with ~${loops} iterations — check for a missing index on the inner join column.`,
        });
      }
    }

    for (const child of (node['Plans'] ?? [])) walk(child);
  }

  walk(root);
  return warnings;
}

export async function captureExplainPlans(
  client: Pool,
  queries: Array<{ queryId: string; query: string; fullQuery?: string }>,
): Promise<ExplainResult[]> {
  const results: ExplainResult[] = [];

  for (const q of queries) {
    const sql = q.fullQuery ?? q.query;
    if (!isExplainable(sql)) continue;

    try {
      const rows = await query(client, `EXPLAIN (FORMAT JSON) ${sql}`);
      const plan = rows[0]?.['QUERY PLAN'];
      if (!plan) continue;

      results.push({
        queryId: q.queryId,
        planWarnings: extractWarnings(plan),
        estimatedCost: Math.round(plan?.[0]?.Plan?.['Total Cost'] ?? 0),
      });
    } catch (err) {
      // Parameterised queries ($1, $2 …) fail EXPLAIN without bound values — skip silently
      results.push({
        queryId: q.queryId,
        planWarnings: [],
        estimatedCost: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
