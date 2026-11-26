/**
 * 合成的终末地 webview API：用于验证分页/增量/过滤/隔离，不访问网络。
 * 数据全部虚构。
 */
import { fakeToken } from "./blockfile-builder.js";

export interface FakeServerData {
  token: string;
  /** pool_type → 新→旧 */
  char: Record<string, Array<Record<string, unknown>>>;
  weaponPools: Array<{ poolId: string; poolName: string; poolType?: string }>;
  /** pool_id → 新→旧 */
  weapon: Record<string, Array<Record<string, unknown>>>;
  pageSize?: number;
  /** 返回错误的 (endpoint, pool) 组合，如 "/api/record/char?E_..."; 用于验证失败不入库 */
  failOn?: (endpoint: string, params: URLSearchParams, hit: number) => boolean;
  /** 额外：meta 中提供哪些 pool_type（默认只给 Special/Standard） */
  metaTypes?: string[];
  roleList?: { uid: string; roleId: string; nickname: string };
}

export interface FakeServer {
  fetch: typeof fetch;
  calls: Array<{ method: string; url: URL; body?: any }>;
}

export function makeChar(seq: number, rarity: number, poolId: string, poolName: string, extra: Record<string, unknown> = {}) {
  return {
    charId: `chr_${rarity}_${seq}`, charName: `干员${seq}`, gachaTs: String(1_700_000_000_000 + seq * 1000),
    isFree: false, isNew: false, poolId, poolName, rarity, seqId: String(seq), ...extra,
  };
}

export function makeWeapon(seq: number, rarity: number, poolId: string, extra: Record<string, unknown> = {}) {
  return {
    poolId, poolName: poolId, weaponId: `wpn_${seq}`, weaponName: `武器${seq}`, weaponType: "sword",
    rarity, isNew: false, gachaTs: String(1_700_000_000_000 + seq * 1000), seqId: String(seq), ...extra,
  };
}

export function createFakeServer(data: FakeServerData): FakeServer {
  const calls: FakeServer["calls"] = [];
  const hits = new Map<string, number>();
  const size = data.pageSize ?? 3;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const ok = (d: unknown) => json({ code: 0, msg: "", data: d });

  const paginate = (all: Array<Record<string, unknown>>, seq: string | null) => {
    let start = 0;
    if (seq) {
      const i = all.findIndex((x) => x.seqId === seq);
      start = i < 0 ? all.length : i + 1;
    }
    const list = all.slice(start, start + size);
    return { list, hasMore: start + size < all.length };
  };

  const fakeFetch = (async (input: any, init?: any) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });

    if (url.hostname.startsWith("u8.")) {
      if (body?.token !== data.token) return json({ status: 2, msg: "bad token" });
      const r = data.roleList ?? { uid: "900001", roleId: "700001", nickname: "测试员" };
      return json({ status: 0, data: { uid: r.uid, roles: [{ roleId: r.roleId, nickname: r.nickname, serverId: "1", serverName: "China" }] } });
    }

    const p = url.searchParams;
    if (p.get("token") !== data.token) return json({ code: 40100, msg: "token invalid" });
    if (url.hostname === "ef-webview.hypergryph.com" && p.get("server_id") !== "1") {
      return json({ code: 400, msg: "bad server_id" });
    }
    const key = `${url.pathname}?${p.get("pool_type") ?? p.get("pool_id") ?? p.get("pool_ids") ?? ""}`;
    const hit = (hits.get(key) ?? 0) + 1;
    hits.set(key, hit);
    if (data.failOn?.(url.pathname, p, hit)) return json({ code: 500, msg: "boom" });

    switch (url.pathname) {
      case "/api/record/char/meta":
        return ok({ tabs: (data.metaTypes ?? ["E_CharacterGachaPoolType_Special", "E_CharacterGachaPoolType_Standard"]).map((poolType) => ({ poolType })) });
      case "/api/record/char": {
        const all = data.char[p.get("pool_type") ?? ""];
        if (!all) return json({ code: 404, msg: "no such pool_type" });
        return ok(paginate(all, p.get("seq_id")));
      }
      case "/api/record/weapon/pool":
        return ok(data.weaponPools);
      case "/api/record/weapon": {
        const ids = p.get("pool_ids")?.split(",") ?? [p.get("pool_id") ?? ""];
        const all = ids.flatMap((id) => data.weapon[id] ?? []).sort((a, b) => Number(b.seqId) - Number(a.seqId));
        return ok(paginate(all, p.get("seq_id")));
      }
      case "/api/record/char/rerun-counts":
        return ok([{ poolId: "rerun_char_1", poolName: "重构一", totalPullCount: 42 }]);
      case "/api/record/weapon/rerun-counts":
        return ok([]);
      case "/api/content":
        return ok({
          pool: {
            pool_gacha_type: p.get("pool_id")!.includes("wpn") || p.get("pool_id")!.includes("weapon") ? "weapon" : "char",
            pool_name: `池 ${p.get("pool_id")}`, pool_type: "special", version_num: "1.0",
            up6_name: "干员99", all: [{ id: "chr_6_99", name: "干员99", rarity: 6 }],
          },
        });
      default:
        return json({ code: 404, msg: "unknown endpoint" }, 404);
    }
  }) as typeof fetch;

  return { fetch: fakeFetch, calls };
}

export { fakeToken };
