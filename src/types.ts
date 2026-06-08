export interface SlowQuery {
  queryId: string;
  query: string;
  calls: number;
  totalTimeMs: number;
  meanTimeMs: number;
  p95TimeMs: number;
  stddevTimeMs: number;
  rows: number;
  hitPercent: number; // buffer cache hit %
}

export interface IndexRecommendation {
  query: string;
  table: string;
  suggestedIndex: string;
  reason: string;
  estimatedImpact: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface UnusedIndex {
  schema: string;
  table: string;
  index: string;
  indexSize: string;
  indexScans: number;
  reason: string;
}

export interface BloatedIndex {
  schema: string;
  table: string;
  index: string;
  indexSize: string;
  bloatEstimate: string;
  bloatPercent: number;
}

export interface N1Pattern {
  query: string;
  calls: number;
  meanTimeMs: number;
  totalTimeMs: number;
  suspicionReason: string;
}

export interface LockInfo {
  pid: number;
  duration: string;
  state: string;
  waitEventType: string | null;
  waitEvent: string | null;
  blockedBy: number | null;
  query: string;
  lockType: string | null;
  relation: string | null;
}

export interface HealthScore {
  total: number; // 0-100
  breakdown: {
    slowQueries: number;    // 0-25
    indexHealth: number;    // 0-25
    cacheHitRate: number;   // 0-25
    lockHealth: number;     // 0-25
  };
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface AnalysisResult {
  connectedTo: string;
  postgresVersion: string;
  analyzedAt: Date;
  slowQueries: SlowQuery[];
  unusedIndexes: UnusedIndex[];
  bloatedIndexes: BloatedIndex[];
  n1Patterns: N1Pattern[];
  locks: LockInfo[];
  indexRecommendations: IndexRecommendation[];
  cacheHitRate: number; // %
  healthScore: HealthScore;
  warnings: string[];
}

export interface AnalyzeOptions {
  conn: string;
  format: 'terminal' | 'json' | 'html';
  out?: string;
  threshold: number; // ms — slow query threshold
  limit: number;     // max results per check
  noColor: boolean;
}
