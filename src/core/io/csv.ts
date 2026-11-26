import type { GachaRecord } from "../types.js";

const COLS = [
  "gachaTime",
  "type",
  "poolName",
  "poolType",
  "itemName",
  "itemId",
  "rarity",
  "isFree",
  "isNew",
  "seqId",
  "kind",
  "feed",
] as const;

/** 防公式注入：以 = + - @ 制表/回车开头的单元格前缀单引号 */
function cell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(records: GachaRecord[], opts: { includeGifts?: boolean } = {}): string {
  const rows = records.filter((r) => opts.includeGifts || r.kind === "draw");
  const lines: string[] = [COLS.join(",")];
  for (const r of rows) {
    const ts = r.gachaTs !== "" ? Number(r.gachaTs) : Number.NaN;
    let gachaTime = r.gachaTs;
    if (Number.isFinite(ts)) {
      const d = new Date(ts < 1e11 ? ts * 1000 : ts);
      if (!Number.isNaN(d.getTime())) gachaTime = d.toISOString();
    }
    lines.push(
      [
        gachaTime,
        r.type,
        r.poolName,
        r.poolType,
        r.itemName,
        r.itemId,
        r.rarity,
        r.isFree,
        r.isNew,
        r.seqId,
        r.kind,
        r.feed,
      ]
        .map(cell)
        .join(","),
    );
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n"; // BOM：Excel 正确识别 UTF-8
}
