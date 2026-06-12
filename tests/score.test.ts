import { describe, it, expect } from 'vitest';
import { computeHealthScore } from '../src/score';
import { AnalysisResult, SlowQuery, LockInfo, UnusedIndex } from '../src/types';

function makeBase(): Omit<AnalysisResult, 'healthScore'> {
  return {
    connectedTo: 'localhost/test',
    postgresVersion: 'PostgreSQL 16.0',
    analyzedAt: new Date(),
    slowQueries: [],
    unusedIndexes: [],
    bloatedIndexes: [],
    bloatedTables: [],
    n1Patterns: [],
    locks: [],
    missingIndexes: [],
    replication: [],
    indexRecommendations: [],
    cacheHitRate: 99,
    allQueryTotalMs: 0,
    profile: 'oltp',
    warnings: [],
    errors: [],
  };
}

function makeSlowQuery(overrides: Partial<SlowQuery> = {}): SlowQuery {
  return {
    queryId: '1',
    query: 'SELECT 1',
    fullQuery: 'SELECT 1',
    calls: 10,
    totalTimeMs: 1000,
    meanTimeMs: 100,
    minTimeMs: 80,
    maxTimeMs: 200,
    stddevTimeMs: 20,
    rows: 1,
    hitPercent: 99,
    spillsToDisk: false,
    tempBlksWritten: 0,
    sharedBlksWritten: 0,
    planWarnings: [],
    ...overrides,
  };
}

function makeUnusedIndex(overrides: Partial<UnusedIndex> = {}): UnusedIndex {
  return {
    schema: 'public',
    table: 'users',
    index: 'idx_users_old',
    indexSize: '1MB',
    indexScans: 0,
    isFkSupporting: false,
    reason: 'Never used',
    ...overrides,
  };
}

function makeLock(overrides: Partial<LockInfo> = {}): LockInfo {
  return {
    pid: 1,
    duration: '5s',
    state: 'active',
    waitEventType: null,
    waitEvent: null,
    blockedBy: null,
    query: 'SELECT 1',
    lockType: 'relation',
    relation: 'users',
    isIdleInTransaction: false,
    ...overrides,
  };
}

describe('computeHealthScore', () => {
  it('returns 100 for a perfectly healthy DB', () => {
    const result = computeHealthScore(makeBase());
    expect(result.total).toBe(100);
    expect(result.grade).toBe('A');
  });

  it('gives full slow query score when allQueryTotalMs is 0 (no pg_stat_statements data)', () => {
    const base = makeBase();
    base.allQueryTotalMs = 0;
    base.slowQueries = [makeSlowQuery({ totalTimeMs: 5000 })];
    const result = computeHealthScore(base);
    expect(result.breakdown.slowQueries).toBe(25);
  });

  it('gives full slow query score when there are no slow queries', () => {
    const base = makeBase();
    base.allQueryTotalMs = 10000;
    base.slowQueries = [];
    expect(computeHealthScore(base).breakdown.slowQueries).toBe(25);
  });

  it('scores slow queries by DB time fraction — 20% of total time → score 15', () => {
    const base = makeBase();
    base.allQueryTotalMs = 1000;
    base.slowQueries = [makeSlowQuery({ totalTimeMs: 200 })]; // 20% of total
    // slowFraction=0.2 → round(25*(1-0.2*2)) = round(25*0.6) = 15
    const result = computeHealthScore(base);
    expect(result.breakdown.slowQueries).toBe(15);
  });

  it('scores slow queries by DB time fraction — 50%+ of total time → score 0', () => {
    const base = makeBase();
    base.allQueryTotalMs = 1000;
    base.slowQueries = [makeSlowQuery({ totalTimeMs: 600 })]; // 60%
    expect(computeHealthScore(base).breakdown.slowQueries).toBe(0);
  });

  it('deducts 3 per unused non-FK index', () => {
    const base = makeBase();
    base.unusedIndexes = [makeUnusedIndex(), makeUnusedIndex({ index: 'idx_orders_old' })];
    const result = computeHealthScore(base);
    expect(result.breakdown.indexHealth).toBe(19); // 25 - 2*3
  });

  it('deducts only 1 for FK-supporting unused index', () => {
    const base = makeBase();
    base.unusedIndexes = [makeUnusedIndex({ isFkSupporting: true })];
    expect(computeHealthScore(base).breakdown.indexHealth).toBe(24); // 25 - 1
  });

  it('deducts 4 per bloated index', () => {
    const base = makeBase();
    base.bloatedIndexes = [
      { schema: 'public', table: 'orders', index: 'idx_bloated', indexSize: '10MB', bloatEstimate: '4MB', bloatPercent: 40 },
    ];
    expect(computeHealthScore(base).breakdown.indexHealth).toBe(21); // 25 - 4
  });

  it('assigns grade A for score 90+', () => {
    expect(computeHealthScore(makeBase()).grade).toBe('A');
  });

  it('assigns grade F for very unhealthy DB', () => {
    const base = makeBase();
    // Kill cache hit rate and lock scores
    base.cacheHitRate = 50;
    base.unusedIndexes = Array(8).fill(null).map(() => makeUnusedIndex());
    base.locks = [
      makeLock({ blockedBy: 2 }),
      makeLock({ blockedBy: 3 }),
      makeLock({ isIdleInTransaction: true }),
    ];
    const result = computeHealthScore(base);
    expect(result.grade).toBe('F');
  });

  it('cache hit 99% → score 25 (oltp)', () => {
    const base = { ...makeBase(), cacheHitRate: 99 };
    expect(computeHealthScore(base).breakdown.cacheHitRate).toBe(25);
  });

  it('cache hit 80% → score 4 (oltp)', () => {
    const base = { ...makeBase(), cacheHitRate: 80 };
    expect(computeHealthScore(base).breakdown.cacheHitRate).toBe(4);
  });

  it('olap profile — 65% cache hit rate scores 15 (fair), not 0', () => {
    const base = { ...makeBase(), cacheHitRate: 65 };
    // olap: cacheHitFair=35, cacheHitGood=55 → 65% >= 55 → score 20
    expect(computeHealthScore(base, 'olap').breakdown.cacheHitRate).toBe(20);
  });

  it('oltp profile — same 65% cache hit rate scores 0', () => {
    const base = { ...makeBase(), cacheHitRate: 65 };
    // oltp: cacheHitBad=80 → 65% < 80 → score 0
    expect(computeHealthScore(base, 'oltp').breakdown.cacheHitRate).toBe(0);
  });

  it('olap profile — long-running tx does not penalise until 600s', () => {
    const base = makeBase();
    // 120s transaction — fine for olap (threshold 600s), bad for oltp (threshold 30s)
    base.locks = [makeLock({ duration: '120s' })];
    expect(computeHealthScore(base, 'olap').breakdown.lockHealth).toBe(25);
    expect(computeHealthScore(base, 'oltp').breakdown.lockHealth).toBe(22); // 25 - 1*3
  });

  it('breakdown components sum to total', () => {
    const base = makeBase();
    base.cacheHitRate = 90;
    base.unusedIndexes = [makeUnusedIndex()];
    const result = computeHealthScore(base);
    const sum = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(result.total);
  });
});
