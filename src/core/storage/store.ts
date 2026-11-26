/**
 * SQLite 持久化（node:sqlite）。官方只保留近 90 天记录，本地永不因同步而删除记录。
 *
 * 去重主键：(account_key, feed, seq_id)；account_key 含渠道+角色维度，官服与 B 服绝不互相覆盖。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AccountRow, GachaRecord, PoolInfo, RecordType, RerunCount } from "../types.js";

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (
  account_key TEXT PRIMARY KEY,
  region TEXT NOT NULL,
  channel_master_id TEXT NOT NULL,
  binding_uid TEXT NOT NULL,
  role_id TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  server_id TEXT NOT NULL DEFAULT '',
  server_name TEXT NOT NULL DEFAULT '',
  channel_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  account_key TEXT NOT NULL,
  feed TEXT NOT NULL,
  seq_id TEXT NOT NULL,
  type TEXT NOT NULL,
  pool_type TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  pool_name TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_sub_type TEXT NOT NULL DEFAULT '',
  rarity INTEGER NOT NULL,
  is_free INTEGER NOT NULL,
  is_new INTEGER NOT NULL,
  gacha_ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (account_key, feed, seq_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_records_acc_type ON records (account_key, type);
CREATE TABLE IF NOT EXISTS pools (
  pool_id TEXT PRIMARY KEY,
  gacha_type TEXT NOT NULL,
  pool_name TEXT NOT NULL,
  pool_type TEXT NOT NULL,
  up6_ids TEXT NOT NULL,
  version_num TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rerun_counts (
  account_key TEXT NOT NULL,
  type TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  pool_name TEXT NOT NULL,
  total_pull_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_key, type, pool_id)
) WITHOUT ROWID;
`;

export interface RecordQuery {
  type?: RecordType;
  feed?: string;
}

export class GachaStore {
  private db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  }

  /** dataDir 下创建 gacha.sqlite；传 ":memory:" 用内存库（测试） */
  static open(dataDir: string): GachaStore {
    if (dataDir === ":memory:") return new GachaStore(new DatabaseSync(":memory:"));
    fs.mkdirSync(dataDir, { recursive: true });
    return new GachaStore(new DatabaseSync(path.join(dataDir, "gacha.sqlite")));
  }

  close(): void {
    this.db.close();
  }

  upsertAccount(a: AccountRow): void {
    this.db
      .prepare(
        `INSERT INTO accounts (account_key, region, channel_master_id, binding_uid, role_id, nickname, server_id, server_name, channel_name, source, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(account_key) DO UPDATE SET
           nickname = CASE WHEN excluded.nickname <> '' THEN excluded.nickname ELSE accounts.nickname END,
           server_id = excluded.server_id, server_name = excluded.server_name,
           channel_name = CASE WHEN excluded.channel_name <> '' THEN excluded.channel_name ELSE accounts.channel_name END,
           source = excluded.source, updated_at = excluded.updated_at`,
      )
      .run(
        a.accountKey, a.region, a.channelMasterId, a.bindingUid, a.roleId, a.nickname,
        a.serverId, a.serverName, a.channelName, a.source, a.updatedAt,
      );
  }

  listAccounts(): AccountRow[] {
    const rows = this.db.prepare("SELECT * FROM accounts ORDER BY updated_at DESC").all() as any[];
    return rows.map((r) => ({
      accountKey: r.account_key,
      region: r.region,
      channelMasterId: r.channel_master_id,
      bindingUid: r.binding_uid,
      roleId: r.role_id,
      nickname: r.nickname,
      serverId: r.server_id,
      serverName: r.server_name,
      channelName: r.channel_name,
      source: r.source,
      updatedAt: r.updated_at,
    }));
  }

  /** 某 feed 已存的最大 seq_id（数值语义：先比长度再比字典序） */
  maxSeqId(accountKey: string, feed: string): string | null {
    const row = this.db
      .prepare("SELECT seq_id FROM records WHERE account_key = ? AND feed = ? ORDER BY length(seq_id) DESC, seq_id DESC LIMIT 1")
      .get(accountKey, feed) as { seq_id: string } | undefined;
    return row?.seq_id ?? null;
  }

  /** 批量插入，已存在（同主键）忽略；返回新增条数 */
  insertRecords(accountKey: string, records: GachaRecord[]): number {
    if (records.length === 0) return 0;
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO records (account_key, feed, seq_id, type, pool_type, pool_id, pool_name, item_id, item_name, item_sub_type, rarity, is_free, is_new, gacha_ts, kind)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    let added = 0;
    this.db.exec("BEGIN");
    try {
      for (const r of records) {
        const res = stmt.run(
          accountKey, r.feed, r.seqId, r.type, r.poolType, r.poolId, r.poolName, r.itemId, r.itemName,
          r.itemSubType, r.rarity, r.isFree ? 1 : 0, r.isNew ? 1 : 0, r.gachaTs, r.kind,
        );
        added += Number(res.changes);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return added;
  }

  /** 按时间正序（旧→新）返回；同时间戳按 seq 数值序 */
  getRecords(accountKey: string, q: RecordQuery = {}): GachaRecord[] {
    const where = ["account_key = ?"];
    const args: string[] = [accountKey];
    if (q.type) { where.push("type = ?"); args.push(q.type); }
    if (q.feed) { where.push("feed = ?"); args.push(q.feed); }
    const rows = this.db
      .prepare(
        `SELECT * FROM records WHERE ${where.join(" AND ")}
         ORDER BY CAST(gacha_ts AS INTEGER) ASC, length(seq_id) ASC, seq_id ASC`,
      )
      .all(...args) as any[];
    return rows.map((r) => ({
      type: r.type,
      feed: r.feed,
      poolType: r.pool_type,
      poolId: r.pool_id,
      poolName: r.pool_name,
      itemId: r.item_id,
      itemName: r.item_name,
      itemSubType: r.item_sub_type,
      rarity: r.rarity,
      isFree: r.is_free === 1,
      isNew: r.is_new === 1,
      gachaTs: r.gacha_ts,
      seqId: r.seq_id,
      kind: r.kind,
    }));
  }

  countRecords(accountKey: string): { total: number; draws: number; byFeed: Record<string, number> } {
    const rows = this.db
      .prepare("SELECT feed, kind, COUNT(*) AS n FROM records WHERE account_key = ? GROUP BY feed, kind")
      .all(accountKey) as Array<{ feed: string; kind: string; n: number }>;
    let total = 0;
    let draws = 0;
    const byFeed: Record<string, number> = {};
    for (const r of rows) {
      total += r.n;
      if (r.kind === "draw") {
        draws += r.n;
        byFeed[r.feed] = (byFeed[r.feed] ?? 0) + r.n;
      }
    }
    return { total, draws, byFeed };
  }

  upsertPool(p: PoolInfo): void {
    this.db
      .prepare(
        `INSERT INTO pools (pool_id, gacha_type, pool_name, pool_type, up6_ids, version_num, updated_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(pool_id) DO UPDATE SET gacha_type=excluded.gacha_type, pool_name=excluded.pool_name,
           pool_type=excluded.pool_type, up6_ids=excluded.up6_ids, version_num=excluded.version_num, updated_at=excluded.updated_at`,
      )
      .run(p.poolId, p.gachaType, p.poolName, p.poolType, JSON.stringify(p.up6Ids), p.versionNum, Date.now());
  }

  getPool(poolId: string): PoolInfo | null {
    const r = this.db.prepare("SELECT * FROM pools WHERE pool_id = ?").get(poolId) as any;
    if (!r) return null;
    return {
      poolId: r.pool_id, gachaType: r.gacha_type, poolName: r.pool_name, poolType: r.pool_type,
      up6Ids: JSON.parse(r.up6_ids), versionNum: r.version_num,
    };
  }

  replaceRerunCounts(accountKey: string, type: RecordType, counts: RerunCount[]): void {
    const del = this.db.prepare("DELETE FROM rerun_counts WHERE account_key = ? AND type = ?");
    const ins = this.db.prepare(
      "INSERT INTO rerun_counts (account_key, type, pool_id, pool_name, total_pull_count, updated_at) VALUES (?,?,?,?,?,?)",
    );
    this.db.exec("BEGIN");
    try {
      del.run(accountKey, type);
      const now = Date.now();
      for (const c of counts) ins.run(accountKey, type, c.poolId, c.poolName, c.totalPullCount, now);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  getRerunCounts(accountKey: string, type: RecordType): RerunCount[] {
    const rows = this.db
      .prepare("SELECT pool_id, pool_name, total_pull_count FROM rerun_counts WHERE account_key = ? AND type = ?")
      .all(accountKey, type) as any[];
    return rows.map((r) => ({ poolId: r.pool_id, poolName: r.pool_name, totalPullCount: r.total_pull_count }));
  }

  // ==== W1 BEGIN
  getAllPools(): PoolInfo[] {
    const rows = this.db.prepare("SELECT * FROM pools").all() as any[];
    return rows.map((r) => ({
      poolId: r.pool_id,
      gachaType: r.gacha_type,
      poolName: r.pool_name,
      poolType: r.pool_type,
      up6Ids: JSON.parse(r.up6_ids),
      versionNum: r.version_num,
    }));
  }
  // ==== W1 END

  // ==== W2 BEGIN
  /** 某账号已有记录的 (feed|seq) → 指纹 映射，用于干跑与冲突检测 */
  getRecordFingerprints(accountKey: string): Map<string, string> {
    const rows = this.db
      .prepare("SELECT feed, seq_id, item_id, rarity, gacha_ts, is_free, kind FROM records WHERE account_key = ?")
      .all(accountKey) as Array<{
        feed: string;
        seq_id: string;
        item_id: string;
        rarity: number;
        gacha_ts: string;
        is_free: number;
        kind: string;
      }>;
    const m = new Map<string, string>();
    for (const r of rows) m.set(`${r.feed}|${r.seq_id}`, `${r.item_id}|${r.rarity}|${r.gacha_ts}|${r.is_free}|${r.kind}`);
    return m;
  }

  /** 一致性备份：VACUUM INTO，目标文件必须不存在 */
  backupTo(file: string): void {
    if (fs.existsSync(file)) {
      throw new Error(`备份目标文件已存在：${file}`);
    }
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }

  getAccount(accountKey: string): AccountRow | null {
    return this.listAccounts().find((a) => a.accountKey === accountKey) ?? null;
  }
  // ==== W2 END

  // ==== W3 BEGIN
  countRecordsFiltered(accountKey: string, q: RecordQuery = {}): number {
    const where = ["account_key = ?"];
    const args: string[] = [accountKey];
    if (q.type) { where.push("type = ?"); args.push(q.type); }
    if (q.feed) { where.push("feed = ?"); args.push(q.feed); }
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM records WHERE ${where.join(" AND ")}`)
      .get(...args) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  getRecordsPaged(
    accountKey: string,
    q: RecordQuery & { limit?: number; offset?: number; order?: "asc" | "desc" } = {},
  ): GachaRecord[] {
    const where = ["account_key = ?"];
    const args: Array<string | number> = [accountKey];
    if (q.type) { where.push("type = ?"); args.push(q.type); }
    if (q.feed) { where.push("feed = ?"); args.push(q.feed); }
    const dir = q.order === "desc" ? "DESC" : "ASC";
    const limit = Math.max(0, Math.trunc(q.limit ?? 200));
    const offset = Math.max(0, Math.trunc(q.offset ?? 0));
    args.push(limit, offset);
    const rows = this.db
      .prepare(
        `SELECT * FROM records WHERE ${where.join(" AND ")}
         ORDER BY CAST(gacha_ts AS INTEGER) ${dir}, length(seq_id) ${dir}, seq_id ${dir}
         LIMIT ? OFFSET ?`,
      )
      .all(...args) as any[];
    return rows.map((r) => ({
      type: r.type,
      feed: r.feed,
      poolType: r.pool_type,
      poolId: r.pool_id,
      poolName: r.pool_name,
      itemId: r.item_id,
      itemName: r.item_name,
      itemSubType: r.item_sub_type,
      rarity: r.rarity,
      isFree: r.is_free === 1,
      isNew: r.is_new === 1,
      gachaTs: r.gacha_ts,
      seqId: r.seq_id,
      kind: r.kind,
    }));
  }
  // ==== W3 END
}
