import type { GachaRecord, RerunCount } from "../types.js";
import { isDraw, luck, SubHitTracker, tabOf, tone } from "./common.js";
import { RULES } from "./config.js";
import type { PoolGroup, WeaponTenRoll, WeaponTenRollItem } from "./types.js";
import type { UpResolver } from "./up.js";

function aggregateTenRollItems(
  recs: GachaRecord[],
  upInfo: { ids: string[]; known: boolean },
): WeaponTenRollItem[] {
  const map = new Map<string, WeaponTenRollItem>();
  for (const r of recs) {
    const isGift = !isDraw(r);
    if (!isGift && r.rarity < 5) continue;
    const baseKey = r.itemId || r.itemName;
    if (!baseKey) continue;
    const key = `${baseKey}|${r.rarity}|${isGift ? 1 : 0}`;
    const prev = map.get(key);
    if (prev) {
      prev.count += 1;
      prev.isNew = prev.isNew || r.isNew;
      prev.isFree = prev.isFree || r.isFree;
    } else {
      map.set(key, {
        itemId: r.itemId,
        itemName: r.itemName,
        rarity: r.rarity,
        count: 1,
        isUp: !isGift && r.rarity === 6 && upInfo.known ? upInfo.ids.includes(r.itemId) : null,
        isNew: r.isNew,
        isFree: r.isFree,
        isGift,
      });
    }
  }
  const items = Array.from(map.values());
  items.sort((a, b) => {
    if (a.isGift !== b.isGift) return a.isGift ? 1 : -1;
    return b.rarity - a.rarity;
  });
  return items;
}

function buildWeaponTenRolls(
  records: GachaRecord[],
  upInfo: { ids: string[]; known: boolean },
): WeaponTenRoll[] {
  const byTs = new Map<string, GachaRecord[]>();
  for (const r of records) {
    const ts = r.gachaTs || "0";
    const list = byTs.get(ts);
    if (list) list.push(r);
    else byTs.set(ts, [r]);
  }

  const rolls: WeaponTenRoll[] = [];
  let rollCounter = 0;

  for (const [ts, bucket] of byTs) {
    const bucketDraws = bucket.filter(isDraw);
    const bucketGifts = bucket.filter((r) => !isDraw(r));

    if (bucketDraws.length === 0) {
      const items = aggregateTenRollItems(bucketGifts, upInfo);
      if (items.length > 0) {
        rolls.push({ rollIndex: 0, gachaTs: ts, drawCount: 0, items });
      }
      continue;
    }

    if (bucketDraws.length <= 10) {
      rollCounter += 1;
      rolls.push({
        rollIndex: rollCounter,
        gachaTs: ts,
        drawCount: bucketDraws.length,
        items: aggregateTenRollItems([...bucketDraws, ...bucketGifts], upInfo),
      });
      continue;
    }

    // 合成测试或极少数同时间戳多批十连：按每 10 抽切分，赠品挂到末批
    for (let i = 0; i < bucketDraws.length; i += 10) {
      const chunk = bucketDraws.slice(i, i + 10);
      const isLast = i + 10 >= bucketDraws.length;
      rollCounter += 1;
      rolls.push({
        rollIndex: rollCounter,
        gachaTs: ts,
        drawCount: chunk.length,
        items: aggregateTenRollItems(isLast ? [...chunk, ...bucketGifts] : chunk, upInfo),
      });
    }
  }

  return rolls.reverse(); // 新 → 旧
}

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
    pendingSubHits5: [],
    smallPityMax: max,
    freeBatches: [],
    weaponTenRolls: buildWeaponTenRolls(records, u),
    isCurrent: false,
    firstTs: draws[0]?.gachaTs ?? records[0]?.gachaTs ?? "",
    lastTs: draws[draws.length - 1]?.gachaTs ?? records[records.length - 1]?.gachaTs ?? "",
  };

  let small = 0;
  const subTracker = new SubHitTracker();
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
