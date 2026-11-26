import type { GachaRecord, RerunCount } from "../types.js";
import { isDraw, luck, tabOf, tone } from "./common.js";
import {
  CHAR_BEGINNER,
  CHAR_JOINT,
  CHAR_RERUN,
  CHAR_SPECIAL,
  CHAR_STANDARD,
  RULES,
} from "./config.js";
import type { PoolGroup } from "./types.js";
import type { UpResolver } from "./up.js";

type Scope = "global" | "perPool"; // 小保底计数器作用域

interface Spec {
  scope: Scope;
  groupBy: "poolId" | "poolName"; // rerun 按池名跨版本归并
  bigPity: "perPoolPaid" | "rerunOfficial" | "none";
}

const SPECS: Record<string, Spec> = {
  [CHAR_SPECIAL]: { scope: "global", groupBy: "poolId", bigPity: "perPoolPaid" },
  [CHAR_RERUN]: { scope: "global", groupBy: "poolName", bigPity: "rerunOfficial" },
  [CHAR_JOINT]: { scope: "perPool", groupBy: "poolId", bigPity: "none" },
  [CHAR_STANDARD]: { scope: "global", groupBy: "poolId", bigPity: "none" },
  [CHAR_BEGINNER]: { scope: "global", groupBy: "poolId", bigPity: "none" },
};

/**
 * 分析单个角色卡池 feed（输入 records 须按时间旧 → 新排序）。
 */
export function analyzeCharFeed(
  poolType: string,
  records: GachaRecord[],
  up: UpResolver,
  rerunCounts: RerunCount[],
): PoolGroup[] {
  const spec = SPECS[poolType];
  if (!spec) return [];

  const max = RULES.charSmallPity;
  const tab = tabOf({ type: "char", poolType });
  const groups = new Map<string, PoolGroup>();
  const order: string[] = [];
  let small = 0;

  for (const r of records.filter(isDraw)) {
    const gkey = spec.groupBy === "poolName" ? r.poolName || r.poolId : r.poolId;
    let g = groups.get(gkey);
    if (!g) {
      const u = up.up6(r.poolId);
      g = {
        key: `char:${poolType}:${gkey}`,
        kind: "char",
        tab,
        poolType,
        poolId: r.poolId,
        title: r.poolName || r.poolId,
        total: 0,
        paid: 0,
        free: 0,
        count6: 0,
        count5: 0,
        count4: 0,
        up6Ids: u.ids,
        upKnown: u.known,
        hits: [],
        pending: 0,
        smallPityMax: max,
        freeBatches: [],
        isCurrent: false,
        firstTs: r.gachaTs,
        lastTs: r.gachaTs,
      };
      groups.set(gkey, g);
      order.push(gkey);
      if (spec.scope === "perPool") small = 0;
    }

    // rerun 跨版本时取最新版本的 poolId 与 UP 信息
    if (g.poolId !== r.poolId) {
      g.poolId = r.poolId;
      const latestUp = up.up6(r.poolId);
      if (latestUp.known || !g.upKnown) {
        g.up6Ids = latestUp.ids;
        g.upKnown = latestUp.known;
      }
    }
    if (r.poolName && g.title === g.poolId) g.title = r.poolName;

    g.lastTs = r.gachaTs;
    g.total++;
    if (r.isFree) {
      g.free++;
    } else {
      g.paid++;
      small++;
    }

    if (r.rarity === 6) {
      g.count6++;
      const u = up.up6(r.poolId);
      g.hits.push({
        itemId: r.itemId,
        itemName: r.itemName,
        pity: small,
        isFree: r.isFree,
        isNew: r.isNew,
        isUp: u.known ? u.ids.includes(r.itemId) : null,
        gachaTs: r.gachaTs,
        seqId: r.seqId,
        tone: tone(small, max),
        luck: r.isFree ? null : luck(small, max),
      });
      if (!r.isFree) small = 0;
    } else if (r.rarity === 5) {
      g.count5++;
    } else if (r.rarity === 4) {
      g.count4++;
    }
    g.pending = small;
  }

  const out = order.map((k) => groups.get(k)!);
  for (const g of out) {
    g.hits.reverse(); // 新 → 旧
    const gotUp = g.hits.some((h) => h.isUp === true);
    if (spec.bigPity === "perPoolPaid") {
      g.bigPity = {
        max: RULES.charBigPity,
        count: Math.min(g.paid, RULES.charBigPity),
        remaining: gotUp ? 0 : Math.max(0, RULES.charBigPity - g.paid),
        gotUp,
        fromOfficialCount: false,
      };
    } else if (spec.bigPity === "rerunOfficial") {
      const off =
        rerunCounts.find((c) => c.poolId === g.poolId)?.totalPullCount ??
        rerunCounts.find((c) => c.poolName !== "" && c.poolName === g.title)?.totalPullCount;
      const count = Math.min(off ?? g.paid, RULES.charBigPity);
      g.bigPity = {
        max: RULES.charBigPity,
        count: gotUp ? 0 : count,
        remaining: gotUp ? 0 : RULES.charBigPity - count,
        gotUp,
        fromOfficialCount: off !== undefined,
      };
    }
  }
  if (out.length > 0) out[out.length - 1]!.isCurrent = true;
  return out.reverse(); // 新 → 旧
}
