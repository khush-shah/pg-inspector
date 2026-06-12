# PostgreSQL Health Check CLI — pg-inspector

> Connect. Analyze. Fix. A zero-config PostgreSQL performance CLI that surfaces slow queries, bloated tables, missing indexes, N+1 patterns, lock contention, and more — with a 0–100 health score and full CI integration.

[![npm version](https://img.shields.io/npm/v/pg-inspector.svg)](https://www.npmjs.com/package/pg-inspector)
[![CI](https://github.com/khush-shah/pg-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/khush-shah/pg-inspector/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Why

Diagnosing PostgreSQL performance problems means cross-referencing `pg_stat_statements`, `EXPLAIN` plans, index metadata, and lock views — manually. `pg-inspector` connects to any Postgres database and produces a prioritized, actionable health report in seconds.

```
$ pg-inspector analyze --conn $DATABASE_URL

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔍  pg-inspector  —  Database Health Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Connected : ep-xxx.aws.neon.tech/mydb
  Postgres  : PostgreSQL 16
  Profile   : OLTP

  HEALTH SCORE
  ─────────────────────────────────────────
  Score : 82 / 100   Grade : B
  Slow Queries: 22/25  Index Health: 19/25  Cache Hit: 25/25  Lock Health: 16/25

  ⚠  WARNINGS
  • 1 blocked query detected
  • 3 unused indexes found — consider dropping them

  SLOW QUERIES
  ┌────────────────────────┬───────┬──────────┬──────────┬────────────┐
  │ Query                  │ Calls │ Mean (ms)│ Max (ms) │ Cache Hit% │
  ├────────────────────────┼───────┼──────────┼──────────┼────────────┤
  │ SELECT * FROM orders…  │ 8,421 │ 312      │ 4,100    │ 91%        │
  └────────────────────────┴───────┴──────────┴──────────┴────────────┘
  SELECT * FROM orders WHERE user_id = $1 AND status = ...
    ⚠  Sequential scan on "orders" (est. 84,210 rows) — consider an index on the filter column.
```

---

## Install

```bash
npm install -g pg-inspector
```

Or use without installing:

```bash
npx pg-inspector analyze --conn $DATABASE_URL
```

---

## Quick Start

```bash
# Set your connection string once
export PG_INSPECTOR_URL=postgresql://user:pass@host/db

# Full health report
pg-inspector analyze

# Save a baseline before a deploy
pg-inspector baseline --out before.json

# Deploy your changes…

# Compare after the deploy
pg-inspector diff --baseline before.json

# CI gate — fail if score drops below 80
pg-inspector analyze --ci --min-score 80
```

---

## Commands

### `analyze` — Full health report

```bash
pg-inspector analyze --conn <connection-string> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--conn, -c` | required | PostgreSQL connection string (or `PG_INSPECTOR_URL` env var) |
| `--format, -f` | `terminal` | Output format: `terminal`, `json`, `html` |
| `--out, -o` | — | Output file (for `json`/`html`) |
| `--threshold, -t` | `100` | Slow query threshold in ms |
| `--limit, -l` | `20` | Max results per check |
| `--explain` | off | Run `EXPLAIN` on slow queries to surface plan warnings |
| `--profile` | `oltp` | Workload profile: `oltp` \| `olap` \| `mixed` |
| `--no-color` | — | Disable colored output |
| `--no-ssl-verify` | — | Disable SSL certificate verification (insecure) |
| `--full-queries` | — | Show full query text without truncation |
| `--ci` | — | CI mode — exit 1 if score below `--min-score` |
| `--min-score` | `75` | Minimum score threshold for CI mode |

**Examples:**

```bash
# Terminal report with EXPLAIN plan warnings
pg-inspector analyze --conn $DATABASE_URL --explain

# Analytics database — use OLAP profile so 60% cache hit rate isn't penalised
pg-inspector analyze --conn $DATABASE_URL --profile olap

# JSON output for further processing
pg-inspector analyze --conn $DATABASE_URL --format json --out report.json

# HTML report
pg-inspector analyze --conn $DATABASE_URL --format html --out report.html

# Fail CI if score drops below 75
pg-inspector analyze --conn $DATABASE_URL --ci --min-score 75
```

---

### `baseline` — Save a health snapshot

```bash
pg-inspector baseline --conn $DATABASE_URL --out baseline.json
```

Runs a full analysis and saves the result as a JSON snapshot. Use before deploys to create a comparison point.

| Option | Default | Description |
|--------|---------|-------------|
| `--conn, -c` | required | PostgreSQL connection string |
| `--out, -o` | `pg-inspector-baseline.json` | Output path for the snapshot |
| `--threshold, -t` | `100` | Slow query threshold in ms |
| `--profile` | `oltp` | Workload profile |

---

### `diff` — Compare against a baseline

```bash
pg-inspector diff --conn $DATABASE_URL --baseline baseline.json
```

Runs a fresh analysis and prints a before/after comparison:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  pg-inspector diff
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  HEALTH SCORE
  ─────────────────────────────────────────
  82 B  →  76 B   ▼ -6 pts

  CACHE HIT RATE
  ─────────────────────────────────────────
  99.2%  →  98.8%   (-0.4%)

  NEW SLOW QUERIES SINCE BASELINE
  ─────────────────────────────────────────
  + SELECT * FROM orders WHERE status = $1 AND created_at > $2

  LOCK CONTENTION
  ─────────────────────────────────────────
  Blocked queries:     0  →  2
  Idle-in-transaction: 0  →  0
```

| Option | Default | Description |
|--------|---------|-------------|
| `--conn, -c` | required | PostgreSQL connection string |
| `--baseline, -b` | `pg-inspector-baseline.json` | Path to baseline file |
| `--fail-delta` | `0` | Exit code 1 if score dropped by more than N points |
| `--threshold, -t` | `100` | Slow query threshold in ms |
| `--profile` | `oltp` | Workload profile |

**CI usage:**

```bash
# Save baseline before deploy
pg-inspector baseline --conn $DATABASE_URL --out baseline.json

# After deploy — fail CI if score dropped by 5+ points
pg-inspector diff --conn $DATABASE_URL --baseline baseline.json --fail-delta 5
```

---

### `locks` — Quick lock check

```bash
pg-inspector locks --conn $DATABASE_URL
```

Shows only active locks and long-running queries. Useful for quick production triage.

---

## What It Checks

| Check | Data Source | What It Finds |
|-------|-------------|---------------|
| **Slow queries** | `pg_stat_statements` | Queries above your ms threshold, weighted by total DB time consumed |
| **Unused indexes** | `pg_stat_user_indexes` | Indexes with < 10 scans since last reset |
| **Bloated indexes** | `pg_class` | Indexes with > 30% estimated bloat |
| **Bloated tables** | `pg_stat_user_tables` | Tables with high dead-tuple percentage and stale vacuums |
| **N+1 patterns** | `pg_stat_statements` | Single-row lookups called 50+ times |
| **Lock contention** | `pg_stat_activity` + `pg_locks` | Blocked queries, idle-in-transaction sessions, long-running transactions |
| **Cache hit rate** | `pg_statio_user_tables` | Buffer cache effectiveness |
| **Missing indexes** | `pg_stat_user_tables` | Tables with high sequential scan counts relative to their size |
| **Replication lag** | `pg_stat_replication` | Replicas with replay lag > 60 seconds |
| **EXPLAIN plan warnings** | `EXPLAIN (FORMAT JSON)` | Sequential scans, sort spills, nested loops on large row estimates (`--explain`) |

---

## Health Score

Each check contributes up to 25 points (total: 100). The scoring is **profile-aware** — thresholds differ between OLTP, OLAP, and mixed workloads.

| Category | Max | Scoring Logic |
|----------|-----|---------------|
| **Slow Queries** | 25 | Fraction of total DB execution time consumed by slow queries. A query running once a week barely moves the needle. A hot path at 200ms called 100k/day matters. |
| **Index Health** | 25 | -3 per unused index, -1 per FK-supporting unused index, -4 per bloated index |
| **Cache Hit Rate** | 25 | Tiered by profile (see below) |
| **Lock Health** | 25 | -8 per blocked query, -5 per idle-in-transaction, -3 per long-running transaction |

**Grades:** A (90+) · B (75+) · C (60+) · D (40+) · F (<40)

---

## Workload Profiles

Use `--profile` to tune score thresholds for your workload type.

| Profile | Use Case | Cache Hit "Excellent" | Long Tx Threshold |
|---------|----------|-----------------------|-------------------|
| `oltp` (default) | Web apps, APIs, transactional systems | 99% | 30s |
| `mixed` | Hybrid OLTP + reporting | 95% | 120s |
| `olap` | Analytics, data warehouses, ETL | 75% | 600s |

An analytics database doing full sequential scans is **expected** to have a 60% cache hit rate. Running it with `--profile olap` scores that fairly instead of grading it F.

```bash
# Data warehouse — don't penalise for expected sequential scan patterns
pg-inspector analyze --conn $DWH_URL --profile olap
```

---

## EXPLAIN Plan Warnings

Pass `--explain` to run `EXPLAIN (FORMAT JSON)` on each slow query and surface plan warnings automatically:

```bash
pg-inspector analyze --conn $DATABASE_URL --explain
```

Detected warnings:

| Warning | Meaning |
|---------|---------|
| `seq_scan` | Sequential scan on a table estimated to return > 1,000 rows |
| `sort_spill` | Sort node reports it may spill to disk |
| `nested_loop` | Nested loop with > 100 estimated iterations |
| `high_cost` | Total estimated cost > 100,000 |

`--explain` is **off by default** because it issues one additional query per slow query found. Safe for manual developer runs; too noisy for automated monitoring.

Parameterised queries with `$1` placeholders are silently skipped (EXPLAIN requires bound values).

---

## CI Integration

### Simple score gate

```yaml
# .github/workflows/db-health.yml
- name: Database health check
  run: npx pg-inspector analyze --conn ${{ secrets.DATABASE_URL }} --ci --min-score 75
```

### Baseline + diff gate (recommended)

```yaml
- name: Save pre-deploy baseline
  run: npx pg-inspector baseline --conn ${{ secrets.DATABASE_URL }} --out /tmp/baseline.json

- name: Deploy
  run: # your deploy step

- name: Check for regressions
  run: npx pg-inspector diff --conn ${{ secrets.DATABASE_URL }} --baseline /tmp/baseline.json --fail-delta 5
```

The `--fail-delta 5` flag fails the build only if the health score dropped by more than 5 points after the deploy, ignoring transient noise.

---

## Prerequisites

- Node.js >= 18
- PostgreSQL >= 13
- For slow query, N+1, and EXPLAIN analysis: `pg_stat_statements` extension

### Enable pg_stat_statements

```sql
-- Run as superuser
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Add to postgresql.conf (requires restart)
shared_preload_libraries = 'pg_stat_statements'
```

On Neon, Supabase, and most managed providers, `pg_stat_statements` is already enabled.

---

## Use as a Library

```typescript
import { analyze } from 'pg-inspector';

const result = await analyze({
  conn: process.env.DATABASE_URL!,
  format: 'terminal',
  threshold: 100,
  limit: 20,
  noColor: false,
  noSslVerify: false,
  fullQueries: false,
  ciMode: false,
  minScore: 75,
  explain: true,         // surface EXPLAIN plan warnings
  profile: 'oltp',       // 'oltp' | 'olap' | 'mixed'
});

console.log(`Health score: ${result.healthScore.total}/100 (${result.healthScore.grade})`);
console.log(`Profile: ${result.profile}`);
console.log(`Slow queries: ${result.slowQueries.length}`);
console.log(`Cache hit rate: ${result.cacheHitRate}%`);
console.log(`Bloated tables: ${result.bloatedTables.length}`);

// Plan warnings per slow query
for (const q of result.slowQueries) {
  if (q.planWarnings.length > 0) {
    console.log(`\n${q.query}`);
    q.planWarnings.forEach((w) => console.log(`  ⚠ ${w.message}`));
  }
}
```

### Baseline and diff in code

```typescript
import { analyze } from 'pg-inspector';
import { saveBaseline, loadBaseline, diffBaseline } from 'pg-inspector/baseline';

// Save
const result = await analyze({ conn: process.env.DATABASE_URL!, ... });
saveBaseline(result, 'baseline.json');

// Later — compare
const { result: before } = loadBaseline('baseline.json');
const after = await analyze({ conn: process.env.DATABASE_URL!, ... });
const diff = diffBaseline(before, after);
console.log(`Score delta: ${diff.scoreDelta > 0 ? '+' : ''}${diff.scoreDelta}`);
```

---

## Local Development

```bash
git clone https://github.com/khush-shah/pg-inspector.git
cd pg-inspector
npm install

# Set up env
export PG_INSPECTOR_URL=postgresql://user:pass@localhost/yourdb

# Run in dev mode
npm run dev -- analyze --conn $PG_INSPECTOR_URL --explain

# Run tests
npm test

# Build
npm run build
```

---

## Contributing

PRs and issues welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT © [Khush Shah](https://github.com/khush-shah)
