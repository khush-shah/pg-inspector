import { describe, it, expect } from 'vitest';
import { computeHealthScore } from '../src/score';
import { AnalysisResult } from '../src/types';

function makeBase(): Omit<AnalysisResult, 'healthScore'> {
  return {
    connectedTo: 'localhost/test',
    postgresVersion: 'PostgreSQL 16.0',
    analyzedAt: new Date(),
    slowQueries: [],
    unusedIndexes: [],
    bloatedIndexes: [],
    n1Patterns: [],
    locks: [],
    indexRecommendations: [],
    cacheHitRate: 99,
    warnings: [],
  };
}

describe('computeHealthScore', () => {
  it('returns 100 for a perfectly healthy DB', () => {
    const result = computeHealthScore(makeBase());
    expect(result.total).toBe(100);
    expect(result.grade).toBe('A');
  });

  it('deducts 5 per slow query', () => {
    const base = makeBase();
    base.slowQueries = [
      { queryId: '1', query: 'SELECT 1', calls: 10, totalTimeMs: 5000, meanTimeMs: 500, p95TimeMs: 800, stddevTimeMs: 100, rows: 1, hitPercent: 99 },
      { queryId: '2', query: 'SELECT 2', calls: 5, totalTimeMs: 3000, meanTimeMs: 600, p95TimeMs: 900, stddevTimeMs: 150, rows: 1, hitPercent: 99 },
    ];
    const result = computeHealthScore(base);
    expect(result.breakdown.slowQueries).toBe(15); // 25 - 2*5
  });

  it('deducts 3 per unused index', () => {
    const base = makeBase();
    base.unusedIndexes = [
      { schema: 'public', table: 'users', index: 'idx_users_old', indexSize: '1MB', indexScans: 0, reason: 'Never used' },
      { schema: 'public', table: 'orders', index: 'idx_orders_old', indexSize: '2MB', indexScans: 0, reason: 'Never used' },
    ];
    const result = computeHealthScore(base);
    expect(result.breakdown.indexHealth).toBe(19); // 25 - 2*3
  });

  it('assigns correct grade for score 80', () => {
    const base = makeBase();
    // Knock off 20 points via slow queries (4 * 5 = 20)
    base.slowQueries = Array(4).fill({
      queryId: '1', query: 'SELECT 1', calls: 10, totalTimeMs: 5000,
      meanTimeMs: 500, p95TimeMs: 800, stddevTimeMs: 100, rows: 1, hitPercent: 99,
    });
    const result = computeHealthScore(base);
    expect(result.total).toBe(80);
    expect(result.grade).toBe('B');
  });

  it('assigns grade F for very unhealthy DB', () => {
    const base = makeBase();
    base.slowQueries = Array(5).fill({ queryId: '1', query: 'x', calls: 10, totalTimeMs: 5000, meanTimeMs: 500, p95TimeMs: 800, stddevTimeMs: 100, rows: 1, hitPercent: 99 });
    base.unusedIndexes = Array(5).fill({ schema: 'public', table: 'x', index: 'idx_x', indexSize: '1MB', indexScans: 0, reason: 'unused' });
    base.cacheHitRate = 50;
    base.locks = Array(3).fill({ pid: 1, duration: '60s', state: 'active', waitEventType: null, waitEvent: null, blockedBy: 2, query: 'SELECT 1', lockType: 'relation', relation: 'users' });
    const result = computeHealthScore(base);
    expect(result.grade).toBe('F');
  });

  it('cache hit 100% → score 25, cache hit 80% → score 4', () => {
    const base99 = { ...makeBase(), cacheHitRate: 99 };
    const base80 = { ...makeBase(), cacheHitRate: 80 };
    expect(computeHealthScore(base99).breakdown.cacheHitRate).toBe(25);
    expect(computeHealthScore(base80).breakdown.cacheHitRate).toBe(4);
  });

  it('breakdown sums equal total', () => {
    const base = makeBase();
    base.cacheHitRate = 90;
    base.unusedIndexes = [{ schema: 'public', table: 'users', index: 'idx_x', indexSize: '1MB', indexScans: 0, reason: 'unused' }];
    const result = computeHealthScore(base);
    const sum = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(result.total);
  });
});
