import { CHAR_POOL_TYPES, type GachaRecord, type PoolInfo, type RerunCount, type WeaponPoolKind } from "../types.js";

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** kind 缺失按 draw；其它任何非 "draw" 值（gift_* 等）都不是抽卡。 */
export function normalizeKind(v: unknown): string {
  const k = str(v);
  return k === "" ? "draw" : k;
}

export function resolveWeaponPoolKind(poolId: string, poolType?: string): WeaponPoolKind {
  const t = str(poolType).toLowerCase();
  if (t === "rerun" || t === "constant" || t === "special") return t;
  const id = poolId.toLowerCase();
  if (id.includes("constant")) return "constant";
  if (id.startsWith("rerun") || id.includes("rerun_")) return "rerun";
  return "special";
}

export function normalizeCharRecord(raw: Record<string, unknown>, poolType: string): GachaRecord {
  const poolId = str(raw.poolId);
  return {
    type: "char",
    feed: `char:${poolType}`,
    poolType,
    poolId,
    poolName: str(raw.poolName),
    itemId: str(raw.charId),
    itemName: str(raw.charName),
    itemSubType: "",
    rarity: num(raw.rarity),
    isFree: raw.isFree === true,
    isNew: raw.isNew === true,
    gachaTs: str(raw.gachaTs),
    seqId: str(raw.seqId),
    kind: normalizeKind(raw.kind),
  };
}

export function normalizeWeaponRecord(raw: Record<string, unknown>, feedPoolId: string): GachaRecord {
  const poolId = str(raw.poolId) || feedPoolId;
  return {
    type: "weapon",
    feed: `weapon:${feedPoolId}`,
    poolType: resolveWeaponPoolKind(poolId, str(raw.poolType)),
    poolId,
    poolName: str(raw.poolName),
    itemId: str(raw.weaponId),
    itemName: str(raw.weaponName),
    itemSubType: str(raw.weaponType),
    rarity: num(raw.rarity),
    isFree: raw.isFree === true,
    isNew: raw.isNew === true,
    gachaTs: str(raw.gachaTs),
    seqId: str(raw.seqId),
    kind: normalizeKind(raw.kind),
  };
}

export function normalizeRerunCounts(data: unknown): RerunCount[] {
  if (!Array.isArray(data)) return [];
  const out: RerunCount[] = [];
  for (const it of data) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const poolId = str(r.poolId);
    if (!poolId) continue;
    out.push({ poolId, poolName: str(r.poolName), totalPullCount: Math.max(0, Math.floor(num(r.totalPullCount))) });
  }
  return out;
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/** /api/content 的 data.pool → PoolInfo（UP 六星解析口径参考社区实现，字段缺失时回退到内置映射表） */
export function normalizePoolContent(poolId: string, data: unknown): PoolInfo | null {
  const pool = (data as { pool?: Record<string, unknown> } | null)?.pool;
  if (!pool || typeof pool !== "object") return null;
  const all = Array.isArray(pool.all) ? (pool.all as Array<Record<string, unknown>>) : [];
  const findIds = (names: string[]) =>
    uniq(
      names.map((n) => {
        if (!n) return "";
        const hit =
          all.find((x) => str(x?.name) === n && num(x?.rarity) === 6) ?? all.find((x) => str(x?.name) === n);
        return hit ? str(hit.id) : "";
      }),
    );
  const gachaType = str(pool.pool_gacha_type);
  let up6: string[] = [];
  if (str(pool.pool_type) === "extra" && Array.isArray(pool.rotate_reward_item_list)) {
    const names = (pool.rotate_reward_item_list as unknown[]).map((n) => str(n).replace(/的信物$/, ""));
    up6 = findIds(names);
  }
  if (up6.length === 0) {
    const n = str(pool.up6_name);
    up6 = findIds(n ? [n] : []);
  }
  return {
    poolId,
    gachaType,
    poolName: str(pool.pool_name),
    poolType: gachaType === "weapon" ? resolveWeaponPoolKind(poolId) : str(pool.pool_type),
    up6Ids: up6,
    versionNum: str(pool.version_num),
  };
}

/** 官方 seq_id 多为纯数字串：按长度+字典序比较，避免 Number 精度丢失 */
export function compareSeqId(a: string, b: string): number {
  if (a === b) return 0;
  const ad = /^\d+$/.test(a);
  const bd = /^\d+$/.test(b);
  if (ad && bd) {
    if (a.length !== b.length) return a.length > b.length ? 1 : -1;
    return a < b ? -1 : 1;
  }
  if (ad !== bd) return ad ? 1 : -1;
  return a < b ? -1 : 1;
}

export { CHAR_POOL_TYPES };
