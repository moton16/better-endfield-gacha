import { CHAR_JOINT } from "./config.js";
import type { PoolGroup } from "./types.js";

/** 六级欧非称号（按从欧到非排序） */
export const RATING_TIERS = [
  { ratingLabel: "《宇宙级至尊欧皇》", isLucky: true },
  { ratingLabel: "《欧气冲天》", isLucky: true },
  { ratingLabel: "《小有欧气》", isLucky: true },
  { ratingLabel: "《脱欧入非》", isLucky: false },
  { ratingLabel: "《绝世非酋》", isLucky: false },
  { ratingLabel: "《万劫不复大非酋》", isLucky: false },
] as const;

export const RATING_SPECIAL = {
  noDraws: { ratingLabel: "《持玉观望的屯屯鼠》", isLucky: false },
  freeGoldOnly: { ratingLabel: "《白嫖出金》", isLucky: true },
  pendingOnly: { ratingLabel: "《蓄势待发》", isLucky: false },
} as const;

/**
 * 综合口径基准参数（参考游戏实际概率与一次性大保底截断模型）：
 * - 角色池：0.8% 基础 + 66 抽起每抽 +5% 软保底 + 80 抽小保底 + 120 抽大保底 → 平均 ~50 抽/6★；
 *   限定/复刻池单 6★ 综合歪率 ~40%（大保底截断了部分 50% 小保底歪率）。
 * - 武器池：4.0% 基础 + 40 抽小保底 + 80 抽大保底 → 平均 ~19 抽/6★；
 *   限定/复刻武器池单 6★ 综合歪率 ~65%（大保底截断了部分 75% 小保底歪率）。
 */
export const RATING_MODEL = {
  charExpectedPity: 50,
  weaponExpectedPity: 19,
  charOffRate: 0.4,
  weaponOffRate: 0.65,
  indexThresholds: [0.82, 0.92, 1.0, 1.08, 1.16] as const,
  minUpSamplesForZ: 4,
  zShiftThreshold: 1.0,
  minPaidSamplesForExtreme: 5,
} as const;

function isOffBannerEligibleGroup(g: PoolGroup): boolean {
  if (g.tab === "weapon") return true;
  return g.tab === "limited" && g.poolType !== CHAR_JOINT;
}

/**
 * 计算本地趣味欧气称号（纯本地确定性计算，供 Core 与 Web 共用）：
 * 1. 按池类型期望抽数归一化计算加权出货指数 I = Σpity / ΣexpectedPity（越小越欧）；
 * 2. 针对限定/复刻池中已知 UP 归属的付费 6★（≥4 个时），计算歪率标准差偏移 Z，
 *    Z <= -1 升一档、Z >= 1 降一档；
 * 3. 付费 6★ 总数 < 5 时启用小样本保护，极端档位收敛在《欧气冲天》~《绝世非酋》之间。
 */
export function computeRating(
  groups: PoolGroup[],
  totalDraws: number,
  total6: number,
): { ratingLabel: string; isLucky: boolean } {
  let paidCount = 0;
  let actualPitySum = 0;
  let expectedPitySum = 0;

  let knownUpCount = 0;
  let actualOffCount = 0;
  let expectedOffSum = 0;
  let offVarianceSum = 0;

  for (const g of groups) {
    const isWeapon = g.kind === "weapon";
    const expectedPity = isWeapon ? RATING_MODEL.weaponExpectedPity : RATING_MODEL.charExpectedPity;
    const offRate = isWeapon ? RATING_MODEL.weaponOffRate : RATING_MODEL.charOffRate;
    const countOffRate = isOffBannerEligibleGroup(g);

    for (const h of g.hits) {
      if (h.isFree) continue;
      paidCount += 1;
      actualPitySum += h.pity;
      expectedPitySum += expectedPity;

      if (countOffRate && h.isUp !== null) {
        knownUpCount += 1;
        if (h.isUp === false) actualOffCount += 1;
        expectedOffSum += offRate;
        offVarianceSum += offRate * (1 - offRate);
      }
    }
  }

  if (paidCount === 0) {
    if (totalDraws === 0) return { ...RATING_SPECIAL.noDraws };
    if (total6 > 0) return { ...RATING_SPECIAL.freeGoldOnly };
    return { ...RATING_SPECIAL.pendingOnly };
  }

  const index = actualPitySum / expectedPitySum;
  let tier = RATING_MODEL.indexThresholds.findIndex((th) => index <= th);
  if (tier === -1) tier = RATING_TIERS.length - 1;

  if (knownUpCount >= RATING_MODEL.minUpSamplesForZ && offVarianceSum > 0) {
    const z = (actualOffCount - expectedOffSum) / Math.sqrt(offVarianceSum);
    if (z <= -RATING_MODEL.zShiftThreshold) tier -= 1;
    else if (z >= RATING_MODEL.zShiftThreshold) tier += 1;
  }

  const minTier = paidCount < RATING_MODEL.minPaidSamplesForExtreme ? 1 : 0;
  const maxTier =
    paidCount < RATING_MODEL.minPaidSamplesForExtreme
      ? RATING_TIERS.length - 2
      : RATING_TIERS.length - 1;
  const clamped = Math.max(minTier, Math.min(maxTier, tier));
  const picked = RATING_TIERS[clamped]!;
  return { ratingLabel: picked.ratingLabel, isLucky: picked.isLucky };
}
