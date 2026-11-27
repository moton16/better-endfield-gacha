/**
 * 分析引擎规则与展示常量。
 *
 * 注意：
 * - 抽卡保底/共享规则参考社区实现 `bhaoo/endfield-gacha`（MIT，app/utils/gachaCalc.ts），非官方文档，可能随版本变化。
 * - 展示阈值（绿/黄/粉区间及超欧/超非标签）由实机截图反推，可在此集中调整。
 * - TODO: 重构寻访/申领按 `poolVersion` 重置小保底暂未实现（当前 GachaRecord 未持久化 poolVersion；后续需 normalize.ts + store.ts schema v2 迁移）。
 */

/** 保底规则常量（社区口径，非官方） */
export const RULES = {
  charSmallPity: 80,
  charBigPity: 120,
  weaponSmallPity: 40,
  weaponBigPity: 80,
} as const;

/** 角色池单抽产出武库配额（按出货稀有度累计，含免费十连） */
export const ARSENAL_QUOTA_BY_RARITY = {
  6: 2000,
  5: 200,
  4: 20,
} as const;

/** 展示阈值（从 UI 截图推断，供核心层与前端共用，勿在 UI 硬编码） */
export const DISPLAY = {
  greenMax: 15,
  pinkRatio: 0.8,
  ouHuangMax: 10,
  feiRatio: 0.925,
} as const;

export const CHAR_STANDARD = "E_CharacterGachaPoolType_Standard";
export const CHAR_SPECIAL = "E_CharacterGachaPoolType_Special";
export const CHAR_RERUN = "E_CharacterGachaPoolType_Rerun";
export const CHAR_JOINT = "E_CharacterGachaPoolType_Joint";
export const CHAR_BEGINNER = "E_CharacterGachaPoolType_Beginner";
