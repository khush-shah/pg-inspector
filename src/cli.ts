import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import ora from 'ora';
import { analyze } from './index';
import { renderTerminal, renderDiff } from './reporter/terminal';
import { renderJson, renderHtml } from './reporter/output';
import { saveBaseline, loadBaseline, diffBaseline } from './baseline';
import { AnalyzeOptions, WorkloadProfile } from './types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../package.json') as { version: string };

const program = new Command();

program.name('pg-inspector').description('PostgreSQL query health CLI').version(version);

// ── analyze ───────────────────────────────────────────────────────────────────
program
  .command('analyze')
  .description('Run a full health analysis on your PostgreSQL database')
  .option('-c, --conn <url>', 'PostgreSQL connection string (or set PG_INSPECTOR_URL env var)')
  .option('-f, --format <format>', 'Output format: terminal | json | html', 'terminal')
  .option('-o, --out <file>', 'Output file path (for json/html formats)')
  .option('-t, --threshold <ms>', 'Slow query threshold in milliseconds', '100')
  .option('-l, --limit <n>', 'Max results per check', '20')
  .option('--no-color', 'Disable colored output')
  .option('--no-ssl-verify', 'Disable SSL certificate verification (insecure)')
  .option('--full-queries', 'Show full query text without truncation')
  .option('--ci', 'CI mode — exit with code 1 if score below --min-score')
  .option('--min-score <n>', 'Minimum health score for CI mode', '75')
  .option('--explain', 'Run EXPLAIN on slow queries to surface plan warnings (issues one extra query per slow query found)')
  .option('--profile <profile>', 'Workload profile affecting score thresholds: oltp | olap | mixed', 'oltp')
  .action(async (opts) => {
    const connString = opts.conn || process.env.PG_INSPECTOR_URL;

    if (!connString) {
      console.error('Error: Connection string required. Use --conn or set PG_INSPECTOR_URL env var.');
      process.exit(1);
    }

    const format = ['terminal', 'json', 'html'].includes(opts.format)
      ? (opts.format as 'terminal' | 'json' | 'html')
      : 'terminal';

    const options: AnalyzeOptions = {
      conn: connString,
      format,
      out: opts.out,
      threshold: parseInt(opts.threshold) || 100,
      limit: parseInt(opts.limit) || 20,
      noColor: opts.color === false,
      noSslVerify: opts.sslVerify === false,
      fullQueries: !!opts.fullQueries,
      ciMode: !!opts.ci,
      minScore: parseInt(opts.minScore) || 75,
      explain: !!opts.explain,
      profile: (opts.profile as WorkloadProfile) ?? 'oltp',
    };

    const spinner = ora({ text: 'Connecting to database...', color: 'blue' }).start();

    try {
      spinner.text = 'Running analysis...';
      const result = await analyze(options);
      spinner.succeed('Analysis complete');

      if (format === 'terminal') renderTerminal(result, options.noColor);
      else if (format === 'json')  renderJson(result, options.out);
      else if (format === 'html')  renderHtml(result, options.out);

      if (options.ciMode && result.healthScore.total < options.minScore) {
        console.error(`\n✖ CI check failed: score ${result.healthScore.total} is below minimum ${options.minScore}`);
        process.exit(1);
      }
    } catch (err: unknown) {
      spinner.fail('Analysis failed');
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ECONNREFUSED'))  console.error('\nError: Could not connect to the database.');
      else if (message.includes('28P01'))    console.error('\nError: Authentication failed.');
      else if (message.includes('3D000'))    console.error('\nError: Database does not exist.');
      else                                   console.error('\nError:', message);
      process.exit(1);
    }
  });

