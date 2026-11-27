import fs from "node:fs";
import path from "node:path";
import upMap from "../data/up-map.json" with { type: "json" };
import type { PoolInfo } from "../types.js";

export interface UpResolver {
  up6(poolId: string): { ids: string[]; known: boolean };
}

export interface UpResolverOptions {
  dataDir?: string;
  override?: Record<string, { up6Ids?: unknown }>;
}

const OVERRIDE_FILE = "up-map.override.json";

function sanitizeOverrideMap(raw: unknown): Record<string, { up6Ids?: string[] }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, { up6Ids?: string[] }> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rawIds = (entry as { up6Ids?: unknown }).up6Ids;
    if (!Array.isArray(rawIds)) continue;
    const up6Ids = rawIds
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    Object.defineProperty(out, key, {
      value: { up6Ids },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return out;
}

/**
 * 读取数据目录下的可选本地覆盖文件 `<dataDir>/up-map.override.json`。
 * 缺失、`:memory:`、格式损坏或非对象时静默返回 `{}`。
 */
export function loadUpMapOverride(dataDir?: string): Record<string, { up6Ids?: string[] }> {
  if (!dataDir || dataDir === ":memory:") return {};
  const filePath = path.join(dataDir, OVERRIDE_FILE);
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return sanitizeOverrideMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * 解析卡池 UP 六星 ID：
 * 1) `_` 前缀保留键直接返回未知；
 * 2) 优先使用已同步入库的 pools 表（/api/content，且 up6Ids 非空）；
 * 3) 其次使用本地覆盖层（`<dataDir>/up-map.override.json` 与 `opts.override`）；
 * 4) 最后回退到内置 `src/core/data/up-map.json`。
 */
export function makeUpResolver(pools: Map<string, PoolInfo>, opts: UpResolverOptions = {}): UpResolver {
  const fallback = upMap as unknown as Record<string, { up6Ids?: string[] }>;
  const override = {
    ...loadUpMapOverride(opts.dataDir),
    ...sanitizeOverrideMap(opts.override),
  };
  return {
    up6(poolId) {
      if (poolId.startsWith("_")) return { ids: [], known: false };
      const fromPool = pools.get(poolId)?.up6Ids ?? [];
      if (fromPool.length > 0) return { ids: fromPool, known: true };
      if (Object.hasOwn(override, poolId)) {
        const ov = override[poolId]?.up6Ids;
        if (Array.isArray(ov)) return { ids: ov, known: ov.length > 0 };
      }
      const fb = Object.hasOwn(fallback, poolId) ? (fallback[poolId]?.up6Ids ?? []) : [];
      return { ids: fb, known: fb.length > 0 };
    },
  };
}
