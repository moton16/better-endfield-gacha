import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMANDS } from "../src/cli/commands/index.js";
import { makeContext } from "../src/cli/context.js";
import type { SecretCrypto } from "../src/core/auth/dpapi.js";
import { U8Store } from "../src/core/auth/u8-store.js";
import { CredentialExpiredError, NoCredentialError, syncFromCache } from "../src/core/route-a.js";
import { GachaStore } from "../src/core/storage/store.js";
import { CHAR_POOL_TYPES } from "../src/core/types.js";
import { createApp } from "../src/server/index.js";
import { buildBlockfileCache } from "./helpers/blockfile-builder.js";
import { createFakeServer, fakeToken, makeChar, makeWeapon, type FakeServerData } from "./helpers/fake-ef-server.js";

const SP = "E_CharacterGachaPoolType_Special";
const noSleep = async () => {};

const fakeCrypto: SecretCrypto = {
  encrypt: (plain) => `ENC:${Buffer.from(plain, "utf8").toString("base64")}`,
  decrypt: (cipher) => {
    if (!cipher.startsWith("ENC:")) throw new Error("bad cipher");
    return Buffer.from(cipher.slice(4), "base64").toString("utf8");
  },
};

const dirs: string[] = [];
function mkTempDir(prefix = "beg-ra-persist-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  const sandboxEnv = mkTempDir("beg-ra-env-");
  vi.stubEnv("LOCALAPPDATA", path.join(sandboxEnv, "Local"));
  vi.stubEnv("USERPROFILE", path.join(sandboxEnv, "Profile"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  while (dirs.length > 0) {
    fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function writeCacheEntry(
  localAppData: string,
  entries: Array<{ token: string; channel?: string; subChannel?: string; host?: string; server?: string; ts: number }>,
): void {
  buildBlockfileCache(
    path.join(localAppData, "PlatformProcess", "Cache"),
    entries.map((e) => {
      const host = e.host ?? "ef-webview.hypergryph.com";
      const ch = e.channel ? `channel=${e.channel}&` : "";
      const sub = e.subChannel ? `subChannel=${e.subChannel}&` : "";
      const srv = e.server ?? "1";
      return {
        url: `https://${host}/page/gacha_char?${ch}${sub}platform=Windows&lang=zh-cn&server=${srv}&u8_token=${encodeURIComponent(e.token)}`,
        creationMs: e.ts,
        lastUsedMs: e.ts,
      };
    }),
  );
}

function mkServerData(
  token: string,
  opts: {
    seq?: number;
    uid?: string;
    roleId?: string;
    nickname?: string;
    failOn?: FakeServerData["failOn"];
  } = {},
): FakeServerData {
  const seq = opts.seq ?? 10;
  return {
    token,
    char: {
      [SP]: [makeChar(seq, 6, "special_1_0_1", "春雷动")],
      E_CharacterGachaPoolType_Standard: [],
      E_CharacterGachaPoolType_Beginner: [],
      E_CharacterGachaPoolType_Joint: [],
      E_CharacterGachaPoolType_Rerun: [],
    },
    weaponPools: [{ poolId: "weponbox_1_0_1", poolName: "行舟申领" }],
    weapon: {
      weponbox_1_0_1: [makeWeapon(seq + 100, 5, "weponbox_1_0_1")],
    },
    roleList: {
      uid: opts.uid ?? "900001",
      roleId: opts.roleId ?? "700001",
      nickname: opts.nickname ?? "测试员",
    },
    failOn: opts.failOn,
  };
}

describe("U8Store（Route A 凭据持久化存储）", () => {
  it("加密保存元数据且不写明文 token；list() 不返回 cipher；支持 region:channel 隔离与最近验证排序", () => {
    const dir = mkTempDir();
    const u8 = new U8Store(dir, fakeCrypto);
    const tOff = fakeToken("off");
    const tBili = fakeToken("bili");
    const tGlobal = fakeToken("gl");

    u8.save(
      {
        token: tOff,
        tokenFingerprint: "fp_off",
        host: "ef-webview.hypergryph.com",
        region: "cn",
        channel: "1",
        subChannel: "1",
        serverId: "1",
        lang: "zh-cn",
        paths: ["/page/gacha_char"],
        sortTimeMs: 1000,
        creationTimeMs: 1000,
        lastUsedMs: 1000,
      },
      10_000,
    );
    u8.save(
      {
        token: tBili,
        tokenFingerprint: "fp_bili",
        host: "ef-webview.hypergryph.com",
        region: "cn",
        channel: "2",
        subChannel: "2",
        serverId: "1",
        lang: "zh-cn",
        paths: ["/page/gacha_char"],
        sortTimeMs: 2000,
        creationTimeMs: 2000,
        lastUsedMs: 2000,
      },
      20_000,
    );
    u8.save(
      {
        token: tGlobal,
        tokenFingerprint: "fp_gl",
        host: "ef-webview.gryphline.com",
        region: "global",
        serverId: "3",
        paths: ["/page/gacha_char"],
        sortTimeMs: 1500,
        creationTimeMs: 1500,
        lastUsedMs: 1500,
      },
      15_000,
    );

    const raw = fs.readFileSync(path.join(dir, "u8-cache.json"), "utf8");
    expect(raw).not.toContain(tOff);
    expect(raw).not.toContain(tBili);
    expect(raw).not.toContain(tGlobal);

    const listed = u8.list();
    expect(listed).toHaveLength(3);
    expect(listed.every((e) => !("cipher" in e))).toBe(true);
    expect(u8.pick({ region: "cn", channel: "1" })?.token).toBe(tOff);
    expect(u8.pick({ region: "cn", channel: "2" })?.token).toBe(tBili);
    expect(u8.pick({ region: "global" })?.token).toBe(tGlobal);
    // 无过滤时选最近验证的 cn:2
    expect(u8.pick()?.id).toBe("cn:2");

    // touch 提升 cn:1 的 verifiedAt 后，无过滤选 cn:1
    expect(u8.touch("cn:1", 30_000)).toBe(true);
    expect(u8.pick()?.id).toBe("cn:1");

    expect(u8.remove("cn:2")).toBe(true);
    expect(u8.pick({ channel: "2" })).toBeNull();
    expect(u8.pick({ channel: "1" })?.token).toBe(tOff);
    expect(u8.clear()).toBe(2);
    expect(fs.existsSync(path.join(dir, "u8-cache.json"))).toBe(false);
  });

  it("缺失、损坏 JSON、版本不匹配及损坏密文均优雅降级为空", () => {
    const dir = mkTempDir();
    const file = path.join(dir, "u8-cache.json");
    const u8 = new U8Store(dir, fakeCrypto);
    expect(u8.list()).toEqual([]);
    expect(u8.pick()).toBeNull();

    fs.writeFileSync(file, "{bad json", "utf8");
    expect(u8.list()).toEqual([]);
    expect(u8.pick()).toBeNull();

    fs.writeFileSync(file, JSON.stringify({ version: 2, entries: [{ id: "cn:1" }] }), "utf8");
    expect(u8.list()).toEqual([]);

    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "cn:2",
            region: "cn",
            channel: "2",
            serverId: "1",
            host: "ef-webview.hypergryph.com",
            tokenFingerprint: "deadbeef",
            paths: ["/page/gacha_char"],
            sortTimeMs: 1,
            creationTimeMs: 1,
            lastUsedMs: 1,
            verifiedAt: 1,
            cipher: "CORRUPTED_CIPHER",
          },
        ],
      }),
      "utf8",
    );
    expect(u8.list()).toHaveLength(1);
    expect(u8.pick()).toBeNull();
  });

  it(":memory: 与非 Windows 无自定义 crypto 时优雅跳过持久化（不抛 DPAPI 错误）", () => {
    const mem = new U8Store(":memory:", fakeCrypto);
    expect(mem.isAvailable).toBe(false);
    expect(mem.pick()).toBeNull();
    expect(
      mem.save({
        token: fakeToken("mem"),
        tokenFingerprint: "fp",
        host: "ef-webview.hypergryph.com",
        region: "cn",
        channel: "1",
        serverId: "1",
        paths: ["/page/gacha_char"],
        sortTimeMs: 1,
        creationTimeMs: 1,
        lastUsedMs: 1,
      }),
    ).toBeNull();
    expect(fs.existsSync(":memory:")).toBe(false);

    const dir = mkTempDir();
    const origDesc = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      const nonWin = new U8Store(dir);
      expect(nonWin.isAvailable).toBe(false);
      expect(() => nonWin.pick()).not.toThrow();
      expect(
        nonWin.save({
          token: fakeToken("linux"),
          tokenFingerprint: "fp",
          host: "ef-webview.hypergryph.com",
          region: "cn",
          channel: "2",
          serverId: "1",
          paths: ["/page/gacha_char"],
          sortTimeMs: 1,
          creationTimeMs: 1,
          lastUsedMs: 1,
        }),
      ).toBeNull();
      expect(fs.existsSync(path.join(dir, "u8-cache.json"))).toBe(false);
    } finally {
      Object.defineProperty(process, "platform", origDesc);
    }
  });
});

