import type { GachaRecord, RerunCount } from "../types.js";
import { isDraw, luck, tabOf, tone } from "./common.js";
import { RULES } from "./config.js";
import type { PoolGroup } from "./types.js";
import type { UpResolver } from "./up.js";

/**
 * 分析单个武器池（简化版：暂未按 poolVersion 重置小保底）。
 */
export function analyzeWeaponPool(
  poolId: string,
  records: GachaRecord[],
  up: UpResolver,
  rerunCounts: RerunCount[],
): PoolGroup {
  const max = RULES.weaponSmallPity;
  const u = up.up6(poolId);
  const draws = records.filter(isDraw);
  const kind = draws[0]?.poolType ?? records[0]?.poolType ?? "special"; // special|constant|rerun
  const g: PoolGroup = {
    key: `weapon:${poolId}`,
    kind: "weapon",
    tab: tabOf({ type: "weapon", poolType: kind }),
    poolType: kind,
    poolId,
    title: draws[draws.length - 1]?.poolName || records[records.length - 1]?.poolName || poolId,
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
    firstTs: draws[0]?.gachaTs ?? records[0]?.gachaTs ?? "",
    lastTs: draws[draws.length - 1]?.gachaTs ?? records[records.length - 1]?.gachaTs ?? "",
  };

  let small = 0;
  for (const r of draws) {
    g.total++;
    g.paid++;
    small++; // 武器没有免费抽
    if (r.rarity === 6) {
      g.count6++;
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
      });
      small = 0;
    } else if (r.rarity === 5) {
      g.count5++;
    } else if (r.rarity === 4) {
      g.count4++;
    }
  }

  g.pending = small;
  g.hits.reverse();
  const gotUp = g.hits.some((h) => h.isUp === true);
  const off = kind === "rerun" ? rerunCounts.find((c) => c.poolId === poolId)?.totalPullCount : undefined;
  const count = Math.min(off ?? g.total, RULES.weaponBigPity);
  g.bigPity = {
    max: RULES.weaponBigPity,
    count: gotUp ? 0 : count,
    remaining: gotUp ? 0 : RULES.weaponBigPity - count,
    gotUp,
    fromOfficialCount: off !== undefined,
  };
  return g;
}
