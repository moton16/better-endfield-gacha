/**
 * 分析引擎对外契约类型（零 Node 依赖，供 Core / Server / Web UI 共用）。
 */

export type Tab = "limited" | "weapon" | "standard" | "beginner";
export type Tone = "green" | "yellow" | "pink";
export type Luck = "ou" | "fei" | null; // 超欧 / 超非

export interface SubHitSummary {
  itemId: string;
  itemName: string;
  count: number;
}

export interface SixStarHit {
  itemId: string;
  itemName: string;
  /** 距上一个付费 6★ 的付费抽数（含本抽）；免费抽出的 6★ 取当时计数、不重置 */
  pity: number;
  isFree: boolean;
  isNew: boolean;
  /** true=UP；false=歪；null=UP 信息缺失 */
  isUp: boolean | null;
  gachaTs: string;
  seqId: string;
  tone: Tone;
  luck: Luck;
  /** 从上一个同规则跨池共享卡池带入本池的已垫付费抽数（仅首轮出 6★ 时标注） */
  prevPoolDiff?: number;
  /** 本次 6★ 保底周期内抽出的 5★ 聚合明细 */
  subHits5?: SubHitSummary[];
}

export interface BigPity {
  max: number;
  count: number; // 已用（付费抽，封顶 max）
  remaining: number; // gotUp 时为 0
  gotUp: boolean;
  /** rerun 池取官方累计次数时为 true */
  fromOfficialCount: boolean;
}

export interface FreeBatch {
  gachaTs: string;
  size: number;
  sixStars: number;
}

export interface WeaponTenRollItem {
  itemId: string;
  itemName: string;
  rarity: number;
  count: number;
  isUp: boolean | null;
  isNew: boolean;
  isFree: boolean;
  isGift: boolean;
}

export interface WeaponTenRoll {
  /** 第 N 个十连（正序 1..K；仅含非抽卡赠品的批次为 0） */
  rollIndex: number;
  gachaTs: string;
  drawCount: number;
  items: WeaponTenRollItem[];
}

export interface PoolGroup {
  key: string; // 稳定 id，前端 v-key
  kind: "char" | "weapon";
  tab: Tab;
  poolType: string; // 角色=官方枚举；武器=special|constant|rerun
  poolId: string;
  title: string; // 池名
  total: number; // draw 总数（含免费）
  paid: number;
  free: number;
  count6: number;
  count5: number;
  count4: number;
  up6Ids: string[];
  upKnown: boolean;
  hits: SixStarHit[]; // 新 → 旧
  pending: number; // “垫”
  /** 当前已垫期间（最近一个 6★ 之后）抽出的 5★ 聚合明细 */
  pendingSubHits5?: SubHitSummary[];
  smallPityMax: number; // 柱宽分母（80/40）
  bigPity?: BigPity;
  freeBatches: FreeBatch[]; // 无 6★ 的免费批次，新 → 旧（第二阶段填充）
  /** 武器池十连聚合条（新 → 旧，仅武器池填充） */
  weaponTenRolls?: WeaponTenRoll[];
  isCurrent: boolean; // 该 feed 里最后（最新）的池
  firstTs: string;
  lastTs: string;
}

export interface BadgeCount {
  id: "double_gold" | "nine_blue_one_purple";
  label: string;
  count: number;
}

export interface TabOverview {
  total: number;
  count6: number;
  /** 歪的个数（isUp===false） */
  offBanner: number;
  upCount: number;
  avgPity6: number | null;
  /** 本项目自定义口径：有 UP 命中的池付费总抽数 / UP 个数 */
  avgCostPerUp: number | null;
  badges: BadgeCount[];
  luckCounts: { ou: number; fei: number };
}

export interface AccountGlobalSummary {
  totalDraws: number;
  totalFree: number;
  totalNonDraw: number;
  total6: number;
  firstRecordTs: string | null;
  globalBadges: BadgeCount[];
  globalLuckCounts: { ou: number; fei: number };
  avgPity6: number | null;
  ratingLabel: string;
  isLucky: boolean;
}

export interface AccountAnalysis {
  accountKey: string;
  generatedAt: number;
  overview: Record<Tab, TabOverview>;
  global?: AccountGlobalSummary;
  groups: PoolGroup[]; // 已按 lastTs “新 → 旧”排序；前端按 group.tab 过滤
  notes: string[]; // 例如“某池 UP 信息缺失，未判定歪”
}
