import { beforeEach, describe, expect, it } from "vitest";
import { EfApiError, EfClient } from "../src/core/api/ef-client.js";
import { compareSeqId, normalizeKind, resolveWeaponPoolKind } from "../src/core/api/normalize.js";
import { syncFromCache } from "../src/core/route-a.js";
import { GachaStore } from "../src/core/storage/store.js";
import { syncAccount } from "../src/core/sync/sync.js";
import { buildAccountKey, CHAR_POOL_TYPES, type AccountRow } from "../src/core/types.js";
import { createFakeServer, fakeToken, makeChar, makeWeapon, type FakeServerData } from "./helpers/fake-ef-server.js";
import { buildBlockfileCache } from "./helpers/blockfile-builder.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SP = "E_CharacterGachaPoolType_Special";
const ST = "E_CharacterGachaPoolType_Standard";
const noSleep = async () => {};

function baseData(token: string): FakeServerData {
  return {
    token,
    char: {
      [SP]: [makeChar(9, 6, "special_1_0_1", "春雷动"), makeChar(8, 4, "special_1_0_1", "春雷动"), makeChar(7, 5, "special_1_0_1", "春雷动", { kind: "gift_intel_book" }), makeChar(6, 4, "special_1_0_1", "春雷动"), makeChar(5, 4, "special_1_0_1", "春雷动")],
      [ST]: [makeChar(3, 5, "standard", "基础")],
      E_CharacterGachaPoolType_Beginner: [],
      E_CharacterGachaPoolType_Joint: [],
      E_CharacterGachaPoolType_Rerun: [makeChar(2, 6, "rerun_char_1", "重构一")],
    },
    weaponPools: [{ poolId: "weponbox_1_0_1", poolName: "行舟申领" }, { poolId: "rerun_wpn_x", poolName: "重构申领", poolType: "rerun" }],
    weapon: {
      weponbox_1_0_1: [makeWeapon(12, 6, "weponbox_1_0_1"), makeWeapon(11, 4, "weponbox_1_0_1")],
      rerun_wpn_x: [makeWeapon(14, 5, "rerun_wpn_x")],
    },
  };
}

const acct = (over: Partial<AccountRow> = {}): AccountRow => {
  const identity = { region: "cn" as const, channelMasterId: "2", bindingUid: "900001", roleId: "700001" };
  return { ...identity, accountKey: buildAccountKey(identity), nickname: "t", serverId: "1", serverName: "China", channelName: "bilibili服", source: "test", updatedAt: 1, ...over };
};

let store: GachaStore;
beforeEach(() => {
  store = GachaStore.open(":memory:");
});

describe("账号隔离键", () => {
  it("官服与 B 服（同 serverId=1）以及同渠道多角色互不覆盖", () => {
    const base = { region: "cn" as const, bindingUid: "900001", roleId: "700001" };
    const official = buildAccountKey({ ...base, channelMasterId: "1" });
    const bili = buildAccountKey({ ...base, channelMasterId: "2" });
    const bili2 = buildAccountKey({ ...base, channelMasterId: "2", roleId: "700002" });
    expect(new Set([official, bili, bili2]).size).toBe(3);
    expect(() => buildAccountKey({ ...base, channelMasterId: "", })).toThrow();
  });

  it("相同 seq_id 在不同账号下各自存储", () => {
    const a = acct();
    const b = acct({ accountKey: buildAccountKey({ region: "cn", channelMasterId: "1", bindingUid: "900001", roleId: "700001" }), channelMasterId: "1" });
    const rec = (n: string) => ({ type: "char" as const, feed: `char:${SP}`, poolType: SP, poolId: "p", poolName: "p", itemId: "i", itemName: n, itemSubType: "", rarity: 6, isFree: false, isNew: false, gachaTs: "1", seqId: "100", kind: "draw" });
    expect(store.insertRecords(a.accountKey, [rec("A")])).toBe(1);
    expect(store.insertRecords(b.accountKey, [rec("B")])).toBe(1);
    expect(store.insertRecords(a.accountKey, [rec("A")])).toBe(0);
    expect(store.getRecords(a.accountKey)[0]!.itemName).toBe("A");
    expect(store.getRecords(b.accountKey)[0]!.itemName).toBe("B");
  });
});

