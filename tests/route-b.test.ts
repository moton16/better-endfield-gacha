import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMMANDS } from "../src/cli/commands/index.js";
import { parseProvider } from "../src/cli/commands/login.js";
import { makeContext } from "../src/cli/context.js";
import { maskKey, maskName } from "../src/cli/util.js";
import { PROVIDERS } from "../src/core/auth/passport.js";
import { queryRoleList, RoleQueryError } from "../src/core/auth/role.js";
import { inspectPassport, syncFromPassport } from "../src/core/route-b.js";
import { GachaStore } from "../src/core/storage/store.js";
import { combineFetch, readJsonBodyToken } from "./helpers/combine-fetch.js";
import { createFakeServer, fakeToken, makeChar, makeWeapon, type FakeServerData } from "./helpers/fake-ef-server.js";
import { createFakePassport } from "./helpers/fake-passport.js";

const SP = "E_CharacterGachaPoolType_Special";
const noSleep = async () => {};
const fakeHy = "HYTOKEN_ROUTEB_SYNTH_0123456789";

function mkServerData(token: string, charSeq: number, roleList: { uid: string; roleId: string; nickname: string }): FakeServerData {
  return {
    token,
    char: {
      [SP]: [makeChar(charSeq, 6, "special_1_0_1", "春雷动")],
      E_CharacterGachaPoolType_Standard: [],
      E_CharacterGachaPoolType_Beginner: [],
      E_CharacterGachaPoolType_Joint: [],
      E_CharacterGachaPoolType_Rerun: [],
    },
    weaponPools: [{ poolId: "weponbox_1_0_1", poolName: "行舟申领" }],
    weapon: { weponbox_1_0_1: [makeWeapon(charSeq + 100, 5, "weponbox_1_0_1")] },
    roleList,
  };
}

function routePassport(pp: ReturnType<typeof createFakePassport>) {
  return {
    match: (url: URL) => url.hostname.startsWith("as.") || url.hostname.startsWith("binding-api-account-prod."),
    fetch: pp.fetch,
  };
}

function routeEf(token: string, srv: ReturnType<typeof createFakeServer>) {
  return {
    match: (url: URL, init?: RequestInit) =>
      (url.hostname.startsWith("ef-webview.") && url.searchParams.get("token") === token) ||
      (url.hostname.startsWith("u8.") && readJsonBodyToken(init) === token),
    fetch: srv.fetch,
  };
}

let store: GachaStore;
beforeEach(() => {
  store = GachaStore.open(":memory:");
});

