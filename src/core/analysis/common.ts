import {
  CHAR_BEGINNER,
  CHAR_STANDARD,
  DISPLAY,
} from "./config.js";
import type { Luck, SubHitSummary, Tab, Tone } from "./types.js";

export function tone(pity: number, max: number): Tone {
  if (pity <= DISPLAY.greenMax) return "green";
  if (pity >= Math.ceil(max * DISPLAY.pinkRatio)) return "pink";
  return "yellow";
}

export function luck(pity: number, max: number): Luck {
  if (pity <= DISPLAY.ouHuangMax) return "ou";
  if (pity >= Math.ceil(max * DISPLAY.feiRatio)) return "fei";
  return null;
}

export const isDraw = (r: { kind: string }): boolean => r.kind === "draw";

/** 记录所属 tab：角色按池类型；武器 constant → 常驻，其余 → 武器 */
export function tabOf(r: { type: "char" | "weapon"; poolType: string }): Tab {
  if (r.type === "weapon") return r.poolType === "constant" ? "standard" : "weapon";
  switch (r.poolType) {
    case CHAR_STANDARD:
      return "standard";
    case CHAR_BEGINNER:
      return "beginner";
    default:
      return "limited"; // Special / Rerun / Joint
  }
}

/** 聚合同一 6★ 保底周期内 5★ 陪跑明细 */
export class SubHitTracker {
  private readonly map = new Map<string, SubHitSummary>();

  add(item: { itemId: string; itemName: string }): void {
    const key = item.itemId || item.itemName;
    if (!key) return;
    const prev = this.map.get(key);
    if (prev) {
      prev.count += 1;
      if (!prev.itemName && item.itemName) prev.itemName = item.itemName;
    } else {
      this.map.set(key, {
        itemId: item.itemId,
        itemName: item.itemName,
        count: 1,
      });
    }
  }

  snapshot(): SubHitSummary[] {
    return Array.from(this.map.values(), (x) => ({ ...x }));
  }

  clear(): void {
    this.map.clear();
  }
}
