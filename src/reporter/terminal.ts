import chalk from 'chalk';
import Table from 'cli-table3';
import { AnalysisResult, DiffReport } from '../types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../../package.json') as { version: string };

export function renderTerminal(result: AnalysisResult, noColor = false): void {
  if (noColor) chalk.level = 0;

  const { healthScore: hs } = result;
  const profile = result.profile ?? 'oltp';

  // ── Header ──────────────────────────────────────────────────────────────────
  console.log('\n' + chalk.bold.blue('━'.repeat(60)));
  console.log(chalk.bold.white('  🔍  pg-inspector  —  Database Health Report'));
  console.log(chalk.bold.blue('━'.repeat(60)));
  console.log(chalk.gray(`  Connected : ${result.connectedTo}`));
  console.log(chalk.gray(`  Postgres  : ${result.postgresVersion.split(' ').slice(0, 2).join(' ')}`));
  console.log(chalk.gray(`  Profile   : ${profile.toUpperCase()}`));
  console.log(chalk.gray(`  Analyzed  : ${result.analyzedAt.toLocaleString()}`));

  // ── Health Score ─────────────────────────────────────────────────────────────
  const gradeColor: Record<string, any> = {
    A: chalk.green,
    B: chalk.cyan,
    C: chalk.yellow,
    D: chalk.hex('#FFA500'),
    F: chalk.red,
  };
  const gc = gradeColor[hs.grade] ?? chalk.white;

  console.log('\n' + chalk.bold.white('  HEALTH SCORE'));
  console.log(chalk.bold.blue('  ─────────────────────────────────────────'));
  console.log(`  Score : ${gc.bold(`${hs.total} / 100`)}   Grade : ${gc.bold(hs.grade)}`);
  console.log(
    chalk.gray(
      `  Slow Queries: ${hs.breakdown.slowQueries}/25  ` +
      `Index Health: ${hs.breakdown.indexHealth}/25  ` +
      `Cache Hit: ${hs.breakdown.cacheHitRate}/25  ` +
      `Lock Health: ${hs.breakdown.lockHealth}/25`,
    ),
  );

  // ── Warnings ─────────────────────────────────────────────────────────────────
  if (result.warnings.length > 0) {
    console.log('\n' + chalk.bold.yellow('  ⚠  WARNINGS'));
    result.warnings.forEach((w) => console.log(chalk.yellow(`  • ${w}`)));
  }

  // ── Cache Hit Rate ───────────────────────────────────────────────────────────
  const cacheColor =
    result.cacheHitRate >= 95
      ? chalk.green
      : result.cacheHitRate >= 85
        ? chalk.yellow
        : chalk.red;

  console.log('\n' + chalk.bold.white('  CACHE HIT RATE'));
  console.log(chalk.bold.blue('  ─────────────────────────────────────────'));
  console.log(`  ${cacheColor.bold(result.cacheHitRate + '%')}  ${result.cacheHitRate >= 95
    ? chalk.green('✓ Excellent')
    : result.cacheHitRate >= 85
      ? chalk.yellow('⚠ Consider increasing shared_buffers')
      : chalk.red('✗ Low — increase shared_buffers or add indexes')
    }`);

  // ── Slow Queries ─────────────────────────────────────────────────────────────
  console.log('\n' + chalk.bold.white('  SLOW QUERIES'));
  console.log(chalk.bold.blue('  ─────────────────────────────────────────'));

  if (result.slowQueries.length === 0) {
    console.log(chalk.green('  ✓ No slow queries detected'));
  } else {
    const t = new Table({
      head: ['Query', 'Calls', 'Mean (ms)', 'Max (ms)', 'Cache Hit%'].map((h) =>
        chalk.bold.white(h),
      ),
      colWidths: [40, 8, 10, 10, 12],
      style: { head: [], border: ['blue'] },
    });

    result.slowQueries.forEach((q) => {
      const meanColor = q.meanTimeMs > 1000 ? chalk.red : q.meanTimeMs > 500 ? chalk.yellow : chalk.white;
      t.push([
        chalk.gray(q.query.slice(0, 38)),
        q.calls.toLocaleString(),
        meanColor(q.meanTimeMs),
        chalk.gray(q.maxTimeMs),
        q.hitPercent < 90 ? chalk.yellow(q.hitPercent + '%') : chalk.gray(q.hitPercent + '%'),
      ]);
    });
    console.log(t.toString());

    // Plan warnings (populated only when --explain is passed)
    result.slowQueries.forEach((q) => {
      if (q.planWarnings && q.planWarnings.length > 0) {
        console.log(chalk.gray(`  ${q.query.slice(0, 60)}...`));
        q.planWarnings.forEach((w) =>
          console.log(chalk.yellow(`    ⚠  ${w.message}`)),
        );
      }
    });
  }

  // ── Unused Indexes ───────────────────────────────────────────────────────────
  console.log('\n' + chalk.bold.white('  UNUSED INDEXES'));
  console.log(chalk.bold.blue('  ─────────────────────────────────────────'));

  if (result.unusedIndexes.length === 0) {
    console.log(chalk.green('  ✓ No unused indexes found'));
  } else {
    const t = new Table({
      head: ['Table', 'Index', 'Size', 'Scans', 'Recommendation'].map((h) =>
        chalk.bold.white(h),
      ),
      colWidths: [18, 22, 8, 7, 28],
      style: { head: [], border: ['blue'] },
    });

    result.unusedIndexes.forEach((idx) => {
      t.push([
        chalk.gray(idx.table),
        chalk.yellow(idx.index),
        idx.indexSize,
        idx.indexScans === 0 ? chalk.red('0') : chalk.yellow(String(idx.indexScans)),
        chalk.gray('Consider DROP INDEX ' + idx.index),
      ]);
    });
    console.log(t.toString());
  }

  // ── Bloated Indexes ──────────────────────────────────────────────────────────
  console.log('\n' + chalk.bold.white('  BLOATED INDEXES'));
  console.log(chalk.bold.blue('  ─────────────────────────────────────────'));

  if (result.bloatedIndexes.length === 0) {
    console.log(chalk.green('  ✓ No significantly bloated indexes found'));
  } else {
    const t = new Table({
      head: ['Table', 'Index', 'Total Size', 'Bloat', 'Bloat%'].map((h) =>
        chalk.bold.white(h),
      ),
      colWidths: [18, 22, 12, 12, 10],
      style: { head: [], border: ['blue'] },
    });

    result.bloatedIndexes.forEach((b) => {
      const pctColor = b.bloatPercent > 60 ? chalk.red : chalk.yellow;
      t.push([
        chalk.gray(b.table),
        chalk.yellow(b.index),
        b.indexSize,
        b.bloatEstimate,
        pctColor(b.bloatPercent + '%'),
      ]);
    });
    console.log(t.toString());
    console.log(chalk.gray('  → Run REINDEX INDEX <name> to reclaim space'));
  }

  // ── Bloated Tables ───────────────────────────────────────────────────────────
  console.log('\n' + chalk.bold.white('  BLOATED TABLES'));
  console.log(chalk.bold.blue('  ─────────────────────────────────────────'));

  if (result.bloatedTables.length === 0) {
    console.log(chalk.green('  ✓ No significantly bloated tables found'));
  } else {
    const t = new Table({
      head: ['Table', 'Size', 'Dead Tuples', 'Dead%', 'Last Vacuum'].map((h) =>
        chalk.bold.white(h),
      ),
      colWidths: [22, 10, 14, 9, 22],
      style: { head: [], border: ['blue'] },
    });

    result.bloatedTables.forEach((b) => {
      const pctColor = b.deadTuplePct > 20 ? chalk.red : chalk.yellow;
      t.push([
        chalk.gray(b.table),
        b.tableSize,
        b.deadTuples.toLocaleString(),
        pctColor(b.deadTuplePct.toFixed(1) + '%'),
        chalk.gray(b.lastAutovacuum ?? b.lastVacuum ?? 'Never'),
      ]);
    });
    console.log(t.toString());
    console.log(chalk.gray('  → Run VACUUM ANALYZE <table> to reclaim dead tuples'));
  }

  // ── N+1 Patterns ─────────────────────────────────────────────────────────────
  console.log('\n' + chalk.bold.white('  N+1 QUERY PATTERNS'));
  console.log(chalk.bold.blue('  ─────────────────────────────────────────'));

  if (result.n1Patterns.length === 0) {
    console.log(chalk.green('  ✓ No N+1 patterns detected'));
  } else {
    result.n1Patterns.forEach((p, i) => {
      console.log(chalk.yellow(`\n  [${i + 1}] ${p.query.slice(0, 80)}...`));
      console.log(chalk.gray(`      Calls: ${p.calls.toLocaleString()}  Mean: ${p.meanTimeMs}ms  Total: ${p.totalTimeMs}ms`));
      console.log(chalk.gray(`      ${p.suspicionReason}`));
    });
  }

  // ── Locks ─────────────────────────────────────────────────────────────────────
  console.log('\n' + chalk.bold.white('  ACTIVE LOCKS & LONG-RUNNING QUERIES'));
  console.log(chalk.bold.blue('  ─────────────────────────────────────────'));

  if (result.locks.length === 0) {
    console.log(chalk.green('  ✓ No problematic locks or long-running queries'));
  } else {
    const t = new Table({
      head: ['PID', 'Duration', 'State', 'Blocked By', 'Query'].map((h) =>
        chalk.bold.white(h),
      ),
      colWidths: [8, 10, 12, 12, 38],
      style: { head: [], border: ['blue'] },
    });

    result.locks.forEach((l) => {
      const blockedColor = l.blockedBy ? chalk.red : chalk.gray;
      t.push([
        String(l.pid),
        chalk.yellow(l.duration),
        chalk.gray(l.state),
        blockedColor(l.blockedBy ? String(l.blockedBy) : '—'),
        chalk.gray(l.query.slice(0, 36)),
      ]);
    });
    console.log(t.toString());
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  console.log('\n' + chalk.bold.blue('━'.repeat(60)));
  console.log(chalk.gray(`  pg-inspector v${version}  •  github.com/khush-shah/pg-inspector`));
  console.log(chalk.bold.blue('━'.repeat(60)) + '\n');
}

export function renderDiff(diff: DiffReport): void {
  const delta = diff.scoreDelta;
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '─';
  const sign  = delta > 0 ? '+' : '';
  const deltaColor = delta > 0 ? chalk.green : delta < 0 ? chalk.red : chalk.gray;

  console.log('\n' + chalk.bold.blue('━'.repeat(60)));
  console.log(chalk.bold.white('  pg-inspector diff'));
  console.log(chalk.bold.blue('━'.repeat(60)));

  console.log('\n' + chalk.bold.white('  HEALTH SCORE'));
  console.log(chalk.bold.blue('  ─────────────────────────────────────────'));
  console.log(
    `  ${diff.scoreBefore} ${diff.gradeBefore}  →  ${diff.scoreAfter} ${diff.gradeAfter}   ` +
    deltaColor.bold(`${arrow} ${sign}${delta} pts`),
  );

  console.log('\n' + chalk.bold.white('  CACHE HIT RATE'));
  console.log(chalk.bold.blue('  ─────────────────────────────────────────'));
  const cacheDelta = (diff.cacheHitAfter - diff.cacheHitBefore).toFixed(1);
  const cacheSign  = diff.cacheHitAfter >= diff.cacheHitBefore ? '+' : '';
  const cacheColor = diff.cacheHitAfter >= diff.cacheHitBefore ? chalk.green : chalk.red;
  console.log(`  ${diff.cacheHitBefore}%  →  ${diff.cacheHitAfter}%   ` + cacheColor(`(${cacheSign}${cacheDelta}%)`));

  if (diff.newSlowQueries.length > 0) {
    console.log('\n' + chalk.bold.red('  NEW SLOW QUERIES SINCE BASELINE'));
    console.log(chalk.bold.blue('  ─────────────────────────────────────────'));
    diff.newSlowQueries.forEach((q) => console.log(chalk.red(`  + ${q}`)));
  }

  if (diff.resolvedSlowQueries.length > 0) {
    console.log('\n' + chalk.bold.green('  RESOLVED SLOW QUERIES'));
    console.log(chalk.bold.blue('  ─────────────────────────────────────────'));
    diff.resolvedSlowQueries.forEach((q) => console.log(chalk.green(`  ✓ ${q}`)));
  }

  if (diff.newUnusedIndexes.length > 0) {
    console.log('\n' + chalk.bold.yellow('  NEW UNUSED INDEXES'));
    console.log(chalk.bold.blue('  ─────────────────────────────────────────'));
    diff.newUnusedIndexes.forEach((i) => console.log(chalk.yellow(`  + ${i}`)));
  }

  console.log('\n' + chalk.bold.white('  LOCK CONTENTION'));
  console.log(chalk.bold.blue('  ─────────────────────────────────────────'));
  console.log(chalk.gray(`  Blocked queries:     ${diff.blockedBefore}  →  ${diff.blockedAfter}`));
  console.log(chalk.gray(`  Idle-in-transaction: ${diff.idleInTxBefore}  →  ${diff.idleInTxAfter}`));

  console.log('\n' + chalk.bold.blue('━'.repeat(60)) + '\n');
}
