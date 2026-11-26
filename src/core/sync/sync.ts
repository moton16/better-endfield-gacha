/**
 * 全卡池拉取 → 清洗 → 增量去重入库。
 *
 * 关键不变量：
 *  1. 每个 feed 只在“整条 feed 成功拉完”后才入库。若中途失败就把已拉到的新页入库，
 *     下次同步会在“已知 seq_id”处提前停止，永远补不上中间缺口。
 *  2. 非抽卡项（kind != "draw"）照常入库（避免反复拉取），统计层再过滤。
 *  3. 角色池覆盖全部 5 类 pool_type（meta 返回的 ∪ 内置枚举）；武器池先 /weapon/pool 再逐池。
 */
import { EfApiError, type EfClient, type RawPage } from "../api/ef-client.js";
import {
  compareSeqId,
  normalizeCharRecord,
  normalizeWeaponRecord,
  resolveWeaponPoolKind,
} from "../api/normalize.js";
import type { GachaStore } from "../storage/store.js";
import { CHAR_POOL_LABELS, CHAR_POOL_TYPES, type GachaRecord } from "../types.js";

export interface FeedResult {
  feed: string;
  label: string;
  pages: number;
  fetched: number;
  added: number;
  status: "ok" | "skipped" | "error";
  error?: string;
}

export interface SyncReport {
  accountKey: string;
  feeds: FeedResult[];
  warnings: string[];
  totalAdded: number;
  /** 所有 feed 均 ok/skipped */
  ok: boolean;
}

export interface SyncOptions {
  onProgress?: (msg: string) => void;
  /** 单 feed 最大页数，防止服务端异常导致死循环 */
  maxPages?: number;
}

const MAX_PAGES_DEFAULT = 500;

interface FeedFetchOutcome {
  records: GachaRecord[];
  pages: number;
}

/** 通用分页：seq_id 倒序，遇到本地已知 seq 即停。 */
async function paginate(
  client: EfClient,
  fetchPage: (seq?: string) => Promise<RawPage>,
  normalize: (raw: Record<string, unknown>) => GachaRecord,
  knownMaxSeq: string | null,
  maxPages: number,
  onPage?: (pages: number, collected: number) => void,
): Promise<FeedFetchOutcome> {
  const records: GachaRecord[] = [];
  let cursor: string | undefined;
  let pages = 0;
  for (; pages < maxPages; ) {
    const page = await fetchPage(cursor);
    pages++;
    onPage?.(pages, records.length);
    if (page.list.length === 0) break;
    let reachedKnown = false;
    for (const raw of page.list) {
      const rec = normalize(raw);
      if (!rec.seqId) continue;
      if (knownMaxSeq !== null && compareSeqId(rec.seqId, knownMaxSeq) <= 0) {
        reachedKnown = true;
        continue;
      }
      records.push(rec);
    }
    if (reachedKnown || !page.hasMore) break;
    const last = String(page.list[page.list.length - 1]?.seqId ?? "");
    if (!last || last === cursor) break;
    cursor = last;
    await client.pageDelay();
  }
  return { records, pages };
}