describe("工具函数", () => {
  it("seq_id 数值语义比较、kind 与武器池类别", () => {
    expect(compareSeqId("9", "10")).toBe(-1);
    expect(compareSeqId("123456789012345678901", "123456789012345678900")).toBe(1);
    expect(normalizeKind(undefined)).toBe("draw");
    expect(normalizeKind("gift_intel_book")).toBe("gift_intel_book");
    expect(resolveWeaponPoolKind("weaponbox_constant_2")).toBe("constant");
    expect(resolveWeaponPoolKind("rerun_wpn_yvonne")).toBe("rerun");
    expect(resolveWeaponPoolKind("weponbox_1_0_1")).toBe("special");
  });
});

describe("EfClient", () => {
  it("国服 server_id 恒为 1（忽略传入值）；国际服必须显式提供", () => {
    const t = fakeToken("c");
    expect(new EfClient({ token: t, region: "cn", serverId: "2" }).serverId).toBe("1");
    expect(() => new EfClient({ token: t, region: "global" })).toThrow();
    expect(new EfClient({ token: t, region: "global", serverId: "3" }).host).toBe("ef-webview.gryphline.com");
  });

  it("token 失效抛出带 code 的错误，且错误消息不泄露 token", async () => {
    const good = fakeToken("g");
    const srv = createFakeServer(baseData(good));
    const c = new EfClient({ token: fakeToken("other"), region: "cn", fetch: srv.fetch, sleep: noSleep });
    const err = await c.charPoolTypes().catch((e) => e);
    expect(err).toBeInstanceOf(EfApiError);
    expect((err as EfApiError).code).toBe(40100);
    expect(String(err.message)).not.toContain("other");
  });
});

