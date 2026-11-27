/**
 * 从数据库备份（backups/gacha-*.sqlite）合并恢复。
 *
 * 语义为「合并」而非整库覆盖：本地永不删记录，因此把备份里本地缺失的账号/记录/卡池/头像补回来即等价于恢复；
 * 同一主键已存在时保留本地（与导入一致，冲突不覆盖）。恢复前自动再做一次安全备份。
 */
import fs from "node:fs";
import path from "node:path";
import { GachaStore } from "../storage/store.js";
import type { AccountRow, PoolInfo, RecordType, RerunCount } from "../types.js";
import { createBackup, planImport, type ImportPlan } from "./importer.js";
import { ImportError } from "./validate.js";

const BACKUP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.sqlite$/;

export interface BackupFileInfo {
  file: string;
  size: number;
  /** 毫秒时间戳 */
  mtime: number;
}

export function backupsDir(dataDir: string): string {
  return path.join(path.resolve(dataDir), "backups");
}

export function listBackups(dataDir: string): BackupFileInfo[] {
  const dir = backupsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  const out: BackupFileInfo[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile() || !BACKUP_NAME_RE.test(ent.name)) continue;
    const st = fs.statSync(path.join(dir, ent.name));
    out.push({ file: ent.name, size: st.size, mtime: Math.trunc(st.mtimeMs) });
  }
  return out.sort((a, b) => b.mtime - a.mtime || (a.file < b.file ? 1 : -1));
}

/** 仅接受 backups/ 下的纯文件名，防止路径穿越。 */
export function resolveBackupFile(dataDir: string, name: string): string {
  if (!BACKUP_NAME_RE.test(name) || name.includes("..")) {
    throw new ImportError("备份文件名非法");
  }
  const full = path.join(backupsDir(dataDir), name);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new ImportError("备份文件不存在");
  }
  return full;
}

export interface RestorePlan {
  accounts: Array<{ account: AccountRow; plan: ImportPlan }>;
  pools: PoolInfo[];
  avatars: Array<{ accountKey: string; avatar: string }>;
  reruns: Array<{ accountKey: string; type: RecordType; counts: RerunCount[] }>;
}

export function planRestore(store: GachaStore, dataDir: string, backupFile: string): RestorePlan {
  const tmpRoot = path.join(backupsDir(dataDir), `.restore-${process.pid}-${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });
  let bak: GachaStore | undefined;
  try {
    // 在副本上打开，绝不触碰原备份文件
    fs.copyFileSync(backupFile, path.join(tmpRoot, "gacha.sqlite"));
    try {
      bak = GachaStore.open(tmpRoot);
    } catch {
      throw new ImportError("不是有效的 SQLite 备份文件");
    }

    let bakAccounts: AccountRow[];
    try {
      bakAccounts = bak.listAccounts();
    } catch {
      throw new ImportError("不是有效的 SQLite 备份文件");
    }

    const accounts = bakAccounts.map((account) => ({
      account,
      plan: planImport(store, account, bak!.getRecords(account.accountKey)),
    }));

    const pools = bak.getAllPools().filter((p) => store.getPool(p.poolId) === null);

    const bakAvatars = bak.getAccountAvatars();
    const avatars = [...bakAvatars.entries()]
      .filter(([key, avatar]) => avatar !== "" && store.getAccountAvatar(key) === "")
      .map(([accountKey, avatar]) => ({ accountKey, avatar }));

    const reruns: RestorePlan["reruns"] = [];
    for (const { account } of accounts) {
      for (const type of ["char", "weapon"] as const) {
        const counts = bak.getRerunCounts(account.accountKey, type);
        if (counts.length > 0 && store.getRerunCounts(account.accountKey, type).length === 0) {
          reruns.push({ accountKey: account.accountKey, type, counts });
        }
      }
    }

    return { accounts, pools, avatars, reruns };
  } finally {
    try {
      bak?.close();
    } catch {
      /* ignore */
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

export function applyRestore(
  store: GachaStore,
  dataDir: string,
  plan: RestorePlan,
): { added: number; backup: string } {
  const backup = createBackup(store, dataDir); // 恢复前先做安全备份
  let added = 0;
  for (const { account, plan: p } of plan.accounts) {
    if (!p.accountExists) store.upsertAccount(account);
    added += store.insertRecords(account.accountKey, p.newRecords);
  }
  for (const pool of plan.pools) store.upsertPool(pool);
  for (const r of plan.reruns) store.replaceRerunCounts(r.accountKey, r.type, r.counts);
  for (const a of plan.avatars) store.setAccountAvatar(a.accountKey, a.avatar);
  return { added, backup };
}
