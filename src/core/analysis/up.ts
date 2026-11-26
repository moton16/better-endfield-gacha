import upMap from "../data/up-map.json" with { type: "json" };
import type { PoolInfo } from "../types.js";

export interface UpResolver {
  up6(poolId: string): { ids: string[]; known: boolean };
}

/**
 * 解析卡池 UP 六星 ID：优先使用已同步入库的 pools 表（/api/content），缺失时回退到本地 up-map.json。
 */
export function makeUpResolver(pools: Map<string, PoolInfo>): UpResolver {
  const fallback = upMap as unknown as Record<string, { up6Ids?: string[] }>;
  return {
    up6(poolId) {
      const fromPool = pools.get(poolId)?.up6Ids ?? [];
      if (fromPool.length > 0) return { ids: fromPool, known: true };
      if (poolId.startsWith("_")) return { ids: [], known: false };
      const fb = fallback[poolId]?.up6Ids ?? [];
      return { ids: fb, known: fb.length > 0 };
    },
  };
}
