import { tone } from "../../core/analysis/common.js";
import type { Luck, Tone } from "../../core/analysis/types.js";

/** 柱宽百分比：pity/max，下限 14%（保证放得下“N 抽”文字），上限 100% */
export function barWidth(pity: number, max: number): number {
  if (max <= 0) return 14;
  return Math.min(100, Math.max(14, Math.round((pity / max) * 100)));
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

/** 将秒/毫秒时间戳字符串格式化为本地时间文本（<1e11 视为秒） */
export function fmtTs(raw: string | number): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const ms = n < 1e11 ? n * 1000 : n;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
