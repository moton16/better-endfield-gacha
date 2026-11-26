export type {
  AccountAnalysis,
  BadgeCount,
  BigPity,
  FreeBatch,
  Luck,
  PoolGroup,
  SixStarHit,
  Tab,
  TabOverview,
  Tone,
} from "../../core/analysis/types.js";

export interface HealthResponse {
  ok: boolean;
  version: string;
}

export interface AccountSummary {
  accountKey: string;
  maskedKey: string;
  region: string;
  channelName: string;
  nickname: string;
  source: string;
  updatedAt: number;
  counts: {
    total: number;
    draws: number;
  };
}

export interface RecordItem {
  type: "char" | "weapon";
  feed: string;
  poolType: string;
  poolId: string;
  poolName: string;
  itemId: string;
  itemName: string;
  itemSubType: string;
  rarity: number;
  isFree: boolean;
  isNew: boolean;
  gachaTs: string;
  seqId: string;
  kind: string;
}

export interface RecordsResponse {
  total: number;
  items: RecordItem[];
}

export interface CacheLocationInfo {
  dir: string;
  backend: string;
  origin: string;
}

export interface CacheCredentialInfo {
  fingerprint: string;
  host: string;
  channel?: string;
  subChannel?: string;
  serverId: string;
  sortTime: number;
  paths: string[];
}

export interface CacheScanError {
  dir: string;
  message: string;
}

export interface CacheScanResponse {
  locations: CacheLocationInfo[];
  credentials: CacheCredentialInfo[];
  errors: CacheScanError[];
}

export interface LinkResponse {
  masked: string;
  copied?: boolean;
  link?: string;
}

export interface PassportBindingSummary {
  channelName: string;
  channelMasterId: string;
  roleCount: number;
  isDefault: boolean;
  uidFingerprint: string;
}

export interface PassportInspectResponse {
  bindings: PassportBindingSummary[];
  vaultId?: string;
}

export interface VaultSession {
  id: string;
  provider: string;
  createdAt: number;
}

export interface SyncFeedSummary {
  label: string;
  fetched: number;
  added: number;
  status: "ok" | "skipped" | "error";
  error?: string;
}

export interface SyncSummaryItem {
  channelName: string;
  maskedKey: string;
  ok: boolean;
  feeds: SyncFeedSummary[];
  warnings: string[];
  error?: string;
}

export interface SyncSummary {
  items: SyncSummaryItem[];
}

export interface SyncJob {
  id: string;
  kind: string;
  state: "running" | "done" | "error";
  progress: string[];
  result?: SyncSummary;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface ImportPlanSummary {
  maskedKey: string;
  total: number;
  added: number;
  duplicates: number;
  conflicts: number;
  skipped: number;
}

export interface ImportResponse {
  plans: ImportPlanSummary[];
  warnings: string[];
  unresolvedPools: string[];
  applied: boolean;
  backup?: string;
}

export interface BackupResponse {
  file: string;
}
