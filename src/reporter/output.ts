import fs from 'fs';
import path from 'path';
import { AnalysisResult } from '../types';

// ── JSON Reporter ─────────────────────────────────────────────────────────────
export function renderJson(result: AnalysisResult, outFile?: string): void {
  const json = JSON.stringify(result, null, 2);
  if (outFile) {
    const resolved = path.resolve(outFile);
    fs.writeFileSync(resolved, json, 'utf8');
    console.log(`Report written to: ${resolved}`);
  } else {
    console.log(json);
  }
}

// ── HTML Reporter ─────────────────────────────────────────────────────────────
export function renderHtml(result: AnalysisResult, outFile?: string): void {
  const { healthScore: hs } = result;

  const gradeColor: Record<string, string> = {
    A: '#16a34a', B: '#0891b2', C: '#ca8a04', D: '#ea580c', F: '#dc2626',
  };
  const gc = gradeColor[hs.grade] ?? '#374151';

  const escHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const slowQueriesHtml =
    result.slowQueries.length === 0
      ? '<p class="ok">✓ No slow queries detected</p>'
      : `<table>
          <thead><tr><th>Query</th><th>Calls</th><th>Mean (ms)</th><th>P95 (ms)</th><th>Cache Hit%</th></tr></thead>
          <tbody>
            ${result.slowQueries
        .map(
          (q) =>
            `<tr>
                    <td class="mono">${escHtml(q.query.slice(0, 120))}</td>
                    <td>${q.calls.toLocaleString()}</td>
                    <td class="${q.meanTimeMs > 500 ? 'warn' : ''}">${q.meanTimeMs}</td>
                    <td>${q.p95TimeMs}</td>
                    <td class="${q.hitPercent < 90 ? 'warn' : ''}">${q.hitPercent}%</td>
                  </tr>`
        )
        .join('')}
          </tbody>
        </table>`;

  const unusedIdxHtml =
    result.unusedIndexes.length === 0
      ? '<p class="ok">✓ No unused indexes found</p>'
      : `<table>
          <thead><tr><th>Table</th><th>Index</th><th>Size</th><th>Scans</th></tr></thead>
          <tbody>
            ${result.unusedIndexes
        .map(
          (i) =>
            `<tr>
                    <td>${escHtml(i.table)}</td>
                    <td class="mono warn">${escHtml(i.index)}</td>
                    <td>${i.indexSize}</td>
                    <td class="warn">${i.indexScans}</td>
                  </tr>`
        )
        .join('')}
          </tbody>
        </table>`;

  const locksHtml =
    result.locks.length === 0
      ? '<p class="ok">✓ No problematic locks found</p>'
      : `<table>
          <thead><tr><th>PID</th><th>Duration</th><th>State</th><th>Blocked By</th><th>Query</th></tr></thead>
          <tbody>
            ${result.locks
        .map(
          (l) =>
            `<tr>
                    <td>${l.pid}</td>
                    <td class="warn">${l.duration}</td>
                    <td>${escHtml(l.state)}</td>
                    <td class="${l.blockedBy ? 'error' : ''}">${l.blockedBy ?? '—'}</td>
                    <td class="mono">${escHtml(l.query.slice(0, 80))}</td>
                  </tr>`
        )
        .join('')}
          </tbody>
        </table>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>pg-inspector Report — ${result.analyzedAt.toLocaleDateString()}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 32px; }
    h1 { font-size: 1.8rem; color: #60a5fa; margin-bottom: 4px; }
    .meta { color: #64748b; font-size: 0.85rem; margin-bottom: 32px; }
    .score-card { background: #1e293b; border-radius: 12px; padding: 24px; margin-bottom: 32px; display: flex; gap: 32px; align-items: center; }
    .score-num { font-size: 4rem; font-weight: 800; color: ${gc}; line-height: 1; }
    .score-grade { font-size: 2rem; font-weight: 700; color: ${gc}; }
    .breakdown { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .breakdown-item { background: #0f172a; border-radius: 6px; padding: 8px 12px; font-size: 0.8rem; }
    .breakdown-item span { float: right; font-weight: 600; color: #60a5fa; }
    section { margin-bottom: 32px; }
    h2 { font-size: 1.1rem; color: #60a5fa; border-bottom: 1px solid #1e293b; padding-bottom: 8px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { background: #1e293b; padding: 8px 12px; text-align: left; color: #94a3b8; font-weight: 600; }
    td { padding: 8px 12px; border-bottom: 1px solid #1e293b; }
    tr:hover td { background: #1e293b44; }
    .mono { font-family: 'Courier New', monospace; font-size: 0.78rem; color: #94a3b8; }
    .ok { color: #16a34a; padding: 8px 0; }
    .warn { color: #ca8a04; }
    .error { color: #dc2626; }
    .cache-bar { background: #1e293b; border-radius: 8px; height: 20px; overflow: hidden; margin-top: 8px; }
    .cache-fill { height: 100%; background: ${result.cacheHitRate >= 95 ? '#16a34a' : result.cacheHitRate >= 85 ? '#ca8a04' : '#dc2626'}; width: ${result.cacheHitRate}%; transition: width 1s; }
    footer { color: #475569; font-size: 0.8rem; margin-top: 32px; text-align: center; }
  </style>
</head>
<body>
  <h1>🔍 pg-inspector</h1>
  <p class="meta">
    Connected to: ${escHtml(result.connectedTo)} &nbsp;|&nbsp;
    ${result.postgresVersion.split(' ').slice(0, 2).join(' ')} &nbsp;|&nbsp;
    ${result.analyzedAt.toLocaleString()}
  </p>

  <div class="score-card">
    <div>
      <div class="score-num">${hs.total}</div>
      <div style="color:#64748b;font-size:0.9rem;">out of 100</div>
    </div>
    <div class="score-grade">Grade ${hs.grade}</div>
    <div class="breakdown" style="flex:1">
      <div class="breakdown-item">Slow Queries <span>${hs.breakdown.slowQueries}/25</span></div>
      <div class="breakdown-item">Index Health <span>${hs.breakdown.indexHealth}/25</span></div>
      <div class="breakdown-item">Cache Hit Rate <span>${hs.breakdown.cacheHitRate}/25</span></div>
      <div class="breakdown-item">Lock Health <span>${hs.breakdown.lockHealth}/25</span></div>
    </div>
  </div>

  <section>
    <h2>Buffer Cache Hit Rate</h2>
    <p style="margin-bottom:8px">${result.cacheHitRate}% — ${result.cacheHitRate >= 95 ? '✓ Excellent' : result.cacheHitRate >= 85 ? '⚠ Consider increasing shared_buffers' : '✗ Low cache hit rate'}</p>
    <div class="cache-bar"><div class="cache-fill"></div></div>
  </section>

  <section><h2>Slow Queries</h2>${slowQueriesHtml}</section>
  <section><h2>Unused Indexes</h2>${unusedIdxHtml}</section>

  <section>
    <h2>Bloated Indexes</h2>
    ${result.bloatedIndexes.length === 0
      ? '<p class="ok">✓ No significantly bloated indexes found</p>'
      : `<table>
          <thead><tr><th>Table</th><th>Index</th><th>Total Size</th><th>Bloat</th><th>Bloat%</th></tr></thead>
          <tbody>
            ${result.bloatedIndexes.map(b =>
        `<tr><td>${escHtml(b.table)}</td><td class="mono warn">${escHtml(b.index)}</td><td>${b.indexSize}</td><td>${b.bloatEstimate}</td><td class="warn">${b.bloatPercent}%</td></tr>`
      ).join('')}
          </tbody>
        </table>`
    }
  </section>

  <section>
    <h2>N+1 Patterns</h2>
    ${result.n1Patterns.length === 0
      ? '<p class="ok">✓ No N+1 patterns detected</p>'
      : result.n1Patterns.map((p, i) =>
        `<div style="background:#1e293b;border-radius:8px;padding:16px;margin-bottom:12px">
            <div class="mono warn">[${i + 1}] ${escHtml(p.query.slice(0, 120))}...</div>
            <div style="color:#64748b;font-size:0.82rem;margin-top:8px">
              Calls: ${p.calls.toLocaleString()} &nbsp;|&nbsp; Mean: ${p.meanTimeMs}ms &nbsp;|&nbsp; Total: ${p.totalTimeMs}ms
            </div>
            <div style="color:#94a3b8;font-size:0.82rem;margin-top:4px">${escHtml(p.suspicionReason)}</div>
          </div>`
      ).join('')
    }
  </section>

  <section><h2>Active Locks &amp; Long-Running Queries</h2>${locksHtml}</section>

  <footer>pg-inspector v0.1.0 &nbsp;•&nbsp; github.com/khush-shah/pg-inspector</footer>
</body>
</html>`;

  if (outFile) {
    const resolved = path.resolve(outFile);
    fs.writeFileSync(resolved, html, 'utf8');
    console.log(`HTML report written to: ${resolved}`);
  } else {
    const defaultOut = `pg-inspector-report-${Date.now()}.html`;
    fs.writeFileSync(defaultOut, html, 'utf8');
    console.log(`HTML report written to: ${defaultOut}`);
  }
}