describe("syncAccount", () => {
  it("覆盖 5 类角色池 + 武器池逐池；token 经重新编码后服务端可识别；gift 入库但不计入抽卡", async () => {
    const t = fakeToken("sync");
    const srv = createFakeServer(baseData(t));
    const a = acct();
    store.upsertAccount(a);
    const client = new EfClient({ token: t, region: "cn", fetch: srv.fetch, sleep: noSleep, pageDelayMs: [0, 0] });
    const rep = await syncAccount(client, store, a.accountKey);

    expect(rep.ok).toBe(true);
    const feeds = rep.feeds.map((f) => f.feed);
    for (const pt of CHAR_POOL_TYPES) expect(feeds).toContain(`char:${pt}`);
    expect(feeds).toContain("weapon:weponbox_1_0_1");
    expect(feeds).toContain("weapon:rerun_wpn_x");
    // meta 只给了 2 类，其余 3 类是并集补上的；Beginner/Joint 在 fake 里为空列表不会报错
    const all = store.getRecords(a.accountKey);
    expect(all.filter((r) => r.type === "char" && r.poolType === SP)).toHaveLength(5);
    expect(all.filter((r) => r.kind !== "draw").map((r) => r.kind)).toEqual(["gift_intel_book"]);
    expect(store.countRecords(a.accountKey).draws).toBe(all.length - 1);
    // weapon/pool 在逐池拉取之前被调用
    const order = srv.calls.map((c) => c.url.pathname);
    expect(order.indexOf("/api/record/weapon/pool")).toBeLessThan(order.indexOf("/api/record/weapon"));
    // 累计次数与卡池信息
    expect(store.getRerunCounts(a.accountKey, "char")[0]!.totalPullCount).toBe(42);
    expect(store.getPool("special_1_0_1")?.up6Ids).toEqual(["chr_6_99"]);
    // 请求里从不出现 server_id != 1
    expect(srv.calls.filter((c) => c.url.hostname.startsWith("ef-")).every((c) => c.url.searchParams.get("server_id") === "1")).toBe(true);
  });

  it("增量：第二次只拉新记录；页内遇到已知 seq 提前停止", async () => {
    const t = fakeToken("inc");
    const data = baseData(t);
    const srv1 = createFakeServer(data);
    const a = acct();
    const mk = (srv: ReturnType<typeof createFakeServer>) => new EfClient({ token: t, region: "cn", fetch: srv.fetch, sleep: noSleep, pageDelayMs: [0, 0] });
    await syncAccount(mk(srv1), store, a.accountKey);
    const before = store.countRecords(a.accountKey).total;

    data.char[SP] = [makeChar(11, 5, "special_1_0_1", "春雷动"), makeChar(10, 4, "special_1_0_1", "春雷动"), ...data.char[SP]!];
    const srv2 = createFakeServer(data);
    const rep = await syncAccount(mk(srv2), store, a.accountKey);
    expect(rep.totalAdded).toBe(2);
    expect(store.countRecords(a.accountKey).total).toBe(before + 2);
    // Special 池：新增 2 条应只需要 1~2 页（pageSize=3），不会翻到最老页
    const spPages = srv2.calls.filter((c) => c.url.pathname === "/api/record/char" && c.url.searchParams.get("pool_type") === SP).length;
    expect(spPages).toBeLessThanOrEqual(2);
  });

  it("feed 中途失败时整条 feed 不入库，下次同步能补全（不会留下缺口）", async () => {
    const t = fakeToken("gap");
    const data = baseData(t);
    data.char[SP] = Array.from({ length: 8 }, (_, i) => makeChar(20 - i, 4, "special_1_0_1", "春雷动"));
    const a = acct();
    const failing = createFakeServer({ ...data, failOn: (ep, p) => ep === "/api/record/char" && p.get("pool_type") === SP && p.get("seq_id") === "18" });
    const client = (srv: ReturnType<typeof createFakeServer>) => new EfClient({ token: t, region: "cn", maxRetries: 1, fetch: srv.fetch, sleep: noSleep, pageDelayMs: [0, 0] });
    const r1 = await syncAccount(client(failing), store, a.accountKey);
    expect(r1.ok).toBe(false);
    expect(r1.feeds.find((f) => f.feed === `char:${SP}`)!.status).toBe("error");
    expect(store.getRecords(a.accountKey, { feed: `char:${SP}` })).toHaveLength(0);

    const healthy = createFakeServer(data);
    const r2 = await syncAccount(client(healthy), store, a.accountKey);
    expect(r2.ok).toBe(true);
    expect(store.getRecords(a.accountKey, { feed: `char:${SP}` })).toHaveLength(8);
  });

  it("重构申领单池请求失败时回退 pool_ids 合并请求", async () => {
    const t = fakeToken("rr");
    const data = baseData(t);
    const srv = createFakeServer({ ...data, failOn: (ep, p) => ep === "/api/record/weapon" && p.get("pool_id") === "rerun_wpn_x" });
    const a = acct();
    const c = new EfClient({ token: t, region: "cn", maxRetries: 1, fetch: srv.fetch, sleep: noSleep, pageDelayMs: [0, 0] });
    const rep = await syncAccount(c, store, a.accountKey);
    expect(rep.ok).toBe(true);
    expect(store.getRecords(a.accountKey, { feed: "weapon:rerun_wpn_x" })).toHaveLength(1);
    expect(srv.calls.some((x) => x.url.searchParams.has("pool_ids"))).toBe(true);
  });
});

describe("路线 A 端到端（合成缓存 + 合成服务端）", () => {
  it("缓存取最新 B 服凭据 → 反查角色 → 全池同步，账号键含渠道/角色维度", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beg-ra-"));
    try {
      const local = path.join(tmp, "L");
      const t = fakeToken("e2e");
      const t0 = Date.UTC(2026, 10, 25);
      buildBlockfileCache(path.join(local, "PlatformProcess", "Cache"), [
        { url: `https://ef-webview.hypergryph.com/page/gacha_char?channel=2&subChannel=2&platform=Windows&lang=zh-cn&server=1&u8_token=${encodeURIComponent(t)}`, creationMs: t0, lastUsedMs: t0 },
      ], { crash: 1 });
      const srv = createFakeServer(baseData(t));
      const res = await syncFromCache({ store, localAppData: local, userProfile: path.join(tmp, "H"), fetch: srv.fetch, sleep: noSleep });
      expect(res.account.accountKey).toBe("cn_2_900001_700001");
      expect(res.account.channelName).toBe("bilibili服");
      expect("token" in res.credential).toBe(false);
      expect(res.report.ok).toBe(true);
      expect(store.countRecords(res.account.accountKey).draws).toBeGreaterThan(5);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
