import type { GachaRecord, PoolInfo, RerunCount } from "../types.js";
import { analyzeCharFeed } from "./char.js";
import { isDraw, tabOf } from "./common.js";
import { CHAR_BEGINNER, CHAR_STANDARD } from "./config.js";
import { overviewFor } from "./summary.js";
import type { AccountAnalysis, PoolGroup, Tab } from "./types.js";
import { makeUpResolver } from "./up.js";
import { analyzeWeaponPool } from "./weapon.js";

export * from "./config.js";
export * from "./types.js";
export { luck, tabOf, tone } from "./common.js";
export { badges, overviewFor } from "./summary.js";
export { makeUpResolver, type UpResolver } from "./up.js";

export interface AnalyzeInput {
  accountKey: string;
  /** 时间正序（旧 → 新） */
  records: GachaRecord[];
  pools: PoolInfo[];
  rerunChar: RerunCount[];
  rerunWeapon: RerunCount[];
  /** 可选时间戳注入，便于测试纯函数幂等性 */
  now?: number;
}

const NO_UP_POOL_TYPES = new Set<string>([CHAR_STANDARD, CHAR_BEGINNER, "constant"]);

export function analyzeAccount(i: AnalyzeInput): AccountAnalysis {
  const up = makeUpResolver(new Map(i.pools.map((p) => [p.poolId, p])));
  const notes: string[] = [];
  const groups: PoolGroup[] = [];

  const byFeed = new Map<string, GachaRecord[]>();
  for (const r of i.records) {
    (byFeed.get(r.feed) ?? byFeed.set(r.feed, []).get(r.feed)!).push(r);
  }

  for (const [feed, recs] of byFeed) {
    if (feed.startsWith("char:")) {
      groups.push(...analyzeCharFeed(feed.slice(5), recs, up, i.rerunChar));
    } else if (feed.startsWith("weapon:")) {
      if (recs.some(isDraw)) {
        groups.push(analyzeWeaponPool(feed.slice(7), recs, up, i.rerunWeapon));
      }
    }
  }

  for (const g of groups) {
    if (!g.upKnown && g.count6 > 0 && !NO_UP_POOL_TYPES.has(g.poolType)) {
      notes.push(`池「${g.title}」缺少 UP 信息，未判定歪（可补 src/core/data/up-map.json）`);
    }
  }

  // tab 内排序：按 lastTs 新 → 旧
  groups.sort((a, b) => Number(b.lastTs) - Number(a.lastTs));

  const tabs: Tab[] = ["limited", "weapon", "standard", "beginner"];
  const overview = Object.fromEntries(
    tabs.map((t) => [t, overviewFor(t, groups, i.records.filter((r) => tabOf(r) === t))]),
  ) as AccountAnalysis["overview"];

  return {
    accountKey: i.accountKey,
    generatedAt: i.now ?? Date.now(),
    overview,
    groups,
    notes,
  };
}
