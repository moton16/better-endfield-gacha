import {
  CHAR_BEGINNER,
  CHAR_STANDARD,
  DISPLAY,
} from "./config.js";
import type { Luck, Tab, Tone } from "./types.js";

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
