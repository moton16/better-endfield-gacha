import fs from "node:fs";
import path from "node:path";
import type { GachaStore } from "../storage/store.js";
import type { AccountRow, GachaRecord } from "../types.js";

export interface ImportPlan {
  accountKey: string;
  accountExists: boolean;
  total: number;
  newRecords: GachaRecord[];
  duplicates: number;
  conflicts: Array<{ feed: string; seqId: string }>;
  skipped: Array<{ index: number; reason: string }>;
}

function recordFingerprint(r: GachaRecord): string {
  return `${r.itemId}|${r.rarity}|${r.gachaTs}|${r.isFree ? 1 : 0}|${r.kind}`;
}

export function makeBackupPath(dataDir: string, now = new Date()): string {
  const dir = path.join(dataDir, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const raw = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const stamp = `${raw.slice(0, 8)}-${raw.slice(8, 14)}`;
  const base = path.join(dir, `gacha-${stamp}.sqlite`);
  if (!fs.existsSync(base)) return base;
  for (let i = 1; i <= 9999; i++) {
    const candidate = path.join(dir, `gacha-${stamp}-${i}.sqlite`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `gacha-${stamp}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
}

export function createBackup(store: GachaStore, dataDir: string, now = new Date()): string {
  const file = makeBackupPath(dataDir, now);
  store.backupTo(file);
  return file;
}

export function planImport(
  store: GachaStore,
  account: AccountRow,
  records: GachaRecord[],
  skipped: ImportPlan["skipped"] = [],
): ImportPlan {
  const have = store.getRecordFingerprints(account.accountKey);
  const batchSeen = new Map<string, string>();
  const newRecords: GachaRecord[] = [];
  const conflicts: ImportPlan["conflicts"] = [];
  let duplicates = 0;

  for (const r of records) {
    const key = `${r.feed}|${r.seqId}`;
    const myFp = recordFingerprint(r);
    const localFp = have.get(key);
    if (localFp !== undefined) {
      if (localFp === myFp) duplicates++;
      else conflicts.push({ feed: r.feed, seqId: r.seqId }); // 保留本地，不覆盖
      continue;
    }
    const batchFp = batchSeen.get(key);
    if (batchFp === undefined) {
      batchSeen.set(key, myFp);
      newRecords.push(r);
    } else if (batchFp === myFp) {
      duplicates++;
    } else {
      conflicts.push({ feed: r.feed, seqId: r.seqId });
    }
  }

  return {
    accountKey: account.accountKey,
    accountExists: store.getAccount(account.accountKey) !== null,
    total: records.length,
    newRecords,
    duplicates,
    conflicts,
    skipped,
  };
}

export function applyImport(
  store: GachaStore,
  dataDir: string,
  account: AccountRow,
  plan: ImportPlan,
): { added: number; backup: string } {
  const backup = createBackup(store, dataDir); // 落库前先备份
  if (!plan.accountExists) store.upsertAccount(account);
  const added = store.insertRecords(account.accountKey, plan.newRecords);
  return { added, backup };
}
