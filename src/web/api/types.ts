export type {
  AccountAnalysis,
  AccountGlobalSummary,
  BadgeCount,
  BigPity,
  FreeBatch,
  Luck,
  PoolGroup,
  SixStarHit,
  SubHitSummary,
  Tab,
  TabOverview,
  Tone,
  WeaponTenRoll,
  WeaponTenRollItem,
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
  avatar?: string;
  counts: {
    total: number;
    draws: number;
  };
}

export interface AccountAvatarResponse {
  accountKey: string;
  avatar: string;
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
  label?: string;
  createdAt: number;
}

export interface PassportQrCreateResponse {
  scanId: string;
  scanUrl: string;
}

export type PassportQrStatusResponse =
  | {
      status: "pending";
      consecutiveErrors?: number;
      transientError?: string;
      hint?: string;
    }
  | {
      status: "error";
      error: string;
    }
  | {
      status: "confirmed";
      vaultId?: string;
      label: string;
      bindings: PassportBindingSummary[];
    };

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
  /** 离愁轩：本次按文件 UID 新建了账号 */
  createdAccount?: boolean;
}

export interface ExportSaveResponse {
  file: string;
  dir: string;
  bytes: number;
  accounts: number;
  records: number;
}

export interface BackupFileInfo {
  file: string;
  size: number;
  mtime: number;
}

export interface BackupListResponse {
  dir: string;
  files: BackupFileInfo[];
}

export interface BackupResponse {
  file: string;
}
