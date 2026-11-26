/**
 * 离愁轩（lcx_wiki_json）救援导入解析器。
 *
 * 格式与已知坑点（total 校验、seqId 整数校验、3/4/5 vs 4/5/6 星级量表偏移、
 * 未知武器/未知角色四星占位、“应急手段”→“显锋”旧名映射）参考社区开源实现：
 * MoguJunn（MIT License）的离愁轩救援解析思路。
 */
import type { GachaRecord, RecordType } from "../types.js";
import { ImportError, LIMITS, validateRecord } from "./validate.js";

export interface PoolMapEntry {
  feed: string;
  poolId: string;
  poolType: string;
}

export interface LcxResult {
  records: GachaRecord[];
  unresolvedPools: string[];
  ambiguous: string[];
  warnings: string[];
  meta: { uid: string; server: string; exportTs: number | null };
}

export const RENAMES: Record<string, string> = {
  应急手段: "显锋",
};

const DIGITS = /^\d{1,24}$/;

export function looksLikeLcx(doc: unknown): boolean {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  const d = doc as Record<string, unknown>;
  if (d.code !== 0 || !d.data || typeof d.data !== "object" || Array.isArray(d.data)) return false;
  const data = d.data as Record<string, unknown>;
  return Array.isArray(data.list) && data.uid != null && String(data.uid).trim() !== "";
}

function buildLocalPoolIndex(localRecords: GachaRecord[]): Map<string, Map<string, PoolMapEntry>> {
  const index = new Map<string, Map<string, PoolMapEntry>>();
  for (const r of localRecords) {
    const name = r.poolName.trim();
    if (!name) continue;
    let variants = index.get(name);
    if (!variants) {
      variants = new Map();
      index.set(name, variants);
    }
    const sig = `${r.feed}\0${r.poolId}\0${r.poolType}`;
    if (!variants.has(sig)) {
      variants.set(sig, { feed: r.feed, poolId: r.poolId, poolType: r.poolType });
    }
  }
  return index;
}

function buildLocalItemIndex(localRecords: GachaRecord[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const r of localRecords) {
    const name = r.itemName.trim();
    const id = r.itemId.trim();
    // 忽略先前离愁轩占位/合成 ID，避免破坏官方唯一映射
    if (!name || !id || id.startsWith("lcx:")) continue;
    const key = `${r.type}\0${name}`;
    let ids = index.get(key);
    if (!ids) {
      ids = new Set();
      index.set(key, ids);
    }
    ids.add(id);
  }
  return index;
}