export async function syncAccount(
  client: EfClient,
  store: GachaStore,
  accountKey: string,
  opts: SyncOptions = {},
): Promise<SyncReport> {
  const say = opts.onProgress ?? (() => {});
  const maxPages = opts.maxPages ?? MAX_PAGES_DEFAULT;
  const feeds: FeedResult[] = [];
  const warnings: string[] = [];

  const runFeed = async (
    feed: string,
    label: string,
    fetchPage: (seq?: string) => Promise<RawPage>,
    normalize: (raw: Record<string, unknown>) => GachaRecord,
    optional = false,
  ): Promise<void> => {
    say(`拉取 ${label}`);
    try {
      const out = await paginate(client, fetchPage, normalize, store.maxSeqId(accountKey, feed), maxPages, (pg, n) => {
        if (pg % 10 === 0) say(`  ${label}：已拉 ${pg} 页，新增候选 ${n} 条`);
      });
      const added = store.insertRecords(accountKey, out.records);
      feeds.push({ feed, label, pages: out.pages, fetched: out.records.length, added, status: "ok" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      feeds.push({
        feed, label, pages: 0, fetched: 0, added: 0,
        status: optional ? "skipped" : "error",
        error: msg,
      });
    }
  };

  // ---- 角色池 ----
  let metaTypes: string[] = [];
  try {
    metaTypes = await client.charPoolTypes();
  } catch (err) {
    // 带业务 code 的错误（token 失效等）无法继续，直接抛给调用方
    if (err instanceof EfApiError && err.code !== undefined) throw err;
    warnings.push(`char/meta 获取失败，回退到内置 5 类卡池：${err instanceof Error ? err.message : String(err)}`);
  }
  const charTypes = [...new Set([...metaTypes, ...CHAR_POOL_TYPES])];
  for (const pt of charTypes) {
    const offered = metaTypes.length === 0 || metaTypes.includes(pt);
    await runFeed(
      `char:${pt}`,
      CHAR_POOL_LABELS[pt] ?? pt,
      (seq) => client.charPage(pt, seq),
      (raw) => normalizeCharRecord(raw, pt),
      !offered,
    );
    await client.pageDelay();
  }

  // ---- 武器池 ----
  let weaponPools: Awaited<ReturnType<EfClient["weaponPools"]>> = [];
  try {
    weaponPools = await client.weaponPools();
  } catch (err) {
    feeds.push({
      feed: "weapon:*", label: "武器池列表", pages: 0, fetched: 0, added: 0, status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const failedRerun: string[] = [];
  for (const p of weaponPools) {
    const feed = `weapon:${p.poolId}`;
    await runFeed(
      feed,
      p.poolName || p.poolId,
      (seq) => client.weaponPage({ poolId: p.poolId }, seq),
      (raw) => normalizeWeaponRecord(raw, p.poolId),
    );
    const last = feeds[feeds.length - 1]!;
    if (last.status === "error" && resolveWeaponPoolKind(p.poolId, p.poolType) === "rerun") {
      failedRerun.push(p.poolId);
      feeds.pop(); // 回退合并请求再试，成败由下面决定
    }
    await client.pageDelay();
  }
  if (failedRerun.length > 0) {
    // 社区实现对重构申领使用 pool_ids 合并请求；单池请求失败时回退
    say("重构申领：回退为 pool_ids 合并请求");
    try {
      const out = await paginate(
        client,
        (seq) => client.weaponPage({ poolIds: failedRerun }, seq),
        (raw) => normalizeWeaponRecord(raw, String(raw.poolId ?? "")),
        null,
        maxPages,
      );
      const byFeed = new Map<string, GachaRecord[]>();
      for (const r of out.records) {
        (byFeed.get(r.feed) ?? byFeed.set(r.feed, []).get(r.feed)!).push(r);
      }
      for (const id of failedRerun) {
        const feed = `weapon:${id}`;
        const recs = byFeed.get(feed) ?? [];
        feeds.push({
          feed, label: id, pages: out.pages, fetched: recs.length,
          added: store.insertRecords(accountKey, recs), status: "ok",
        });
      }
    } catch (err) {
      for (const id of failedRerun) {
        feeds.push({
          feed: `weapon:${id}`, label: id, pages: 0, fetched: 0, added: 0, status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ---- 累计次数（重构池大保底同源）----
  for (const type of ["char", "weapon"] as const) {
    try {
      store.replaceRerunCounts(accountKey, type, await client.rerunCounts(type));
    } catch (err) {
      warnings.push(`${type} 累计寻访次数获取失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---- 卡池静态信息（UP 判定依据）----
  const poolIds = new Set<string>();
  for (const r of store.getRecords(accountKey)) {
    if (r.poolId && r.kind === "draw" && (r.type === "weapon" || r.poolType !== "E_CharacterGachaPoolType_Standard")) {
      poolIds.add(r.poolId);
    }
  }
  for (const p of weaponPools) poolIds.add(p.poolId);
  for (const id of poolIds) {
    const existing = store.getPool(id);
    if (existing && existing.up6Ids.length > 0) continue;
    const info = await client.poolContent(id);
    if (info) store.upsertPool(info);
  }

  const totalAdded = feeds.reduce((s, f) => s + f.added, 0);
  return { accountKey, feeds, warnings, totalAdded, ok: feeds.every((f) => f.status !== "error") };
}
