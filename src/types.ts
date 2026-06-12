export interface PlanWarning {
  type: 'seq_scan' | 'sort_spill' | 'nested_loop' | 'high_cost';
  message: string;
}

export interface SlowQuery {
  queryId: string;
  query: string;
  fullQuery: string;
  calls: number;
  totalTimeMs: number;
  meanTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  stddevTimeMs: number;
  rows: number;
  hitPercent: number;
  spillsToDisk: boolean;
  tempBlksWritten: number;
  sharedBlksWritten: number;
  planWarnings: PlanWarning[];
  estimatedCost?: number;
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
  isFkSupporting: boolean;
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

export interface BloatedTable {
  schema: string;
  table: string;
  deadTuples: number;
  liveTuples: number;
  tableSize: string;
  deadTuplePct: number;
  lastAutovacuum: string | null;
  lastVacuum: string | null;
}

export interface N1Pattern {
  query: string;
  calls: number;
  meanTimeMs: number;
  totalTimeMs: number;
  callsRank: number;
  suspicionReason: string;
  label: string;
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
  isIdleInTransaction: boolean;
}

export interface MissingIndex {
  schema: string;
  table: string;
  seqScans: number;
  seqTupRead: number;
  idxScans: number;
  tableSize: string;
  liveTuples: number;
  suggestion: string;
}

export interface ReplicationInfo {
  applicationName: string;
  state: string;
  writeLagSecs: number;
  flushLagSecs: number;
  replayLagSecs: number;
  syncState: string;
  isLagging: boolean;
}

export interface HealthScore {
  total: number;
  breakdown: {
    slowQueries: number;
    indexHealth: number;
    cacheHitRate: number;
    lockHealth: number;
  };
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export type WorkloadProfile = 'oltp' | 'olap' | 'mixed';

export interface ProfileConfig {
  cacheHitExcellent: number;
  cacheHitGood: number;
  cacheHitFair: number;
  cacheHitPoor: number;
  cacheHitBad: number;
  longRunningTxSecs: number;
}

export const PROFILE_CONFIGS: Record<WorkloadProfile, ProfileConfig> = {
  oltp: {
    cacheHitExcellent: 99,
    cacheHitGood:      95,
    cacheHitFair:      90,
    cacheHitPoor:      85,
    cacheHitBad:       80,
    longRunningTxSecs: 30,
  },
  olap: {
    // OLAP does sequential scans — low cache hit rate is expected and normal
    cacheHitExcellent: 75,
    cacheHitGood:      55,
    cacheHitFair:      35,
    cacheHitPoor:      20,
    cacheHitBad:       10,
    longRunningTxSecs: 600,
  },
  mixed: {
    cacheHitExcellent: 95,
    cacheHitGood:      85,
    cacheHitFair:      75,
    cacheHitPoor:      65,
    cacheHitBad:       55,
    longRunningTxSecs: 120,
  },
};

export interface DiffReport {
  scoreBefore:         number;
  scoreAfter:          number;
  scoreDelta:          number;
  gradeBefore:         string;
  gradeAfter:          string;
  newSlowQueries:      string[];
  resolvedSlowQueries: string[];
  newUnusedIndexes:    string[];
  cacheHitBefore:      number;
  cacheHitAfter:       number;
  blockedBefore:       number;
  blockedAfter:        number;
  idleInTxBefore:      number;
  idleInTxAfter:       number;
}

export interface AnalysisResult {
  connectedTo: string;
  postgresVersion: string;
  analyzedAt: Date;
  slowQueries: SlowQuery[];
  unusedIndexes: UnusedIndex[];
  bloatedIndexes: BloatedIndex[];
  bloatedTables: BloatedTable[];
  n1Patterns: N1Pattern[];
  locks: LockInfo[];
  missingIndexes: MissingIndex[];
  replication: ReplicationInfo[];
  indexRecommendations: IndexRecommendation[];
  cacheHitRate: number;
  allQueryTotalMs: number;
  profile: WorkloadProfile;
  healthScore: HealthScore;
  warnings: string[];
  errors: string[];
}

export interface AnalyzeOptions {
  conn: string;
  format: 'terminal' | 'json' | 'html';
  out?: string;
  threshold: number;
  limit: number;
  noColor: boolean;
  noSslVerify: boolean;
  fullQueries: boolean;
  ciMode: boolean;
  minScore: number;
  explain?: boolean;
  profile?: WorkloadProfile;
}