function parseIntRarity(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

export function parseLcx(
  text: string,
  ctx: { localRecords: GachaRecord[]; poolMap: Record<string, PoolMapEntry> },
): LcxResult {
  if (Buffer.byteLength(text, "utf8") > LIMITS.maxFileBytes) throw new ImportError("文件过大");
  const clean = text.startsWith("\uFEFF") ? text.slice(1) : text;
  let doc: unknown;
  try {
    doc = JSON.parse(clean);
  } catch {
    throw new ImportError("不是合法 JSON");
  }
  if (!looksLikeLcx(doc)) {
    throw new ImportError("不是离愁轩导出格式（需要 code=0 且含 data.uid 与 data.list）");
  }

  const data = (doc as { data: Record<string, unknown> }).data;
  const list = data.list as unknown[];
  const declaredTotal = typeof data.total === "number" ? data.total : Number(data.total);
  if (!Number.isFinite(declaredTotal) || declaredTotal !== list.length) {
    throw new ImportError("记录总数 total 与列表长度 list.length 不一致，请重新导出完整文件", "data.total");
  }
  if (list.length > LIMITS.maxRecordsPerAccount) {
    throw new ImportError("记录条数超限", "data.list");
  }

  const warnings: string[] = [];
  let has3 = false;
  let has6 = false;
  for (const raw of list) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rar = parseIntRarity((raw as Record<string, unknown>).rarity);
    if (rar === 3) has3 = true;
    else if (rar === 6) has6 = true;
  }
  const rarityOffset = has3 && !has6 ? 1 : 0;
  if (rarityOffset === 1) {
    warnings.push("检测到星级为 3/4/5 量表（含 rarity=3 且无 rarity=6），已自动整体 +1 转换为 4/5/6★，请在干跑中确认后再 --apply");
  }

  const localPools = buildLocalPoolIndex(ctx.localRecords);
  const localItems = buildLocalItemIndex(ctx.localRecords);
  const unresolvedSet = new Set<string>();
  const ambiguousSet = new Set<string>();
  const records: GachaRecord[] = [];

  let placeholderCount = 0;
  let badSeqCount = 0;
  let otherInvalidCount = 0;

  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      otherInvalidCount++;
      continue;
    }
    const row = raw as Record<string, unknown>;

    const hasWeaponName = typeof row.weaponName === "string" && row.weaponName.trim() !== "";
    const hasCharName = typeof row.charName === "string" && row.charName.trim() !== "";
    const type: RecordType = hasWeaponName ? "weapon" : hasCharName ? "char" : "weaponName" in row ? "weapon" : "char";

    const seqId = row.seqId == null ? "" : String(row.seqId).trim();
    if (!DIGITS.test(seqId)) {
      badSeqCount++;
      continue;
    }

    let gachaTs = row.gachaTs == null ? "" : String(row.gachaTs).trim();
    if (!DIGITS.test(gachaTs)) {
      otherInvalidCount++;
      continue;
    }
    if (gachaTs.length === 10) {
      gachaTs = String(Number(gachaTs) * 1000);
    }

    const rawName = String(type === "weapon" ? row.weaponName ?? "" : row.charName ?? "").trim();
    if (!rawName) {
      otherInvalidCount++;
      continue;
    }

    const isPlaceholder = rawName === "未知武器" || rawName === "未知角色";
    let itemId: string;
    let itemName: string;
    let rarity: number;

    if (isPlaceholder) {
      itemId = "lcx:unknown4";
      itemName = "未知四星（离愁轩）";
      rarity = 4;
    } else {
      const parsedRar = parseIntRarity(row.rarity);
      if (parsedRar === null) {
        otherInvalidCount++;
        continue;
      }
      rarity = parsedRar + rarityOffset;
      itemName = RENAMES[rawName] ?? rawName;
      const itemIds = localItems.get(`${type}\0${itemName}`);
      itemId = itemIds && itemIds.size === 1 ? [...itemIds][0]! : `lcx:${itemName}`;
    }

    const poolName = row.poolName == null ? "" : String(row.poolName).trim();
    if (!poolName) {
      otherInvalidCount++;
      continue;
    }

    let poolEntry: PoolMapEntry | undefined;
    if (Object.hasOwn(ctx.poolMap, poolName)) {
      poolEntry = ctx.poolMap[poolName];
    } else {
      const candidates = localPools.get(poolName);
      if (!candidates || candidates.size === 0) {
        unresolvedSet.add(poolName);
        continue;
      }
      if (candidates.size > 1) {
        ambiguousSet.add(poolName);
        continue;
      }
      poolEntry = [...candidates.values()][0]!;
    }

    if (!poolEntry) {
      unresolvedSet.add(poolName);
      continue;
    }

    try {
      const rec = validateRecord(
        {
          type,
          feed: poolEntry.feed,
          poolType: poolEntry.poolType,
          poolId: poolEntry.poolId,
          poolName,
          itemId,
          itemName,
          itemSubType: type === "weapon" && typeof row.weaponType === "string" ? row.weaponType.trim() : "",
          rarity,
          isFree: row.isFree === true,
          isNew: false,
          gachaTs,
          seqId,
          kind: "draw",
        },
        `data.list[${i}]`,
      );
      records.push(rec);
      if (isPlaceholder) placeholderCount++;
    } catch {
      otherInvalidCount++;
    }
  }

  if (placeholderCount > 0) {
    warnings.push(`含 ${placeholderCount} 条四星占位记录（未知武器/未知角色 → 未知四星（离愁轩）），不参与十连徽章统计`);
  }
  if (badSeqCount > 0) {
    warnings.push(`已拒绝 ${badSeqCount} 条 seqId 非纯数字的记录`);
  }
  if (otherInvalidCount > 0) {
    warnings.push(`已跳过 ${otherInvalidCount} 条字段非法的记录`);
  }
  if (ambiguousSet.size > 0) {
    warnings.push(`有 ${ambiguousSet.size} 个卡池名在本地记录中存在多个映射（歧义），已跳过；请通过 --pool-map 显式指定`);
  }

  const exportTs =
    typeof data.exportTs === "number" && Number.isFinite(data.exportTs)
      ? data.exportTs
      : typeof data.exportTs === "string" && /^\d+$/.test(data.exportTs.trim())
        ? Number(data.exportTs.trim())
        : null;

  return {
    records,
    unresolvedPools: [...unresolvedSet],
    ambiguous: [...ambiguousSet],
    warnings,
    meta: {
      uid: String(data.uid),
      server: String(data.server ?? ""),
      exportTs,
    },
  };
}
