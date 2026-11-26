import type { GachaRecord } from "../types.js";
import { isDraw } from "./common.js";
import type {
  AccountGlobalSummary,
  BadgeCount,
  PoolGroup,
  Tab,
  TabOverview,
} from "./types.js";

const round1 = (n: number) => Math.round(n * 10) / 10;
const TABS: readonly Tab[] = ["limited", "weapon", "standard", "beginner"];

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

function findFirstRecordTs(records: GachaRecord[]): string | null {
  let minMs = Infinity;
  let minRaw: string | null = null;
  for (const r of records) {
    const n = Number(r.gachaTs);
    if (!Number.isFinite(n) || n <= 0) continue;
    const ms = n < 1e11 ? n * 1000 : n;
    if (ms < minMs) {
      minMs = ms;
      minRaw = r.gachaTs;
    }
  }
  return minRaw;
}

/** 按小保底归一化水位比例计算本地趣味欧气称号（纯本地确定性计算） */
export function computeRating(
  groups: PoolGroup[],
  totalDraws: number,
  total6: number,
): { ratingLabel: string; isLucky: boolean } {
  let ratioSum = 0;
  let paidCount = 0;
  for (const g of groups) {
    const denom = g.smallPityMax || 80;
    for (const h of g.hits) {
      if (h.isFree) continue;
      ratioSum += h.pity / denom;
      paidCount += 1;
    }
  }
  if (paidCount === 0) {
    if (totalDraws === 0) return { ratingLabel: "《持玉观望的屯屯鼠》", isLucky: false };
    if (total6 > 0) return { ratingLabel: "《白嫖出金》", isLucky: true };
    return { ratingLabel: "《蓄势待发》", isLucky: false };
  }
  const avgRatio = ratioSum / paidCount;
  if (avgRatio <= 0.4) return { ratingLabel: "《宇宙无敌大欧皇》", isLucky: true };
  if (avgRatio <= 0.55) return { ratingLabel: "《天选大欧皇》", isLucky: true };
  if (avgRatio <= 0.68) return { ratingLabel: "《小有欧气》", isLucky: true };
  if (avgRatio <= 0.78) return { ratingLabel: "《中规中矩》", isLucky: false };
  if (avgRatio <= 0.88) return { ratingLabel: "《略显非酋》", isLucky: false };
  return { ratingLabel: "《终末地大非酋》", isLucky: false };
}

export function globalSummaryFor(
  records: GachaRecord[],
  groups: PoolGroup[],
  overview: Record<Tab, TabOverview>,
): AccountGlobalSummary {
  const drawRecords = records.filter(isDraw);
  const totalDraws = drawRecords.length;
  const totalFree = drawRecords.filter((r) => r.isFree).length;
  const totalNonDraw = records.length - totalDraws;
  const total6 = TABS.reduce((s, t) => s + overview[t].count6, 0);
  const globalLuckCounts = {
    ou: TABS.reduce((s, t) => s + overview[t].luckCounts.ou, 0),
    fei: TABS.reduce((s, t) => s + overview[t].luckCounts.fei, 0),
  };
  const paidHits = groups.flatMap((g) => g.hits.filter((h) => !h.isFree));
  const avgPity6 = paidHits.length
    ? round1(paidHits.reduce((s, h) => s + h.pity, 0) / paidHits.length)
    : null;
  const { ratingLabel, isLucky } = computeRating(groups, totalDraws, total6);

  return {
    totalDraws,
    totalFree,
    totalNonDraw,
    total6,
    firstRecordTs: findFirstRecordTs(records),
    globalBadges: badges(drawRecords),
    globalLuckCounts,
    avgPity6,
    ratingLabel,
    isLucky,
  };
}
