import type { GachaRecord, RerunCount } from "../types.js";
import { isDraw, luck, SubHitTracker, tabOf, tone } from "./common.js";
import {
  ARSENAL_QUOTA_BY_RARITY,
  CHAR_BEGINNER,
  CHAR_JOINT,
  CHAR_RERUN,
  CHAR_SPECIAL,
  CHAR_STANDARD,
  RULES,
} from "./config.js";
import type { PoolGroup, SixStarHit } from "./types.js";
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
  const subTracker = new SubHitTracker();
  const carryEntry = new Map<string, number>();
  const carryConsumed = new Map<string, boolean>();
  const freeMaps = new Map<
    string,
    Map<
      string,
      {
        gachaTs: string;
        size: number;
        sixStars: number;
        subTracker: SubHitTracker;
        hits: Array<{ pos: number; hit: SixStarHit }>;
      }
    >
  >();

  for (const r of records.filter(isDraw)) {
    const gkey = spec.groupBy === "poolName" ? r.poolName || r.poolId : r.poolId;
    let g = groups.get(gkey);
    if (!g) {
      if (spec.scope === "perPool") {
        small = 0;
        subTracker.clear();
      }
      carryEntry.set(gkey, spec.scope === "global" ? small : 0);
      carryConsumed.set(gkey, false);
      freeMaps.set(gkey, new Map());

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
        arsenalQuota: 0,
        up6Ids: u.ids,
        upKnown: u.known,
        hits: [],
        pending: 0,
        pendingSubHits5: [],
        smallPityMax: max,
        freeBatches: [],
        isCurrent: false,
        firstTs: r.gachaTs,
        lastTs: r.gachaTs,
      };
      groups.set(gkey, g);
      order.push(gkey);
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
      const fmap = freeMaps.get(gkey)!;
      const ts = r.gachaTs || "0";
      let fb = fmap.get(ts);
      if (!fb) {
        fb = { gachaTs: ts, size: 0, sixStars: 0, subTracker: new SubHitTracker(), hits: [] };
        fmap.set(ts, fb);
      }
      fb.size += 1;

      if (r.rarity === 6) {
        g.count6++;
        fb.sixStars += 1;
        const u = up.up6(r.poolId);
        // 免费十连完全独立：不读付费小保底、不消费跨池已垫抽数、不重置小保底
        const hit: SixStarHit = {
          itemId: r.itemId,
          itemName: r.itemName,
          pity: fb.size,
          isFree: true,
          isNew: r.isNew,
          isUp: u.known ? u.ids.includes(r.itemId) : null,
          gachaTs: r.gachaTs,
          seqId: r.seqId,
          tone: "green",
          luck: null,
        };
        fb.hits.push({ pos: fb.size, hit });
        g.hits.push(hit);
      } else if (r.rarity === 5) {
        g.count5++;
        fb.subTracker.add(r);
      } else if (r.rarity === 4) {
        g.count4++;
      }
    } else {
      g.paid++;
      small++;

      if (r.rarity === 6) {
        g.count6++;
        const u = up.up6(r.poolId);
        const carry = !carryConsumed.get(gkey) ? (carryEntry.get(gkey) ?? 0) : 0;
        carryConsumed.set(gkey, true);
        g.hits.push({
          itemId: r.itemId,
          itemName: r.itemName,
          pity: small,
          isFree: false,
          isNew: r.isNew,
          isUp: u.known ? u.ids.includes(r.itemId) : null,
          gachaTs: r.gachaTs,
          seqId: r.seqId,
          tone: tone(small, max),
          luck: luck(small, max),
          ...(carry > 0 ? { prevPoolDiff: carry } : {}),
          subHits5: subTracker.snapshot(),
        });
        small = 0;
        subTracker.clear();
      } else if (r.rarity === 5) {
        g.count5++;
        subTracker.add(r);
      } else if (r.rarity === 4) {
        g.count4++;
      }
    }
    g.pending = small;
    g.pendingSubHits5 = subTracker.snapshot();
  }

  const out = order.map((k) => {
    const g = groups.get(k)!;
    g.arsenalQuota =
      g.count6 * ARSENAL_QUOTA_BY_RARITY[6] +
      g.count5 * ARSENAL_QUOTA_BY_RARITY[5] +
      g.count4 * ARSENAL_QUOTA_BY_RARITY[4];
    const fmap = freeMaps.get(k);
    if (fmap) {
      const batches = Array.from(fmap.values());
      for (const fb of batches) {
        const batchSub5 = fb.subTracker.snapshot();
        const n = fb.hits.length;
        for (let i = 0; i < n; i++) {
          const entry = fb.hits[i]!;
          const prevPos = i === 0 ? 0 : fb.hits[i - 1]!.pos;
          // 单金占满本批总抽数（通常为 10）；同批多金按正序切片、末颗兜底凑齐 fb.size
          const pity = i === n - 1 ? fb.size - prevPos : entry.pos - prevPos;
          entry.hit.pity = pity;
          entry.hit.tone = tone(pity, max);
          entry.hit.luck = null;
          entry.hit.subHits5 = i === n - 1 ? batchSub5 : [];
        }
      }
      g.freeBatches = batches
        .filter((b) => b.size > 0 && b.sixStars === 0)
        .map((b) => ({ gachaTs: b.gachaTs, size: b.size, sixStars: 0 }))
        .reverse();
    }
    return g;
  });
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
