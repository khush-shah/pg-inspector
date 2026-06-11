import { Command } from 'commander';
import ora from 'ora';
import { analyze } from './index';
import { renderTerminal } from './reporter/terminal';
import { renderJson, renderHtml } from './reporter/output';
import { AnalyzeOptions } from './types';

const program = new Command();

program.name('pg-inspector').description('PostgreSQL query health CLI').version('0.1.2');

program.command('analyze').description('Run a full health analysis on your PostgreSQL database').option('-c, --conn <url>', 'PostgreSQL connection string (or set PG_INSPECTOR_URL env var)').option('-f, --format <format>', 'Output format: terminal | json | html', 'terminal').option('-o, --out <file>', 'Output file path (for json/html formats)').option('-t, --threshold <ms>', 'Slow query threshold in milliseconds', '100').option('-l, --limit <n>', 'Max results per check', '20').option('--no-color', 'Disable colored output').option('--no-ssl-verify', 'Disable SSL certificate verification (insecure)').option('--full-queries', 'Show full query text without truncation').option('--ci', 'CI mode — exit with code 1 if score below --min-score').option('--min-score <n>', 'Minimum health score for CI mode', '75').action(async (opts) => {
  const connString = opts.conn || process.env.PG_INSPECTOR_URL;

  if (!connString) {
    console.error('Error: Connection string required. Use --conn or set PG_INSPECTOR_URL env var.');
    process.exit(1);
  }

  const format = ['terminal', 'json', 'html'].includes(opts.format) ? (opts.format as 'terminal' | 'json' | 'html') : 'terminal';

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
  };

  const spinner = ora({ text: 'Connecting to database...', color: 'blue' }).start();

  try {
    spinner.text = 'Running analysis...';
    const result = await analyze(options);
    spinner.succeed('Analysis complete');

    if (format === 'terminal') renderTerminal(result, options.noColor);
    else if (format === 'json') renderJson(result, options.out);
    else if (format === 'html') renderHtml(result, options.out);

    if (options.ciMode && result.healthScore.total < options.minScore) {
      console.error(`\n✖ CI check failed: score ${result.healthScore.total} is below minimum ${options.minScore}`);
      process.exit(1);
    }
  } catch (err: unknown) {
    spinner.fail('Analysis failed');
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ECONNREFUSED')) console.error('\nError: Could not connect to the database.');
    else if (message.includes('28P01')) console.error('\nError: Authentication failed.');
    else if (message.includes('3D000')) console.error('\nError: Database does not exist.');
    else console.error('\nError:', message);
    process.exit(1);
  }
});

program.command('locks').description('Show only active locks and long-running queries').option('-c, --conn <url>', 'PostgreSQL connection string').option('-l, --limit <n>', 'Max results', '20').action(async (opts) => {
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
        const tags = [l.isIdleInTransaction ? '⚠ IDLE IN TRANSACTION' : '', l.blockedBy ? `BLOCKED BY ${l.blockedBy}` : ''].filter(Boolean).join(' | ');
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
