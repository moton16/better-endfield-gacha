import type { GachaRecord } from "../types.js";
import type { BadgeCount, PoolGroup, Tab, TabOverview } from "./types.js";

const round1 = (n: number) => Math.round(n * 10) / 10;

export function overviewFor(tab: Tab, groups: PoolGroup[], tabRecords: GachaRecord[]): TabOverview {
  const gs = groups.filter((g) => g.tab === tab);
  const hits = gs.flatMap((g) => g.hits);
  const total = gs.reduce((s, g) => s + g.total, 0);
  const upHits = hits.filter((h) => h.isUp === true);
  const offBanner = hits.filter((h) => h.isUp === false).length;
  const paidHits = hits.filter((h) => !h.isFree);
  const avgPity6 = paidHits.length ? round1(paidHits.reduce((s, h) => s + h.pity, 0) / paidHits.length) : null;
  return {
    total,
    count6: hits.length,
    offBanner,
    upCount: upHits.length,
    avgPity6,
    avgCostPerUp: avgCostPerUp(gs),
    badges: badges(tabRecords),
    luckCounts: {
      ou: hits.filter((h) => h.luck === "ou").length,
      fei: hits.filter((h) => h.luck === "fei").length,
    },
  };
}

/**
 * 自定义口径（简化版）：有 UP 命中的卡池付费总抽数 / UP 六星总个数。
 * 注意：该口径为本项目自定义指标，不保证与第三方工具完全一致。
 */
function avgCostPerUp(groups: PoolGroup[]): number | null {
  const withUp = groups.filter((g) => g.hits.some((h) => h.isUp === true));
  const ups = withUp.reduce((s, g) => s + g.hits.filter((h) => h.isUp === true).length, 0);
  if (ups === 0) return null;
  return round1(withUp.reduce((s, g) => s + g.paid, 0) / ups);
}

/** 十连批次：同 (poolId, gachaTs, isFree) 且恰 10 条 */
export function badges(records: GachaRecord[]): BadgeCount[] {
  const batches = new Map<string, GachaRecord[]>();
  for (const r of records) {
    if (r.kind !== "draw") continue;
    const k = `${r.poolId}|${r.gachaTs}|${r.isFree ? 1 : 0}`;
    (batches.get(k) ?? batches.set(k, []).get(k)!).push(r);
  }
  let doubleGold = 0;
  let nineBlue = 0;
  for (const b of batches.values()) {
    if (b.length !== 10) continue;
    // 离愁轩救援导入的四星占位条（lcx:*）不参与精确星级徽章（详见 W2）
    if (b.some((x) => x.itemId.startsWith("lcx:"))) continue;
    const r6 = b.filter((x) => x.rarity === 6).length;
    const r5 = b.filter((x) => x.rarity === 5).length;
    const r4 = b.filter((x) => x.rarity === 4).length;
    if (r6 >= 2) doubleGold++;
    if (r4 === 9 && r5 === 1) nineBlue++;
  }
  return (
    [
      { id: "double_gold", label: "十连双金", count: doubleGold },
      { id: "nine_blue_one_purple", label: "九蓝一紫", count: nineBlue },
    ] satisfies BadgeCount[]
  ).filter((b) => b.count > 0);
}