describe("路线 A 持久化复用与 40100 被动回源", () => {
  it("首次扫描验证成功后加密持久化；游戏关闭且缓存清空后再次同步仍可复用并刷新 verifiedAt", async () => {
    const tmp = mkTempDir();
    const dataDir = path.join(tmp, "data");
    const local = path.join(tmp, "Local");
    const home = path.join(tmp, "Profile");
    const store = GachaStore.open(":memory:");

    const t1 = fakeToken("persist-reuse");
    writeCacheEntry(local, [{ token: t1, channel: "2", subChannel: "2", ts: Date.UTC(2026, 10, 25) }]);

    const srv1 = createFakeServer(mkServerData(t1, { seq: 10 }));
    const res1 = await syncFromCache({
      store,
      dataDir,
      crypto: fakeCrypto,
      localAppData: local,
      userProfile: home,
      fetch: srv1.fetch,
      sleep: noSleep,
    });
    expect(res1.report.ok).toBe(true);
    expect(store.countRecords(res1.account.accountKey).draws).toBe(2);

    const persistedFile = path.join(dataDir, "u8-cache.json");
    expect(fs.existsSync(persistedFile)).toBe(true);
    expect(fs.readFileSync(persistedFile, "utf8")).not.toContain(t1);

    const metaBefore = new U8Store(dataDir, fakeCrypto).list()[0]!;
    expect(metaBefore.id).toBe("cn:2");

    // 彻底删除游戏缓存目录（模拟游戏关闭或缓存被清理）
    fs.rmSync(local, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 15));

    const data2 = mkServerData(t1, { seq: 10 });
    data2.char[SP] = [makeChar(11, 5, "special_1_0_1", "春雷动"), ...data2.char[SP]!];
    const srv2 = createFakeServer(data2);
    const logs: string[] = [];

    const res2 = await syncFromCache({
      store,
      dataDir,
      crypto: fakeCrypto,
      localAppData: local,
      userProfile: home,
      fetch: srv2.fetch,
      sleep: noSleep,
      onProgress: (m) => logs.push(m),
    });
    expect(res2.report.ok).toBe(true);
    expect(res2.report.totalAdded).toBe(1);
    expect(store.countRecords(res2.account.accountKey).draws).toBe(3);
    expect(logs.some((l) => l.includes("复用本地保存的抽卡凭据") && l.includes(metaBefore.tokenFingerprint))).toBe(true);
    expect(logs.every((l) => !l.includes(t1))).toBe(true);

    const metaAfter = new U8Store(dataDir, fakeCrypto).list()[0]!;
    expect(metaAfter.verifiedAt).toBeGreaterThanOrEqual(metaBefore.verifiedAt);
    store.close();
  });

  it("持久化凭据遭遇 40100（含 char/meta、runFeed、weaponPools、queryRoleList 鉴权失败）时被动重扫缓存并更新", async () => {
    for (const scenario of ["meta40100", "runFeed40100", "weaponPools40100", "roleAuthErr"] as const) {
      const tmp = mkTempDir(`beg-ra-fb-${scenario}-`);
      const dataDir = path.join(tmp, "data");
      const local = path.join(tmp, "Local");
      const home = path.join(tmp, "Profile");
      const store = GachaStore.open(":memory:");

      const tOld = fakeToken(`old-${scenario}`);
      const tNew = fakeToken(`new-${scenario}`);

      // 先落盘一个已验证但随后在服务端过期的凭据
      new U8Store(dataDir, fakeCrypto).save({
        token: tOld,
        tokenFingerprint: "oldfp123",
        host: "ef-webview.hypergryph.com",
        region: "cn",
        channel: "2",
        subChannel: "2",
        serverId: "1",
        lang: "zh-cn",
        paths: ["/page/gacha_char"],
        sortTimeMs: 1000,
        creationTimeMs: 1000,
        lastUsedMs: 1000,
      });

      // 游戏缓存中放更新后的凭据
      writeCacheEntry(local, [
        { token: tOld, channel: "2", subChannel: "2", ts: 1000 },
        { token: tNew, channel: "2", subChannel: "2", ts: 2000 },
      ]);

      const srvNew = createFakeServer(mkServerData(tNew, { seq: 20 }));
      const jsonResp = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

      const fetchMock: typeof fetch = async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        const body = init?.body ? (JSON.parse(String(init.body)) as { token?: string }) : undefined;
        const tok = url.hostname.startsWith("u8.") ? body?.token : url.searchParams.get("token");

        if (tok === tOld) {
          if (scenario === "roleAuthErr") {
            return jsonResp({ status: 2, msg: "token expired" });
          }
          if (url.hostname.startsWith("u8.")) {
            return jsonResp({
              status: 0,
              data: { uid: "900001", roles: [{ roleId: "700001", nickname: "测试员", serverId: "1", serverName: "China" }] },
            });
          }
          if (scenario === "meta40100") {
            return jsonResp({ code: 40100, msg: "token expired" });
          }
          if (scenario === "runFeed40100") {
            if (url.pathname === "/api/record/char/meta") return new Response("meta temporary fail", { status: 500 });
            if (url.pathname === "/api/record/char") return jsonResp({ code: 40100, msg: "token expired" });
          }
          if (scenario === "weaponPools40100") {
            if (url.pathname === "/api/record/char/meta") {
              return jsonResp({ code: 0, msg: "", data: { tabs: CHAR_POOL_TYPES.map((poolType) => ({ poolType })) } });
            }
            if (url.pathname === "/api/record/char") return jsonResp({ code: 0, msg: "", data: { list: [], hasMore: false } });
            if (url.pathname === "/api/record/weapon/pool") return jsonResp({ code: 40100, msg: "token expired" });
          }
        }
        return srvNew.fetch(input, init);
      };

      const logs: string[] = [];
      const res = await syncFromCache({
        store,
        dataDir,
        crypto: fakeCrypto,
        localAppData: local,
        userProfile: home,
        fetch: fetchMock,
        sleep: noSleep,
        onProgress: (m) => logs.push(m),
      });

      expect(res.report.ok).toBe(true);
      expect(logs.some((l) => l.includes("本地保存凭据已过期（40100），正在回源重扫游戏缓存"))).toBe(true);

      const stored = new U8Store(dataDir, fakeCrypto).pick({ channel: "2" });
      expect(stored?.token).toBe(tNew);
      expect(fs.readFileSync(path.join(dataDir, "u8-cache.json"), "utf8")).not.toContain(tNew);
      store.close();
    }
  });

  it("40100 且缓存为空或只有同一过期 token 时删除过期持久化并抛出 CredentialExpiredError", async () => {
    for (const mode of ["emptyCache", "sameExpiredTokenInCache"] as const) {
      const tmp = mkTempDir(`beg-ra-exp-${mode}-`);
      const dataDir = path.join(tmp, "data");
      const local = path.join(tmp, "Local");
      const home = path.join(tmp, "Profile");
      const store = GachaStore.open(":memory:");

      const tExpired = fakeToken(`expired-${mode}`);
      new U8Store(dataDir, fakeCrypto).save({
        token: tExpired,
        tokenFingerprint: "expfp111",
        host: "ef-webview.hypergryph.com",
        region: "cn",
        channel: "2",
        subChannel: "2",
        serverId: "1",
        paths: ["/page/gacha_char"],
        sortTimeMs: 1000,
        creationTimeMs: 1000,
        lastUsedMs: 1000,
      });

      if (mode === "sameExpiredTokenInCache") {
        writeCacheEntry(local, [{ token: tExpired, channel: "2", subChannel: "2", ts: 1000 }]);
      }

      const srv = createFakeServer(mkServerData(fakeToken("server-current-other")));
      const err = await syncFromCache({
        store,
        dataDir,
        crypto: fakeCrypto,
        localAppData: local,
        userProfile: home,
        fetch: srv.fetch,
        sleep: noSleep,
      }).catch((e) => e);

      expect(err).toBeInstanceOf(CredentialExpiredError);
      expect((err as Error).message).toContain("40100");
      expect((err as Error).message).toContain("寻访详情");
      expect((err as Error).message).toContain("路线 B");
      // 过期条目必须被删除
      expect(new U8Store(dataDir, fakeCrypto).list()).toEqual([]);
      // sameExpiredTokenInCache 不应再次用同一过期 token 重复请求服务端
      if (mode === "sameExpiredTokenInCache") {
        expect(srv.calls.filter((c) => c.url.hostname.startsWith("u8."))).toHaveLength(1);
      }
      store.close();
    }
  });

  it("无持久化时扫描到已过期缓存凭据也不落盘并抛出 CredentialExpiredError", async () => {
    const tmp = mkTempDir();
    const dataDir = path.join(tmp, "data");
    const local = path.join(tmp, "Local");
    const home = path.join(tmp, "Profile");
    const store = GachaStore.open(":memory:");

    const tExpired = fakeToken("fresh-scan-expired");
    writeCacheEntry(local, [{ token: tExpired, channel: "2", subChannel: "2", ts: 1000 }]);

    const srv = createFakeServer(mkServerData(fakeToken("other-active")));
    const err = await syncFromCache({
      store,
      dataDir,
      crypto: fakeCrypto,
      localAppData: local,
      userProfile: home,
      fetch: srv.fetch,
      sleep: noSleep,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(CredentialExpiredError);
    expect(new U8Store(dataDir, fakeCrypto).list()).toEqual([]);
    store.close();
  });

  it("非 40100 瞬时网络/HTTP 500 错误保留持久化凭据不删除", async () => {
    const tmp = mkTempDir();
    const dataDir = path.join(tmp, "data");
    const local = path.join(tmp, "Local");
    const home = path.join(tmp, "Profile");
    const store = GachaStore.open(":memory:");

    const tKeep = fakeToken("keep-on-transient");
    new U8Store(dataDir, fakeCrypto).save({
      token: tKeep,
      tokenFingerprint: "keepfp11",
      host: "ef-webview.hypergryph.com",
      region: "cn",
      channel: "1",
      subChannel: "1",
      serverId: "1",
      paths: ["/page/gacha_char"],
      sortTimeMs: 1000,
      creationTimeMs: 1000,
      lastUsedMs: 1000,
    });

    const downFetch: typeof fetch = async () => new Response("upstream error", { status: 503 });
    await expect(
      syncFromCache({
        store,
        dataDir,
        crypto: fakeCrypto,
        localAppData: local,
        userProfile: home,
        fetch: downFetch,
        sleep: noSleep,
      }),
    ).rejects.toThrow(/HTTP 503/);

    expect(new U8Store(dataDir, fakeCrypto).pick({ channel: "1" })?.token).toBe(tKeep);
    store.close();
  });

  it("官服(channel=1) 与 B服(channel=2) 持久化凭据相互隔离，单个过期不影响另一个", async () => {
    const tmp = mkTempDir();
    const dataDir = path.join(tmp, "data");
    const cacheOff = path.join(tmp, "cache-off");
    const cacheBili = path.join(tmp, "cache-bili");
    const home = path.join(tmp, "Profile");
    const store = GachaStore.open(":memory:");

    const tOff = fakeToken("chan-1-official");
    const tBili = fakeToken("chan-2-bili");
    buildBlockfileCache(cacheOff, [
      {
        url: `https://ef-webview.hypergryph.com/page/gacha_char?channel=1&subChannel=1&platform=Windows&lang=zh-cn&server=1&u8_token=${encodeURIComponent(tOff)}`,
        creationMs: 1000,
        lastUsedMs: 1000,
      },
    ]);
    buildBlockfileCache(cacheBili, [
      {
        url: `https://ef-webview.hypergryph.com/page/gacha_char?channel=2&subChannel=2&platform=Windows&lang=zh-cn&server=1&u8_token=${encodeURIComponent(tBili)}`,
        creationMs: 2000,
        lastUsedMs: 2000,
      },
    ]);

    const srvOff = createFakeServer(mkServerData(tOff, { seq: 10, uid: "UID_OFF", roleId: "ROLE_OFF" }));
    const srvBili = createFakeServer(mkServerData(tBili, { seq: 20, uid: "UID_BILI", roleId: "ROLE_BILI" }));

    await syncFromCache({
      store,
      dataDir,
      crypto: fakeCrypto,
      extraDirs: [cacheOff, cacheBili],
      localAppData: path.join(tmp, "EmptyLocal"),
      userProfile: home,
      filter: { channel: "1" },
      fetch: srvOff.fetch,
      sleep: noSleep,
    });
    await syncFromCache({
      store,
      dataDir,
      crypto: fakeCrypto,
      extraDirs: [cacheOff, cacheBili],
      localAppData: path.join(tmp, "EmptyLocal"),
      userProfile: home,
      filter: { channel: "2" },
      fetch: srvBili.fetch,
      sleep: noSleep,
    });

    const u8 = new U8Store(dataDir, fakeCrypto);
    expect(u8.list().map((e) => e.id).sort()).toEqual(["cn:1", "cn:2"]);

    // 清空磁盘缓存后，让官服过期（40100），应只删 cn:1，cn:2 仍可复用
    fs.rmSync(cacheOff, { recursive: true, force: true });
    fs.rmSync(cacheBili, { recursive: true, force: true });

    const srvOffRejected = createFakeServer(mkServerData(fakeToken("other-off")));
    await expect(
      syncFromCache({
        store,
        dataDir,
        crypto: fakeCrypto,
        localAppData: path.join(tmp, "EmptyLocal"),
        userProfile: home,
        filter: { channel: "1" },
        fetch: srvOffRejected.fetch,
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(CredentialExpiredError);

    expect(u8.list().map((e) => e.id)).toEqual(["cn:2"]);
    const resBili = await syncFromCache({
      store,
      dataDir,
      crypto: fakeCrypto,
      localAppData: path.join(tmp, "EmptyLocal"),
      userProfile: home,
      filter: { channel: "2" },
      fetch: srvBili.fetch,
      sleep: noSleep,
    });
    expect(resBili.account.channelMasterId).toBe("2");
    expect(resBili.report.ok).toBe(true);
    store.close();
  });

  it("持久化加密失败时不阻断已完成的同步结果", async () => {
    const tmp = mkTempDir();
    const dataDir = path.join(tmp, "data");
    const local = path.join(tmp, "Local");
    const home = path.join(tmp, "Profile");
    const store = GachaStore.open(":memory:");

    const t = fakeToken("crypto-fail-save");
    writeCacheEntry(local, [{ token: t, channel: "2", subChannel: "2", ts: 1000 }]);

    const brokenCrypto: SecretCrypto = {
      encrypt: () => {
        throw new Error(`DPAPI unavailable for ${t}`);
      },
      decrypt: fakeCrypto.decrypt,
    };
    const srv = createFakeServer(mkServerData(t));
    const logs: string[] = [];

    const res = await syncFromCache({
      store,
      dataDir,
      crypto: brokenCrypto,
      localAppData: local,
      userProfile: home,
      fetch: srv.fetch,
      sleep: noSleep,
      onProgress: (m) => logs.push(m),
    });
    expect(res.report.ok).toBe(true);
    expect(logs.some((l) => l.includes("保存本地抽卡凭据失败"))).toBe(true);
    expect(logs.every((l) => !l.includes(t))).toBe(true);
    store.close();
  });

  it("CLI sync 退出码：NoCredentialError 与 CredentialExpiredError 均返回 2", async () => {
    const tmp = mkTempDir();
    const dataDir = path.join(tmp, "data");
    const local = path.join(tmp, "Local");
    const home = path.join(tmp, "Profile");
    vi.stubEnv("LOCALAPPDATA", local);
    vi.stubEnv("USERPROFILE", home);

    const syncCmd = COMMANDS.find((c) => c.name === "sync")!;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // 1. 无凭据 -> 退出码 2
    const codeNoCred = await syncCmd.run(makeContext(["sync", "--data-dir", dataDir]));
    expect(codeNoCred).toBe(2);

    // 2. 缓存凭据 40100 -> 退出码 2
    const tExpired = fakeToken("cli-expired");
    writeCacheEntry(local, [{ token: tExpired, channel: "2", subChannel: "2", ts: 1000 }]);
    const srv = createFakeServer(mkServerData(fakeToken("cli-server-other")));
    vi.stubGlobal("fetch", srv.fetch);

    const codeExpired = await syncCmd.run(makeContext(["sync", "--data-dir", dataDir]));
    expect(codeExpired).toBe(2);
    expect(errSpy.mock.calls.some((args) => String(args[0]).includes("40100"))).toBe(true);
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("Server /api/sync 传递 dataDir，在持久化凭据失效时返回脱敏后的 40100 错误提示", async () => {
    const tmp = mkTempDir();
    const dataDir = path.join(tmp, "data");
    const cacheDir = path.join(tmp, "cache");
    const tExpired = fakeToken("srv-expired");
    buildBlockfileCache(cacheDir, [
      {
        url: `https://ef-webview.hypergryph.com/page/gacha_char?channel=2&subChannel=2&platform=Windows&lang=zh-cn&server=1&u8_token=${encodeURIComponent(tExpired)}`,
        creationMs: 1000,
        lastUsedMs: 1000,
      },
    ]);

    const srv = createFakeServer(mkServerData(fakeToken("srv-other")));
    const store = GachaStore.open(dataDir);
    const app = createApp({
      dataDir,
      webDir: mkTempDir("beg-ra-web-"),
      deps: { store, fetch: srv.fetch, sleep: noSleep, cacheDiscover: { extraDirs: [cacheDir] } },
    });
    const base = (await app.listen()).split("#")[0]!.replace(/\/$/, "");
    try {
      const start = await fetch(`${base}/api/sync`, {
        method: "POST",
        headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "cache", channel: "2" }),
      });
      expect(start.status).toBe(200);
      const { jobId } = (await start.json()) as { jobId: string };

      let job: any;
      for (let i = 0; i < 60; i++) {
        const jr = await fetch(`${base}/api/jobs/${jobId}`, { headers: { "X-BEG-Key": app.key } });
        job = await jr.json();
        if (job.state !== "running") break;
        await new Promise((r) => setTimeout(r, 15));
      }
      expect(job.state).toBe("error");
      expect(job.error).toContain("40100");
      expect(job.error).toContain("路线 B");
      expect(job.error).not.toContain(tExpired);
    } finally {
      await app.close();
      store.close();
    }
  });
});

describe.skipIf(process.platform !== "win32")("路线 A 持久化（Windows 真实 DPAPI 往返）", () => {
  it("不注入 crypto 时通过 DPAPI 加密 u8_token，删除缓存后可复用同步", async () => {
    const tmp = mkTempDir("beg-ra-dpapi-");
    const dataDir = path.join(tmp, "data");
    const local = path.join(tmp, "Local");
    const home = path.join(tmp, "Profile");
    const store = GachaStore.open(dataDir);

    const t = fakeToken("win-dpapi-real");
    writeCacheEntry(local, [{ token: t, channel: "2", subChannel: "2", ts: Date.UTC(2026, 10, 26) }]);
    const srv1 = createFakeServer(mkServerData(t, { seq: 30 }));

    try {
      const res1 = await syncFromCache({
        store,
        dataDir,
        localAppData: local,
        userProfile: home,
        fetch: srv1.fetch,
        sleep: noSleep,
      });
      expect(res1.report.ok).toBe(true);

      const file = path.join(dataDir, "u8-cache.json");
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file, "utf8")).not.toContain(t);

      // 删除缓存后再次同步，走真实 DPAPI 解密复用
      fs.rmSync(local, { recursive: true, force: true });
      const data2 = mkServerData(t, { seq: 30 });
      data2.char[SP] = [makeChar(31, 6, "special_1_0_1", "春雷动"), ...data2.char[SP]!];
      const srv2 = createFakeServer(data2);
      const logs: string[] = [];

      const res2 = await syncFromCache({
        store,
        dataDir,
        localAppData: local,
        userProfile: home,
        fetch: srv2.fetch,
        sleep: noSleep,
        onProgress: (m) => logs.push(m),
      });
      expect(res2.report.ok).toBe(true);
      expect(res2.report.totalAdded).toBe(1);
      expect(logs.some((l) => l.includes("复用本地保存的抽卡凭据"))).toBe(true);
    } finally {
      store.close();
    }
  }, 15_000);

  it("CLI sync 传递 dataDir 后可通过真实 DPAPI 持久化并复用凭据", async () => {
    const tmp = mkTempDir("beg-ra-cli-dpapi-");
    const cliDataDir = path.join(tmp, "cli-data");
    const local = path.join(tmp, "Local");
    const home = path.join(tmp, "Profile");
    vi.stubEnv("LOCALAPPDATA", local);
    vi.stubEnv("USERPROFILE", home);

    const tCli = fakeToken("win-cli-persist");
    writeCacheEntry(local, [{ token: tCli, channel: "2", subChannel: "2", ts: 1000 }]);
    const srvCli = createFakeServer(mkServerData(tCli, { seq: 40 }));
    vi.stubGlobal("fetch", srvCli.fetch);

    const syncCmd = COMMANDS.find((c) => c.name === "sync")!;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await syncCmd.run(makeContext(["sync", "--data-dir", cliDataDir]))).toBe(0);
      expect(fs.existsSync(path.join(cliDataDir, "u8-cache.json"))).toBe(true);

      // 清空缓存后 CLI sync 仍能通过 u8-cache.json 成功
      fs.rmSync(local, { recursive: true, force: true });
      expect(await syncCmd.run(makeContext(["sync", "--data-dir", cliDataDir]))).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  }, 15_000);

  it("Server /api/sync 传递 dataDir 后可通过真实 DPAPI 持久化并复用凭据", async () => {
    const tmp = mkTempDir("beg-ra-srv-dpapi-");
    const srvDataDir = path.join(tmp, "srv-data");
    const cacheDir = path.join(tmp, "srv-cache");
    const tSrv = fakeToken("win-srv-persist");
    buildBlockfileCache(cacheDir, [
      {
        url: `https://ef-webview.hypergryph.com/page/gacha_char?channel=2&subChannel=2&platform=Windows&lang=zh-cn&server=1&u8_token=${encodeURIComponent(tSrv)}`,
        creationMs: 2000,
        lastUsedMs: 2000,
      },
    ]);
    const srvApi = createFakeServer(mkServerData(tSrv, { seq: 50 }));
    const store = GachaStore.open(srvDataDir);
    const app = createApp({
      dataDir: srvDataDir,
      webDir: mkTempDir("beg-ra-e2e-web-"),
      deps: { store, fetch: srvApi.fetch, sleep: noSleep, cacheDiscover: { extraDirs: [cacheDir] } },
    });
    const base = (await app.listen()).split("#")[0]!.replace(/\/$/, "");
    try {
      const runJob = async () => {
        const res = await fetch(`${base}/api/sync`, {
          method: "POST",
          headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "cache", channel: "2" }),
        });
        expect(res.status).toBe(200);
        const { jobId } = (await res.json()) as { jobId: string };
        for (let i = 0; i < 100; i++) {
          const jr = await fetch(`${base}/api/jobs/${jobId}`, { headers: { "X-BEG-Key": app.key } });
          const j = (await jr.json()) as { state: string; progress: string[]; result?: { items: Array<{ ok: boolean }> } };
          if (j.state !== "running") return j;
          await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error("job timeout");
      };

      const j1 = await runJob();
      expect(j1.state).toBe("done");
      expect(fs.existsSync(path.join(srvDataDir, "u8-cache.json"))).toBe(true);

      fs.rmSync(cacheDir, { recursive: true, force: true });
      const j2 = await runJob();
      expect(j2.state).toBe("done");
      expect(j2.progress.some((p) => p.includes("复用本地保存的抽卡凭据"))).toBe(true);
    } finally {
      await app.close();
      store.close();
    }
  }, 15_000);
});
