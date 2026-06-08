# pg-inspector

> PostgreSQL query health CLI — slow query detection, index advice, N+1 finder, lock analysis, and a 0–100 health score.

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

  HEALTH SCORE
  ─────────────────────────────────────────
  Score : 74 / 100   Grade : C
  Slow Queries: 10/25  Index Health: 19/25  Cache Hit: 25/25  Lock Health: 20/25

  ⚠ WARNINGS
  • 2 slow queries above 100ms threshold
  • 2 unused indexes found — consider dropping them

  CACHE HIT RATE
  ─────────────────────────────────────────
  99.2%  ✓ Excellent
...
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

## Commands

### `analyze` — Full health report

```bash
pg-inspector analyze --conn <connection-string> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--conn, -c` | required | PostgreSQL connection string |
| `--format, -f` | `terminal` | Output format: `terminal`, `json`, `html` |
| `--out, -o` | — | Output file (for `json`/`html`) |
| `--threshold, -t` | `100` | Slow query threshold in ms |
| `--limit, -l` | `20` | Max results per check |
| `--no-color` | — | Disable colored output |

**Examples:**

```bash
# Terminal report (default)
pg-inspector analyze --conn postgresql://user:pass@host/db

# Use env var
export PG_INSPECTOR_URL=postgresql://...
pg-inspector analyze --conn $PG_INSPECTOR_URL

# JSON output
pg-inspector analyze --conn $PG_INSPECTOR_URL --format json --out report.json

# HTML report
pg-inspector analyze --conn $PG_INSPECTOR_URL --format html --out report.html

# Custom threshold (flag queries slower than 500ms)
pg-inspector analyze --conn $PG_INSPECTOR_URL --threshold 500
```

### `locks` — Quick lock check

```bash
pg-inspector locks --conn $PG_INSPECTOR_URL
```

Shows only active locks and long-running queries. Useful for quick production checks.

---

## What It Checks

| Check | Data Source | What It Finds |
|-------|-------------|---------------|
| **Slow queries** | `pg_stat_statements` | Queries above your threshold; mean, p95, stddev |
| **Unused indexes** | `pg_stat_user_indexes` | Indexes with < 10 scans since last reset |
| **Bloated indexes** | `pg_class` | Indexes with > 30% estimated bloat |
| **N+1 patterns** | `pg_stat_statements` | Single-row lookups called 50+ times |
| **Lock contention** | `pg_stat_activity` + `pg_locks` | Blocked queries, long-running transactions |
| **Cache hit rate** | `pg_statio_user_tables` | Buffer cache effectiveness |

### Health Score

Each check contributes up to 25 points (total: 100):

| Category | Max | Deductions |
|----------|-----|------------|
| Slow Queries | 25 | -5 per slow query |
| Index Health | 25 | -3 per unused, -4 per bloated |
| Cache Hit Rate | 25 | Tiered: 99%=25, 95%=20, 90%=15... |
| Lock Health | 25 | -8 per blocked query, -3 per long-running |

**Grades:** A (90+) · B (75+) · C (60+) · D (40+) · F (<40)

---

## Prerequisites

- Node.js >= 18
- PostgreSQL >= 13
- For slow query and N+1 analysis: `pg_stat_statements` extension

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
});

console.log(`Health score: ${result.healthScore.total}/100 (${result.healthScore.grade})`);
console.log(`Slow queries: ${result.slowQueries.length}`);
console.log(`Cache hit rate: ${result.cacheHitRate}%`);
```

---

## Local Development

```bash
git clone https://github.com/khush-shah/pg-inspector.git
cd pg-inspector
npm install

# Set up env
cp .env.example .env
# Edit .env with your connection string

# Run in dev mode
npm run dev -- analyze --conn $PG_INSPECTOR_URL

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