// ── baseline ──────────────────────────────────────────────────────────────────
program
  .command('baseline')
  .description('Run analysis and save result as a snapshot for later diffing')
  .option('-c, --conn <url>', 'PostgreSQL connection string (or set PG_INSPECTOR_URL env var)')
  .option('-o, --out <file>', 'Output path for baseline JSON', 'pg-inspector-baseline.json')
  .option('-t, --threshold <ms>', 'Slow query threshold in milliseconds', '100')
  .option('-l, --limit <n>', 'Max results per check', '20')
  .option('--profile <profile>', 'Workload profile: oltp | olap | mixed', 'oltp')
  .option('--no-ssl-verify', 'Disable SSL certificate verification (insecure)')
  .action(async (opts) => {
    const connString = opts.conn || process.env.PG_INSPECTOR_URL;
    if (!connString) {
      console.error('Error: Connection string required. Use --conn or set PG_INSPECTOR_URL env var.');
      process.exit(1);
    }

    const spinner = ora('Running baseline analysis...').start();
    try {
      const result = await analyze({
        conn: connString,
        format: 'json',
        threshold: parseInt(opts.threshold) || 100,
        limit: parseInt(opts.limit) || 20,
        noColor: false,
        noSslVerify: opts.sslVerify === false,
        fullQueries: false,
        ciMode: false,
        minScore: 75,
        profile: (opts.profile as WorkloadProfile) ?? 'oltp',
      });
      saveBaseline(result, opts.out);
      spinner.succeed(
        `Baseline saved to ${opts.out}  (score: ${result.healthScore.total}/100  grade: ${result.healthScore.grade})`,
      );
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
  });

// ── diff ──────────────────────────────────────────────────────────────────────
program
  .command('diff')
  .description('Compare current database health against a saved baseline snapshot')
  .option('-c, --conn <url>', 'PostgreSQL connection string (or set PG_INSPECTOR_URL env var)')
  .option('-b, --baseline <file>', 'Path to baseline JSON file', 'pg-inspector-baseline.json')
  .option('-t, --threshold <ms>', 'Slow query threshold in milliseconds', '100')
  .option('-l, --limit <n>', 'Max results per check', '20')
  .option('--profile <profile>', 'Workload profile: oltp | olap | mixed', 'oltp')
  .option('--no-ssl-verify', 'Disable SSL certificate verification (insecure)')
  .option('--fail-delta <n>', 'Exit code 1 if score dropped by more than N points', '0')
  .action(async (opts) => {
    const connString = opts.conn || process.env.PG_INSPECTOR_URL;
    if (!connString) {
      console.error('Error: Connection string required. Use --conn or set PG_INSPECTOR_URL env var.');
      process.exit(1);
    }

    let baselineData: ReturnType<typeof loadBaseline>;
    try {
      baselineData = loadBaseline(opts.baseline);
    } catch {
      console.error(`Error: Could not read baseline file at ${opts.baseline}`);
      console.error('Run "pg-inspector baseline" first to create one.');
      process.exit(2);
      return;
    }

    const spinner = ora('Running analysis for diff...').start();
    try {
      const current = await analyze({
        conn: connString,
        format: 'json',
        threshold: parseInt(opts.threshold) || 100,
        limit: parseInt(opts.limit) || 20,
        noColor: false,
        noSslVerify: opts.sslVerify === false,
        fullQueries: false,
        ciMode: false,
        minScore: 75,
        profile: (opts.profile as WorkloadProfile) ?? 'oltp',
      });
      spinner.succeed('Analysis complete');

      const diff = diffBaseline(baselineData.result, current);
      renderDiff(diff);

      const failDelta = parseInt(opts.failDelta) || 0;
      if (failDelta > 0 && diff.scoreDelta <= -failDelta) {
        console.error(`✖ Score dropped by ${Math.abs(diff.scoreDelta)} points (threshold: ${failDelta})`);
        process.exit(1);
      }
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
  });

// ── locks ─────────────────────────────────────────────────────────────────────
program
  .command('locks')
  .description('Show only active locks and long-running queries')
  .option('-c, --conn <url>', 'PostgreSQL connection string')
  .option('-l, --limit <n>', 'Max results', '20')
  .action(async (opts) => {
    const connString = opts.conn || process.env.PG_INSPECTOR_URL;
    if (!connString) { console.error('Error: Connection string required.'); process.exit(1); }

    const spinner = ora('Checking for locks...').start();
    try {
      const { analyzeLocks } = await import('./analyze/locks');
      const { createPool, closePool } = await import('./db');
      const pool = createPool(connString);
      const { locks } = await analyzeLocks(pool, parseInt(opts.limit) || 20);
      await closePool();
      spinner.succeed('Done');

      if (locks.length === 0) {
        console.log('\n✓ No problematic locks or long-running queries found\n');
      } else {
        locks.forEach((l) => {
          const tags = [
            l.isIdleInTransaction ? '⚠ IDLE IN TRANSACTION' : '',
            l.blockedBy ? `BLOCKED BY ${l.blockedBy}` : '',
          ].filter(Boolean).join(' | ');
          console.log(`\n  PID ${l.pid} | ${l.duration} | ${l.state}${tags ? ' | ' + tags : ''}`);
          console.log(`  ${l.query.slice(0, 100)}`);
        });
        console.log('');
      }
    } catch (err: unknown) {
      spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse(process.argv);
