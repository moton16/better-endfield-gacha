import { tone } from "../../core/analysis/common.js";
import type {
  AccountAnalysis,
  AccountGlobalSummary,
  BadgeCount,
  Luck,
  Tab,
  Tone,
} from "../../core/analysis/types.js";

/**
 * 柱宽百分比：按视觉 70 抽封顶缩放（角色 70 抽铺满，武器池保底 40 保持按 40），
 * 下限 14%（保证放得下“N 抽”文字），上限 100%。
 */
export function barWidth(pity: number, max: number): number {
  if (max <= 0) return 14;
  const denom = Math.min(max, 70);
  return Math.min(100, Math.max(14, Math.round((pity / denom) * 100)));
}

export const TONE_VAR: Record<Tone, string> = {
  green: "var(--bar-green)",
  yellow: "var(--bar-yellow)",
  pink: "var(--bar-pink)",
};

export const LUCK_LABEL: Record<Exclude<Luck, null>, string> = {
  ou: "超欧",
  fei: "超非",
};

export function pendingTone(pending: number, max: number): Tone {
  return tone(pending, max);
}

/** 隐私遮罩：show 为 false 时统一返回 *** */
export function maskName(name: string, show: boolean): string {
  return show ? name || "—" : "***";
}

function toMs(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e11 ? n * 1000 : n;
  return Number.isNaN(new Date(ms).getTime()) ? null : ms;
}

/** 将秒/毫秒时间戳字符串格式化为本地时间文本（<1e11 视为秒） */
export function fmtTs(raw: string | number): string {
  const ms = toMs(raw);
  if (ms === null) return "—";
  const d = new Date(ms);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 短月日格式 MM-DD，供“展示五星”行展示 */
export function fmtMonthDay(raw: string | number): string {
  const ms = toMs(raw);
  if (ms === null) return "—";
  const d = new Date(ms);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 卡池时间范围短格式（MM.DD~MM.DD 或跨年含年份） */
export function fmtShortDateRange(firstTs: string, lastTs: string): string {
  const aMs = toMs(firstTs);
  const bMs = toMs(lastTs);
  if (aMs === null || bMs === null) return "";
  const a = new Date(aMs);
  const b = new Date(bMs);
  const pad = (v: number) => String(v).padStart(2, "0");
  if (a.getFullYear() === b.getFullYear()) {
    return `${pad(a.getMonth() + 1)}.${pad(a.getDate())}~${pad(b.getMonth() + 1)}.${pad(b.getDate())}`;
  }
  return `${a.getFullYear()}.${pad(a.getMonth() + 1)}.${pad(a.getDate())}~${b.getFullYear()}.${pad(b.getMonth() + 1)}.${pad(b.getDate())}`;
}

/** 邮戳日期格式：YYYY年M月D日 */
export function fmtStatStartDate(raw: string | null | undefined): string {
  const ms = toMs(raw);
  if (ms === null) return "暂无记录";
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fmtRelativeTime(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

const ALL_TABS: readonly Tab[] = ["limited", "weapon", "standard", "beginner"];

/** 兼容缺少 analysis.global 的旧响应/测试夹具 */
export function deriveGlobalSummary(analysis: AccountAnalysis): AccountGlobalSummary {
  if (analysis.global) return analysis.global;

  let totalDraws = 0;
  let totalFree = 0;
  let total6 = 0;
  let ou = 0;
  let fei = 0;
  const badgeMap = new Map<BadgeCount["id"], BadgeCount>();

  for (const t of ALL_TABS) {
    const ov = analysis.overview[t];
    totalDraws += ov.total;
    total6 += ov.count6;
    ou += ov.luckCounts.ou;
    fei += ov.luckCounts.fei;
    for (const b of ov.badges) {
      const prev = badgeMap.get(b.id);
      if (prev) prev.count += b.count;
      else badgeMap.set(b.id, { ...b });
    }
  }

  let ratioSum = 0;
  let paidPitySum = 0;
  let paidCount = 0;
  let minMs = Infinity;
  let firstRecordTs: string | null = null;

  for (const g of analysis.groups) {
    totalFree += g.free;
    const fms = toMs(g.firstTs);
    if (fms !== null && fms < minMs) {
      minMs = fms;
      firstRecordTs = g.firstTs;
    }
    const denom = g.smallPityMax || 80;
    for (const h of g.hits) {
      if (h.isFree) continue;
      ratioSum += h.pity / denom;
      paidPitySum += h.pity;
      paidCount += 1;
    }
  }

  let ratingLabel = "蓄势待发";
  let isLucky = false;
  if (paidCount === 0) {
    if (totalDraws === 0) ratingLabel = "暂未寻访";
    else if (total6 > 0) {
      ratingLabel = "白嫖出金";
      isLucky = true;
    }
  } else {
    const r = ratioSum / paidCount;
    if (r <= 0.4) {
      ratingLabel = "宇宙无敌大欧皇";
      isLucky = true;
    } else if (r <= 0.55) {
      ratingLabel = "天选大欧皇";
      isLucky = true;
    } else if (r <= 0.68) {
      ratingLabel = "小有欧气";
      isLucky = true;
    } else if (r <= 0.78) {
      ratingLabel = "中规中矩";
    } else if (r <= 0.88) {
      ratingLabel = "略显非酋";
    } else {
      ratingLabel = "终末地大非酋";
    }
  }

  return {
    totalDraws,
    totalFree,
    totalNonDraw: 0,
    total6,
    firstRecordTs,
    globalBadges: Array.from(badgeMap.values()),
    globalLuckCounts: { ou, fei },
    avgPity6: paidCount > 0 ? Math.round((paidPitySum / paidCount) * 10) / 10 : null,
    ratingLabel,
    isLucky,
  };
}
