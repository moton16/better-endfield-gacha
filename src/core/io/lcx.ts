/**
 * 离愁轩（lcx_wiki_json）救援导入解析器。
 *
 * 格式与已知坑点（total 校验、seqId 整数校验、3/4/5 vs 4/5/6 星级量表偏移、
 * 未知武器/未知角色四星占位、“应急手段”→“显锋”旧名映射）参考社区开源实现：
 * MoguJunn（MIT License）的离愁轩救援解析思路。
 */
import { LCX_BUILTIN_ITEMS, LCX_BUILTIN_POOLS } from "../data/lcx-catalog.js";
import { buildAccountKey, type AccountRow, type GachaRecord, type RecordType } from "../types.js";
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

export interface LcxFileMeta {
  uid: string;
  nickName: string;
  server: string;
  serverId: string;
}

/** 只读取离愁轩文件头部身份信息（不校验记录），用于在目标账号未知时建档/匹配。 */
export function readLcxMeta(text: string): LcxFileMeta {
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
  const d = (doc as { data: Record<string, unknown> }).data;
  const uid = String(d.uid).trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(uid)) throw new ImportError("data.uid 格式非法（仅允许字母数字下划线连字符，≤64 位）", "data.uid");
  return {
    uid,
    nickName: String(d.nickName ?? "").trim().slice(0, 64),
    server: String(d.server ?? "").trim().slice(0, 32),
    serverId: String(d.serverId ?? "").trim().slice(0, 8),
  };
}

/**
 * 为离愁轩导入确定目标账号：本地已有 roleId/bindingUid 等于文件 UID 的账号则复用；
 * 否则按文件 UID 新建一个 source=import 的国服账号（空库导入场景）。
 */
export function resolveLcxAccount(
  meta: LcxFileMeta,
  existing: AccountRow[],
  now = Date.now(),
): { account: AccountRow; matched: boolean } {
  const hit = existing.find((a) => a.roleId === meta.uid || a.bindingUid === meta.uid);
  if (hit) return { account: hit, matched: true };
  const bili = /bili/i.test(meta.server);
  const channelMasterId = bili ? "2" : "1";
  const accountKey = buildAccountKey({ region: "cn", channelMasterId, bindingUid: meta.uid, roleId: meta.uid });
  const same = existing.find((a) => a.accountKey === accountKey);
  if (same) return { account: same, matched: true };
  return {
    matched: false,
    account: {
      accountKey,
      region: "cn",
      channelMasterId,
      bindingUid: meta.uid,
      roleId: meta.uid,
      nickname: meta.nickName,
      serverId: meta.serverId || "1",
      serverName: "",
      channelName: bili ? "bilibili服" : "官服",
      source: "import",
      updatedAt: now,
    },
  };
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
      const builtinItems = LCX_BUILTIN_ITEMS[type];
      itemId =
        itemIds && itemIds.size === 1
          ? [...itemIds][0]!
          : Object.hasOwn(builtinItems, itemName)
            ? builtinItems[itemName]!
            : `lcx:${itemName}`;
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
      if (candidates && candidates.size > 1) {
        ambiguousSet.add(poolName);
        continue;
      }
      if (candidates && candidates.size === 1) {
        poolEntry = [...candidates.values()][0]!;
      } else if (Object.hasOwn(LCX_BUILTIN_POOLS, poolName)) {
        poolEntry = LCX_BUILTIN_POOLS[poolName];
      }
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