describe("路线 B（syncFromPassport / inspectPassport）", () => {
  it("官服(1) 与 B 服(2) 同 roleId 数字得到不同 accountKey 且 records 互不覆盖；换票使用 binding.uid；server_id 恒 1", async () => {
    const u8Official = fakeToken("off");
    const u8Bili = fakeToken("bili");
    const pp = createFakePassport({
      hytoken: fakeHy,
      includeOtherGame: true,
      bindings: [
        {
          uid: "BIND_OFF_1001",
          channelMasterId: 1,
          channelName: "官服",
          isDefault: true,
          roles: [{ roleId: "700001", nickName: "官服角色" }],
          u8Token: u8Official,
        },
        {
          uid: "BIND_BILI_2002",
          channelMasterId: 2,
          channelName: "bilibili服",
          roles: [{ roleId: "700001", nickName: "B服角色" }],
          u8Token: u8Bili,
        },
      ],
    });
    const srvOff = createFakeServer(mkServerData(u8Official, 11, { uid: "BIND_OFF_1001", roleId: "700001", nickname: "官服角色" }));
    const srvBili = createFakeServer(mkServerData(u8Bili, 22, { uid: "BIND_BILI_2002", roleId: "700001", nickname: "B服角色" }));
    const f = combineFetch(routePassport(pp), routeEf(u8Official, srvOff), routeEf(u8Bili, srvBili));

    const items = await syncFromPassport({ store, hytoken: fakeHy, fetch: f, sleep: noSleep });
    expect(items).toHaveLength(2);
    expect(items.every((it) => it.report?.ok && !it.error)).toBe(true);

    const keyOff = items[0]!.account!.accountKey;
    const keyBili = items[1]!.account!.accountKey;
    expect(keyOff).toBe("cn_1_BIND-OFF-1001_700001");
    expect(keyBili).toBe("cn_2_BIND-BILI-2002_700001");
    expect(keyOff).not.toBe(keyBili);
    expect(store.getRecords(keyOff).map((r) => r.seqId)).toContain("11");
    expect(store.getRecords(keyBili).map((r) => r.seqId)).toContain("22");

    // 换票 body 必须传 binding.uid，绝不传 roleId
    const tokenCalls = pp.calls.filter((c) => c.url.pathname === "/account/binding/v1/u8_token_by_uid");
    expect(tokenCalls.map((c) => c.body.uid)).toEqual(["BIND_OFF_1001", "BIND_BILI_2002"]);
    expect(tokenCalls.every((c) => c.body.uid !== "700001")).toBe(true);

    // 国服 server_id 恒为 "1"
    for (const srv of [srvOff, srvBili]) {
      const efCalls = srv.calls.filter((c) => c.url.hostname.startsWith("ef-webview."));
      expect(efCalls.length).toBeGreaterThan(0);
      expect(efCalls.every((c) => c.url.searchParams.get("server_id") === "1")).toBe(true);
    }
  });

  it("同一通行证下两个 B 服绑定各自换票并独立入库", async () => {
    const u8A = fakeToken("b1");
    const u8B = fakeToken("b2");
    const pp = createFakePassport({
      hytoken: fakeHy,
      bindings: [
        { uid: "BILI_A", channelMasterId: "2", channelName: "bilibili服", roles: [{ roleId: "8001", nickName: "号A" }], u8Token: u8A },
        { uid: "BILI_B", channelMasterId: "2", channelName: "bilibili服", roles: [{ roleId: "8002", nickName: "号B" }], u8Token: u8B },
      ],
    });
    const srvA = createFakeServer(mkServerData(u8A, 31, { uid: "BILI_A", roleId: "8001", nickname: "号A" }));
    const srvB = createFakeServer(mkServerData(u8B, 32, { uid: "BILI_B", roleId: "8002", nickname: "号B" }));
    const f = combineFetch(routePassport(pp), routeEf(u8A, srvA), routeEf(u8B, srvB));

    const items = await syncFromPassport({ store, hytoken: fakeHy, fetch: f, sleep: noSleep });
    expect(items).toHaveLength(2);
    expect(store.listAccounts()).toHaveLength(2);
    expect(store.getRecords("cn_2_BILI-A_8001").some((r) => r.seqId === "31")).toBe(true);
    expect(store.getRecords("cn_2_BILI-B_8002").some((r) => r.seqId === "32")).toBe(true);
  });

  it("跳过 isDeleted 绑定并支持 channel 过滤", async () => {
    const u8Bili = fakeToken("onlyb");
    const pp = createFakePassport({
      hytoken: fakeHy,
      bindings: [
        { uid: "DEL_B", channelMasterId: 2, channelName: "bilibili服", isDeleted: true, roles: [{ roleId: "1", nickName: "删" }], u8Token: fakeToken("del") },
        { uid: "OFF_1", channelMasterId: 1, channelName: "官服", roles: [{ roleId: "2", nickName: "官" }], u8Token: fakeToken("off") },
        { uid: "BILI_OK", channelMasterId: 2, channelName: "bilibili服", roles: [{ roleId: "3", nickName: "B" }], u8Token: u8Bili },
      ],
    });
    const srv = createFakeServer(mkServerData(u8Bili, 41, { uid: "BILI_OK", roleId: "3", nickname: "B" }));
    const f = combineFetch(routePassport(pp), routeEf(u8Bili, srv));

    const items = await syncFromPassport({ store, hytoken: fakeHy, channel: "2", fetch: f, sleep: noSleep });
    expect(items).toHaveLength(1);
    expect(items[0]?.account?.bindingUid).toBe("BILI_OK");
    expect(items[0]?.report?.ok).toBe(true);
  });

  it("query_role_list 失败时回退 binding.roles[0] 并记录警告；uid 不一致时记录警告", async () => {
    const u8Fallback = fakeToken("fb");
    const u8Mismatch = fakeToken("mm");
    const pp = createFakePassport({
      hytoken: fakeHy,
      bindings: [
        {
          uid: "BIND_FB",
          channelMasterId: 2,
          channelName: "bilibili服",
          roles: [{ roleId: "ROLE_FB_1", nickName: "回退名", serverId: "1" }, { roleId: "ROLE_FB_2", nickName: "次名", serverId: "1" }],
          u8Token: u8Fallback,
        },
        {
          uid: "BIND_MM",
          channelMasterId: 2,
          channelName: "bilibili服",
          roles: [{ roleId: "ROLE_MM", nickName: "一致名", serverId: "1" }],
          u8Token: u8Mismatch,
        },
      ],
    });
    const srvFb = createFakeServer(mkServerData(u8Fallback, 51, { uid: "BIND_FB", roleId: "ROLE_FB_1", nickname: "回退名" }));
    const srvMm = createFakeServer(mkServerData(u8Mismatch, 52, { uid: "DIFFERENT_U8_UID", roleId: "ROLE_MM", nickname: "一致名" }));
    const f = combineFetch(
      routePassport(pp),
      {
        match: (url, init) => url.hostname.startsWith("u8.") && readJsonBodyToken(init) === u8Fallback,
        fetch: (async () => new Response(JSON.stringify({ status: 500, msg: "role api down" }), { status: 500 })) as typeof fetch,
      },
      routeEf(u8Fallback, srvFb),
      routeEf(u8Mismatch, srvMm),
    );

    const items = await syncFromPassport({ store, hytoken: fakeHy, fetch: f, sleep: noSleep });
    expect(items).toHaveLength(2);
    expect(items[0]?.account?.roleId).toBe("ROLE_FB_1");
    expect(items[0]?.warnings.some((w) => w.includes("回退"))).toBe(true);
    expect(items[0]?.warnings.some((w) => w.includes("2 个角色"))).toBe(true);
    expect(items[0]?.report?.ok).toBe(true);

    expect(items[1]?.warnings.some((w) => w.includes("不一致"))).toBe(true);
    expect(items[1]?.report?.ok).toBe(true);
  });

  it("roles 为空时跳过该绑定并记警告（不报错、不发 u8 换票），CLI sync --passport 返回退出码 0", async () => {
    const u8Ok = fakeToken("ok");
    let u8NoRoleCalled = false;
    const pp = createFakePassport({
      hytoken: fakeHy,
      bindings: [
        { uid: "NO_ROLE_UID", channelMasterId: 1, channelName: "官服", roles: [], u8Token: "SHOULD_NOT_EXCHANGE" },
        { uid: "OK_UID", channelMasterId: 2, channelName: "bilibili服", roles: [{ roleId: "9001", nickName: "正常" }], u8Token: u8Ok },
      ],
      override: (url, body) => {
        if (url.pathname === "/account/binding/v1/u8_token_by_uid" && body?.uid === "NO_ROLE_UID") {
          u8NoRoleCalled = true;
        }
        return undefined;
      },
    });
    const srvOk = createFakeServer(mkServerData(u8Ok, 71, { uid: "OK_UID", roleId: "9001", nickname: "正常" }));
    const f = combineFetch(routePassport(pp), routeEf(u8Ok, srvOk));

    const items = await syncFromPassport({ store, hytoken: fakeHy, fetch: f, sleep: noSleep });
    expect(items).toHaveLength(2);
    expect(u8NoRoleCalled).toBe(false);
    expect(items[0]?.error).toBeUndefined();
    expect(items[0]?.account).toBeUndefined();
    expect(items[0]?.warnings.some((w) => w.includes("没有角色"))).toBe(true);
    expect(items[1]?.error).toBeUndefined();
    expect(items[1]?.report?.ok).toBe(true);

    // 验证 CLI `beg sync --passport` 遇到空绑定+正常绑定时退出码为 0（而非 4）
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beg-cli-empty-bind-"));
    const prevHy = process.env.BEG_HYTOKEN;
    vi.stubGlobal("fetch", f);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      process.env.BEG_HYTOKEN = fakeHy;
      const syncCmd = COMMANDS.find((c) => c.name === "sync")!;
      const exitCode = await syncCmd.run(makeContext(["sync", "--passport", "--data-dir", tmpDir]));
      expect(exitCode).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      if (prevHy === undefined) delete process.env.BEG_HYTOKEN;
      else process.env.BEG_HYTOKEN = prevHy;
      logSpy.mockRestore();
      errSpy.mockRestore();
      vi.unstubAllGlobals();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("queryRoleList 区分 status=101 无角色（RoleQueryError.isNoRole=true）与其它异常", async () => {
    const f101 = (async () =>
      new Response(JSON.stringify({ status: 101, msg: "not found role" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    await expect(queryRoleList("t", "cn", "1", f101)).rejects.toSatisfy(
      (err: unknown) => err instanceof RoleQueryError && err.isNoRole === true && err.status === 101,
    );

    const f500 = (async () => new Response(JSON.stringify({ status: 500 }), { status: 500 })) as typeof fetch;
    await expect(queryRoleList("t", "cn", "1", f500)).rejects.toSatisfy(
      (err: unknown) => err instanceof RoleQueryError && err.isNoRole === false,
    );
  });

  it("无任何可用绑定时抛出含 B 服绑定提示的错误", async () => {
    const pp = createFakePassport({ hytoken: fakeHy, bindings: [] });
    const f = combineFetch(routePassport(pp));
    await expect(syncFromPassport({ store, hytoken: fakeHy, fetch: f, sleep: noSleep })).rejects.toThrow(/B 服玩家请先.*绑定/);
    expect(await inspectPassport(fakeHy, "hypergryph", f)).toEqual([]);
  });

  it("单个绑定换票失败（status=109）不影响其它绑定继续入库", async () => {
    const u8Good = fakeToken("good");
    const pp = createFakePassport({
      hytoken: fakeHy,
      bindings: [
        { uid: "BAD_BIND_UID", channelMasterId: 1, channelName: "官服", roles: [{ roleId: "1", nickName: "坏" }], u8Token: "UNUSED" },
        { uid: "GOOD_BIND_UID", channelMasterId: 2, channelName: "bilibili服", roles: [{ roleId: "2", nickName: "好" }], u8Token: u8Good },
      ],
      override: (url, body) => {
        if (url.pathname === "/account/binding/v1/u8_token_by_uid" && body?.uid === "BAD_BIND_UID") {
          return new Response(JSON.stringify({ status: 109, msg: "invalid binding" }), { headers: { "content-type": "application/json" } });
        }
        return undefined;
      },
    });
    const srvGood = createFakeServer(mkServerData(u8Good, 61, { uid: "GOOD_BIND_UID", roleId: "2", nickname: "好" }));
    const f = combineFetch(routePassport(pp), routeEf(u8Good, srvGood));

    const items = await syncFromPassport({ store, hytoken: fakeHy, fetch: f, sleep: noSleep });
    expect(items).toHaveLength(2);
    expect(items[0]?.error).toContain("109");
    expect(items[0]?.report).toBeUndefined();
    expect(items[1]?.error).toBeUndefined();
    expect(items[1]?.report?.ok).toBe(true);
    expect(store.listAccounts()).toHaveLength(1);
  });

  it("gryphline 国际服保留 serverId 并使用 channelMasterId='0'（缺失时）", async () => {
    const u8Global = fakeToken("gl");
    const pp = createFakePassport({
      hytoken: fakeHy,
      expectedAppCode: PROVIDERS.gryphline.appCode,
      bindings: [
        {
          uid: "GL_UID_1",
          channelMasterId: "",
          channelName: "Global",
          roles: [{ roleId: "GL_ROLE_1", nickName: "Endministrator", serverId: "3", serverName: "US" }],
          u8Token: u8Global,
        },
      ],
    });
    const srv = createFakeServer(mkServerData(u8Global, 81, { uid: "GL_UID_1", roleId: "GL_ROLE_1", nickname: "Endministrator" }));
    const f = combineFetch(routePassport(pp), routeEf(u8Global, srv));

    const items = await syncFromPassport({ store, hytoken: fakeHy, provider: "gryphline", fetch: f, sleep: noSleep });
    expect(items).toHaveLength(1);
    expect(items[0]?.account?.accountKey).toBe("global_0_GL-UID-1_GL-ROLE-1");
    expect(items[0]?.account?.serverId).toBe("3");
    const efCalls = srv.calls.filter((c) => c.url.hostname === "ef-webview.gryphline.com");
    expect(efCalls.length).toBeGreaterThan(0);
    expect(efCalls.every((c) => c.url.searchParams.get("server_id") === "3")).toBe(true);
  });
});

describe("CLI 命令注册表与脱敏工具", () => {
  it("COMMANDS 包含全部基础与路线 B 命令，makeContext/parseProvider/maskKey 行为正确", () => {
    expect(COMMANDS.map((c) => c.name)).toEqual(
      expect.arrayContaining(["scan", "link", "sync", "login", "logout", "accounts", "stats", "export"]),
    );
    const ctx = makeContext(["sync", "--passport", "--token-stdin", "--channel", "2", "--cache-dir", "a", "--cache-dir", "b"]);
    expect(ctx.command).toBe("sync");
    expect(ctx.bool("passport")).toBe(true);
    expect(ctx.bool("token-stdin")).toBe(true);
    expect(ctx.str("channel")).toBe("2");
    expect(ctx.strs("cache-dir")).toEqual(["a", "b"]);
    expect(() => makeContext(["sync", "--unknown-flag"])).toThrow();

    expect(parseProvider(undefined)).toBe("hypergryph");
    expect(parseProvider("gryphline")).toBe("gryphline");
    expect(parseProvider("invalid")).toBeNull();

    expect(maskKey("cn_2_UID123_ROLE456", false)).toMatch(/^cn_2_#[0-9a-f]{8}$/);
    expect(maskKey("cn_2_UID123_ROLE456", true)).toBe("cn_2_UID123_ROLE456");
    expect(maskName("博士", false)).toBe("***");
    expect(maskName("博士", true)).toBe("博士");
  });
});
