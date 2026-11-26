import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMANDS } from "../src/cli/commands/index.js";
import { makeContext } from "../src/cli/context.js";
import { maskKey as cliMaskKey } from "../src/cli/util.js";
import type { AccountAnalysis } from "../src/core/analysis/types.js";
import { parseHyTokenInput } from "../src/core/auth/passport.js";
import { Vault } from "../src/core/auth/vault.js";
import { maskKey as coreMaskKey } from "../src/core/mask.js";
import { GachaStore } from "../src/core/storage/store.js";
import { buildAccountKey, type AccountRow, type GachaRecord } from "../src/core/types.js";
import { HttpError } from "../src/server/http.js";
import { createApp } from "../src/server/index.js";
import { JobManager } from "../src/server/jobs.js";
import { VERSION } from "../src/version.js";
import lcxSample from "./fixtures/io/lcx-sample.json" with { type: "json" };
import analysisFixture from "./fixtures/server/analysis.json" with { type: "json" };
import accountsFixture from "./fixtures/server/accounts.json" with { type: "json" };
import recordsFixture from "./fixtures/server/records.json" with { type: "json" };
import { buildBlockfileCache, fakeToken } from "./helpers/blockfile-builder.js";
import { combineFetch } from "./helpers/combine-fetch.js";
import { createFakeServer, makeChar, makeWeapon } from "./helpers/fake-ef-server.js";
import { createFakePassport } from "./helpers/fake-passport.js";

const tempDirs: string[] = [];
const cleanups: Array<() => Promise<void> | void> = [];
const trackedStores = new Set<GachaStore>();

function mkTempDir(prefix = "beg-w3-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function mkAccount(overrides: Partial<AccountRow> = {}): AccountRow {
  const region = overrides.region ?? "cn";
  const channelMasterId = overrides.channelMasterId ?? "2";
  const bindingUid = overrides.bindingUid ?? "SYNTH_UID_9001";
  const roleId = overrides.roleId ?? "SYNTH_ROLE_7001";
  return {
    region,
    channelMasterId,
    bindingUid,
    roleId,
    accountKey: buildAccountKey({ region, channelMasterId, bindingUid, roleId }),
    nickname: "SyntheticTester",
    serverId: "1",
    serverName: "China",
    channelName: "bilibili服",
    source: "cache",
    updatedAt: 1_760_000_000_000,
    ...overrides,
  };
}

function mkRecord(seq: number, overrides: Partial<GachaRecord> = {}): GachaRecord {
  return {
    type: "char",
    feed: "char:E_CharacterGachaPoolType_Special",
    poolType: "E_CharacterGachaPoolType_Special",
    poolId: "special_synth_1",
    poolName: "合成限定池",
    itemId: `chr_4_${seq}`,
    itemName: `合成角色${seq}`,
    itemSubType: "",
    rarity: 4,
    isFree: false,
    isNew: false,
    gachaTs: String(1_760_000_000_000 + seq * 1000),
    seqId: String(seq),
    kind: "draw",
    ...overrides,
  };
}

async function rawRequest(
  port: number,
  reqPath: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: reqPath,
        method: opts.method ?? "GET",
        headers: opts.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

function createMemoryApp(opts: Parameters<typeof createApp>[0] extends infer T ? Partial<T> : never = {}) {
  const ownedStore = !opts.deps?.store;
  const store = opts.deps?.store ?? GachaStore.open(":memory:");
  if (!ownedStore && !trackedStores.has(store)) {
    trackedStores.add(store);
    cleanups.push(() => {
      trackedStores.delete(store);
      store.close();
    });
  }
  const app = createApp({
    dataDir: opts.dataDir ?? ":memory:",
    webDir: opts.webDir ?? mkTempDir("beg-w3-emptyweb-"),
    key: opts.key,
    deps: {
      store,
      ...opts.deps,
    },
  });
  cleanups.push(async () => {
    await app.close();
    if (ownedStore) {
      store.close();
    }
  });
  return { app, store };
}

beforeEach(() => {
  const sandboxEnv = mkTempDir("beg-w3-env-");
  vi.stubEnv("LOCALAPPDATA", path.join(sandboxEnv, "Local"));
  vi.stubEnv("USERPROFILE", path.join(sandboxEnv, "Profile"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("W3 local HTTP server", () => {
  it("1. 密钥校验：无密钥 401、错密钥（含不同长度）401、正确密钥 200，且绝不返回 CORS 允许头", async () => {
    const { app } = createMemoryApp();
    const url = await app.listen();
    const base = url.split("#")[0]!.replace(/\/$/, "");

    const rNoKey = await fetch(`${base}/api/health`);
    expect(rNoKey.status).toBe(401);
    expect(rNoKey.headers.get("access-control-allow-origin")).toBeNull();

    const rShort = await fetch(`${base}/api/health`, { headers: { "X-BEG-Key": "short" } });
    expect(rShort.status).toBe(401);

    const rSameLen = await fetch(`${base}/api/health`, { headers: { "X-BEG-Key": "x".repeat(app.key.length) } });
    expect(rSameLen.status).toBe(401);

    const rOk = await fetch(`${base}/api/health`, { headers: { "X-BEG-Key": app.key } });
    expect(rOk.status).toBe(200);
    expect(await rOk.json()).toEqual({ ok: true, version: VERSION });
    expect(rOk.headers.get("access-control-allow-origin")).toBeNull();
    expect(rOk.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("2. Host 校验：非法 Host 返回 403，localhost:<port> 允许", async () => {
    const { app } = createMemoryApp();
    await app.listen();

    const bad = await rawRequest(app.port, "/api/health", {
      headers: { Host: "evil.example.com", "X-BEG-Key": app.key },
    });
    expect(bad.status).toBe(403);

    const okLocalhost = await rawRequest(app.port, "/api/health", {
      headers: { Host: `localhost:${app.port}`, "X-BEG-Key": app.key },
    });
    expect(okLocalhost.status).toBe(200);
  });

  it("3. Origin 校验：跨源或 null Origin 返回 403，同源允许", async () => {
    const { app } = createMemoryApp();
    const url = await app.listen();
    const base = url.split("#")[0]!.replace(/\/$/, "");

    const rEvil = await fetch(`${base}/api/health`, {
      headers: { "X-BEG-Key": app.key, Origin: "http://evil.example.com" },
    });
    expect(rEvil.status).toBe(403);

    const rNullOrigin = await fetch(`${base}/api/health`, {
      headers: { "X-BEG-Key": app.key, Origin: "null" },
    });
    expect(rNullOrigin.status).toBe(403);

    const rSame = await fetch(`${base}/api/health`, {
      headers: { "X-BEG-Key": app.key, Origin: `http://127.0.0.1:${app.port}` },
    });
    expect(rSame.status).toBe(200);
  });

  it("4. Content-Type 校验：非 GET/HEAD 请求非 application/json 返回 415", async () => {
    const { app } = createMemoryApp();
    const url = await app.listen();
    const base = url.split("#")[0]!.replace(/\/$/, "");

    const rText = await fetch(`${base}/api/sync`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "text/plain" },
      body: JSON.stringify({ mode: "cache" }),
    });
    expect(rText.status).toBe(415);

    const rDel = await fetch(`${base}/api/passport/vault`, {
      method: "DELETE",
      headers: { "X-BEG-Key": app.key },
    });
    expect(rDel.status).toBe(415);
  });

  it("5. 体积限制：普通接口 100 KB 返回 413，/api/import 允许 > 1 MB 请求体", async () => {
    const tmpDir = mkTempDir();
    const { app } = createMemoryApp({ dataDir: tmpDir });
    const url = await app.listen();
    const base = url.split("#")[0]!.replace(/\/$/, "");

    const payload100k = JSON.stringify({ pad: "a".repeat(100 * 1024) });
    const rTooLarge = await fetch(`${base}/api/link`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: payload100k,
    });
    expect(rTooLarge.status).toBe(413);

    const acc = mkAccount();
    const manyRecords = Array.from({ length: 4500 }, (_, i) => mkRecord(i + 1));
    const v1Text = JSON.stringify({
      format: "better-endfield-gacha/v1",
      accounts: [{ ...acc, records: manyRecords }],
    });
    expect(Buffer.byteLength(v1Text, "utf8")).toBeGreaterThan(1024 * 1024);

    const rImportBig = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ text: v1Text, apply: false }),
    });
    expect(rImportBig.status).toBe(200);
    const body = (await rImportBig.json()) as { plans: Array<{ total: number; added: number }>; applied: boolean };
    expect(body.applied).toBe(false);
    expect(body.plans[0]?.total).toBe(4500);
    expect(body.plans[0]?.added).toBe(4500);
  });

  it("6. 绑定地址恒为 127.0.0.1，listen URL 仅通过 #k= fragment 传递密钥", async () => {
    const { app } = createMemoryApp();
    const url = await app.listen();
    const addr = app.server.address() as AddressInfo;
    expect(addr.address).toBe("127.0.0.1");
    expect(url).toBe(`http://127.0.0.1:${addr.port}/#k=${app.key}`);
    expect(new URL(url).search).toBe("");
  });

  it("7. 静态托管：index、防路径穿越、404 静态资源、SPA 回退及安全响应头", async () => {
    const outerDir = mkTempDir("beg-w3-static-");
    const webDir = path.join(outerDir, "dist-web");
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(path.join(outerDir, "secret.txt"), "TOP_SECRET_OUTSIDE_WEBROOT", "utf8");
    fs.writeFileSync(path.join(webDir, "index.html"), "<!doctype html><title>BEG</title>", "utf8");

    const { app } = createMemoryApp({ webDir });
    const url = await app.listen();
    const base = url.split("#")[0]!.replace(/\/$/, "");

    const rIndex = await fetch(`${base}/`);
    expect(rIndex.status).toBe(200);
    expect(await rIndex.text()).toContain("BEG");
    expect(rIndex.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(rIndex.headers.get("x-content-type-options")).toBe("nosniff");
    expect(rIndex.headers.get("referrer-policy")).toBe("no-referrer");
    expect(rIndex.headers.get("x-frame-options")).toBe("DENY");

    const rHead = await fetch(`${base}/`, { method: "HEAD" });
    expect(rHead.status).toBe(200);
    expect(await rHead.text()).toBe("");

    const rTrav1 = await rawRequest(app.port, "/../secret.txt", { headers: { Host: `127.0.0.1:${app.port}` } });
    expect(rTrav1.status).toBe(404);
    expect(rTrav1.text).not.toContain("TOP_SECRET_OUTSIDE_WEBROOT");

    const rTrav2 = await rawRequest(app.port, "/%2e%2e/secret.txt", { headers: { Host: `127.0.0.1:${app.port}` } });
    expect(rTrav2.status).toBe(404);

    const rTrav3 = await rawRequest(app.port, "/%5c..%5csecret.txt", { headers: { Host: `127.0.0.1:${app.port}` } });
    expect(rTrav3.status).toBe(404);

    const rMissingAsset = await fetch(`${base}/nope.js`);
    expect(rMissingAsset.status).toBe(404);

    const rSpa = await fetch(`${base}/some/route`);
    expect(rSpa.status).toBe(200);
    expect(await rSpa.text()).toContain("BEG");
  });

  it("8. 不泄露凭据：/api/cache/scan、/api/link（无 reveal）与 /api/jobs/:id 不含 token 明文；reveal:true 才返回", async () => {
    const cacheRoot = mkTempDir("beg-w3-cache-");
    const token = fakeToken("w3-secret-8");
    const now = 1_760_000_000_000;
    buildBlockfileCache(cacheRoot, [
      {
        url: `https://ef-webview.hypergryph.com/page/gacha_char?channel=2&subChannel=2&platform=Windows&lang=zh-cn&server=1&u8_token=${encodeURIComponent(token)}`,
        creationMs: now,
        lastUsedMs: now + 1000,
      },
    ]);

    const fakeSrv = createFakeServer({
      token,
      char: {
        E_CharacterGachaPoolType_Special: [makeChar(1, 6, "pool_sp_1", "特许一")],
        E_CharacterGachaPoolType_Standard: [],
      },
      weaponPools: [],
      weapon: {},
    });

    const { app } = createMemoryApp({
      deps: { fetch: fakeSrv.fetch, cacheDiscover: { extraDirs: [cacheRoot] } },
    });
    const url = await app.listen();
    const base = url.split("#")[0]!.replace(/\/$/, "");

    const scanRes = await fetch(`${base}/api/cache/scan`, { headers: { "X-BEG-Key": app.key } });
    expect(scanRes.status).toBe(200);
    const scanText = await scanRes.text();
    expect(scanText).not.toContain(token);
    expect(scanText).not.toContain(encodeURIComponent(token));

    const linkMaskedRes = await fetch(`${base}/api/link`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ page: "char", channel: "2" }),
    });
    expect(linkMaskedRes.status).toBe(200);
    const linkMaskedText = await linkMaskedRes.text();
    expect(linkMaskedText).not.toContain(token);
    const linkMaskedJson = JSON.parse(linkMaskedText) as { masked: string; link?: string };
    expect(linkMaskedJson.masked).toContain("<LEN=328, SHA256_PREFIX=");
    expect(linkMaskedJson.link).toBeUndefined();

    const linkRevealRes = await fetch(`${base}/api/link`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ page: "char", channel: "2", reveal: true }),
    });
    expect(linkRevealRes.status).toBe(200);
    const linkRevealJson = (await linkRevealRes.json()) as { link?: string };
    expect(linkRevealJson.link).toBeDefined();
    expect(linkRevealJson.link).toContain(encodeURIComponent(token));
  });

  it("9. 同步任务：缓存同步轮询至 done 且 feeds 非空，并发同步返回 409，错误日志自动脱敏", async () => {
    const cacheRoot = mkTempDir("beg-w3-sync-");
    const token = fakeToken("w3-sync-9");
    const now = 1_760_000_000_000;
    buildBlockfileCache(cacheRoot, [
      {
        url: `https://ef-webview.hypergryph.com/page/gacha_char?channel=2&subChannel=2&platform=Windows&lang=zh-cn&server=1&u8_token=${encodeURIComponent(token)}`,
        creationMs: now,
        lastUsedMs: now + 500,
      },
    ]);

    let releaseFetch!: () => void;
    const gate = new Promise<void>((r) => {
      releaseFetch = r;
    });

    const baseFake = createFakeServer({
      token,
      char: {
        E_CharacterGachaPoolType_Special: [makeChar(101, 6, "pool_sp_1", "合成特许一"), makeChar(100, 4, "pool_sp_1", "合成特许一")],
        E_CharacterGachaPoolType_Standard: [],
      },
      weaponPools: [{ poolId: "wpn_pool_1", poolName: "合成武器箱", poolType: "special" }],
      weapon: {
        wpn_pool_1: [makeWeapon(201, 5, "wpn_pool_1")],
      },
    });

    let gated = false;
    const slowFetch: typeof fetch = async (input, init) => {
      if (!gated) {
        gated = true;
        await gate;
      }
      return baseFake.fetch(input, init);
    };

    const { app, store } = createMemoryApp({
      deps: { fetch: slowFetch, sleep: async () => {}, cacheDiscover: { extraDirs: [cacheRoot] } },
    });
    const url = await app.listen();
    const base = url.split("#")[0]!.replace(/\/$/, "");

    const startRes = await fetch(`${base}/api/sync`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "cache", channel: "2" }),
    });
    expect(startRes.status).toBe(200);
    const { jobId } = (await startRes.json()) as { jobId: string };
    expect(jobId).toBeTruthy();

    // 运行中再次触发 → 409
    const dupRes = await fetch(`${base}/api/sync`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "cache" }),
    });
    expect(dupRes.status).toBe(409);

    releaseFetch();

    // 轮询直到 done
    let job: any;
    for (let i = 0; i < 60; i++) {
      const jr = await fetch(`${base}/api/jobs/${jobId}`, { headers: { "X-BEG-Key": app.key } });
      expect(jr.status).toBe(200);
      job = await jr.json();
      if (job.state !== "running") break;
      await new Promise((r) => setTimeout(r, 15));
    }

    expect(job.state).toBe("done");
    expect(job.result.items).toHaveLength(1);
    expect(job.result.items[0].feeds.length).toBeGreaterThan(0);
    const jobText = JSON.stringify(job);
    expect(jobText).not.toContain(token);
    expect(jobText).not.toContain("SYNTH");
    expect(store.listAccounts()).toHaveLength(1);

    // 验证 /api/accounts 返回 maskedKey
    const accRes = await fetch(`${base}/api/accounts`, { headers: { "X-BEG-Key": app.key } });
    expect(accRes.status).toBe(200);
    const accs = (await accRes.json()) as Array<{ maskedKey: string; counts: { draws: number } }>;
    expect(accs).toHaveLength(1);
    expect(accs[0]?.maskedKey).toMatch(/^cn_2_#[0-9a-f]{8}$/);
    expect(accs[0]?.counts.draws).toBe(3);

    // JobManager 直接脱敏验证（含 token= 与 u8_token=）
    const jm = new JobManager();
    const errJob = jm.start("sync", async (log) => {
      log(`progress https://ef-webview.hypergryph.com/api/record/char?u8_token=${token}`);
      throw new Error(`request failed at https://x.invalid?token=${token}`);
    });
    await new Promise((r) => setTimeout(r, 20));
    const finished = jm.get(errJob.id)!;
    expect(finished.state).toBe("error");
    expect(finished.progress[0]).not.toContain(token);
    expect(finished.error).not.toContain(token);
    expect(finished.error).toContain("<redacted>");
  });

  it("10. 分析接口：账号不存在 404，存在返回分析对象（真实引擎与注入覆盖），501 透传", async () => {
    const store = GachaStore.open(":memory:");
    const acc = mkAccount();
    store.upsertAccount(acc);
    store.insertRecords(acc.accountKey, [
      mkRecord(1, { rarity: 6, itemId: "chr_6_1", itemName: "合成六星" }),
      mkRecord(2, { rarity: 4, itemId: "chr_4_2", itemName: "合成四星" }),
    ]);

    // 默认接入真实 W1 analyzeAccount
    const { app: realApp } = createMemoryApp({ deps: { store } });
    const realBase = (await realApp.listen()).split("#")[0]!.replace(/\/$/, "");

    const r404 = await fetch(`${realBase}/api/accounts/nonexistent_key/analysis`, { headers: { "X-BEG-Key": realApp.key } });
    expect(r404.status).toBe(404);

    const rReal = await fetch(`${realBase}/api/accounts/${encodeURIComponent(acc.accountKey)}/analysis`, {
      headers: { "X-BEG-Key": realApp.key },
    });
    expect(rReal.status).toBe(200);
    const realAnalysis = (await rReal.json()) as AccountAnalysis;
    expect(realAnalysis.accountKey).toBe(acc.accountKey);
    expect(realAnalysis.overview.limited.total).toBe(2);
    expect(realAnalysis.overview.limited.count6).toBe(1);

    // 注入 fake 对象与 501 测试
    let mode: "fake" | "501" = "fake";
    const { app: injApp } = createMemoryApp({
      deps: {
        store,
        analysis: () => {
          if (mode === "501") throw new HttpError(501, "分析引擎未接入", "not_implemented");
          return analysisFixture;
        },
      },
    });
    const injBase = (await injApp.listen()).split("#")[0]!.replace(/\/$/, "");

    const rFake = await fetch(`${injBase}/api/accounts/${encodeURIComponent(acc.accountKey)}/analysis`, {
      headers: { "X-BEG-Key": injApp.key },
    });
    expect(rFake.status).toBe(200);
    expect(await rFake.json()).toEqual(analysisFixture);

    mode = "501";
    const r501 = await fetch(`${injBase}/api/accounts/${encodeURIComponent(acc.accountKey)}/analysis`, {
      headers: { "X-BEG-Key": injApp.key },
    });
    expect(r501.status).toBe(501);
  });

  it("11. records 分页：limit 上限 1000、offset 生效、feed/type 过滤生效", async () => {
    const store = GachaStore.open(":memory:");
    const acc = mkAccount();
    store.upsertAccount(acc);

    const charRecs = Array.from({ length: 1005 }, (_, i) => mkRecord(i + 1));
    const wpnRecs = Array.from({ length: 5 }, (_, i) =>
      mkRecord(2000 + i, {
        type: "weapon",
        feed: "weapon:wpn_box_1",
        poolType: "special",
        poolId: "wpn_box_1",
        poolName: "合成武器箱",
        itemId: `wpn_${i}`,
        itemName: `合成武器${i}`,
        itemSubType: "sword",
      }),
    );
    store.insertRecords(acc.accountKey, [...charRecs, ...wpnRecs]);

    const { app } = createMemoryApp({ deps: { store } });
    const base = (await app.listen()).split("#")[0]!.replace(/\/$/, "");

    // limit=5000 被钳位到 1000
    const rMax = await fetch(`${base}/api/accounts/${encodeURIComponent(acc.accountKey)}/records?limit=5000`, {
      headers: { "X-BEG-Key": app.key },
    });
    expect(rMax.status).toBe(200);
    const maxData = (await rMax.json()) as { total: number; items: GachaRecord[] };
    expect(maxData.total).toBe(1010);
    expect(maxData.items).toHaveLength(1000);

    // feed 过滤 + offset/limit
    const rFeed = await fetch(
      `${base}/api/accounts/${encodeURIComponent(acc.accountKey)}/records?feed=${encodeURIComponent("weapon:wpn_box_1")}&limit=2&offset=2`,
      { headers: { "X-BEG-Key": app.key } },
    );
    expect(rFeed.status).toBe(200);
    const feedData = (await rFeed.json()) as { total: number; items: GachaRecord[] };
    expect(feedData.total).toBe(5);
    expect(feedData.items.map((x) => x.seqId)).toEqual(["2002", "2003"]);
  });

  it("12. 错误处理：普通 Error 返回 500 且绝不泄露堆栈信息", async () => {
    const store = GachaStore.open(":memory:");
    const acc = mkAccount();
    store.upsertAccount(acc);

    const { app } = createMemoryApp({
      deps: {
        store,
        analysis: () => {
          throw new Error("INTERNAL_DB_FAILURE_SHOULD_NOT_LEAK");
        },
      },
    });
    const base = (await app.listen()).split("#")[0]!.replace(/\/$/, "");

    const res = await fetch(`${base}/api/accounts/${encodeURIComponent(acc.accountKey)}/analysis`, {
      headers: { "X-BEG-Key": app.key },
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("at ");
    expect(text).not.toContain("INTERNAL_DB_FAILURE_SHOULD_NOT_LEAK");
    expect(JSON.parse(text)).toEqual({ error: "internal", message: "服务器内部错误" });
  });

  it("13. 导入干跑/落库、导出 JSON/CSV 与备份接口", async () => {
    const dataDir = mkTempDir("beg-w3-io-");
    const store = GachaStore.open(dataDir);
    const acc = mkAccount();
    const v1Doc = {
      format: "better-endfield-gacha/v1",
      accounts: [
        {
          ...acc,
          records: [
            mkRecord(1, { rarity: 6, itemId: "chr_6_1", itemName: "合成六星" }),
            mkRecord(2, { rarity: 0, itemId: "", itemName: "寻访情报书", kind: "gift_intel_book" }),
          ],
        },
      ],
    };

    const { app } = createMemoryApp({ dataDir, deps: { store } });
    const base = (await app.listen()).split("#")[0]!.replace(/\/$/, "");

    // 干跑 apply: false
    const dryRes = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ text: JSON.stringify(v1Doc), apply: false }),
    });
    expect(dryRes.status).toBe(200);
    const dryJson = (await dryRes.json()) as { applied: boolean; plans: Array<{ added: number; maskedKey: string }> };
    expect(dryJson.applied).toBe(false);
    expect(dryJson.plans[0]?.added).toBe(2);
    expect(dryJson.plans[0]?.maskedKey).toMatch(/^cn_2_#[0-9a-f]{8}$/);
    expect(store.listAccounts()).toHaveLength(0);

    // 落库 apply: true
    const applyRes = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ text: JSON.stringify(v1Doc), apply: true }),
    });
    expect(applyRes.status).toBe(200);
    const applyJson = (await applyRes.json()) as { applied: boolean; backup?: string; plans: Array<{ added: number }> };
    expect(applyJson.applied).toBe(true);
    expect(applyJson.plans[0]?.added).toBe(2);
    expect(applyJson.backup).toMatch(/^gacha-\d{8}-\d{6}.*\.sqlite$/);
    expect(store.getRecords(acc.accountKey)).toHaveLength(2);
    expect(fs.existsSync(path.join(dataDir, "backups", applyJson.backup!))).toBe(true);

    // 导出 JSON 与 CSV
    const expJsonRes = await fetch(`${base}/api/export?account=${encodeURIComponent(acc.accountKey)}&format=json`, {
      headers: { "X-BEG-Key": app.key },
    });
    expect(expJsonRes.status).toBe(200);
    expect(expJsonRes.headers.get("content-disposition")).toContain("beg-export.json");
    const expDoc = (await expJsonRes.json()) as { format: string; accounts: Array<{ records: GachaRecord[] }> };
    expect(expDoc.format).toBe("better-endfield-gacha/v1");
    expect(expDoc.accounts[0]?.records).toHaveLength(2);

    const expCsvRes = await fetch(`${base}/api/export?account=${encodeURIComponent(acc.accountKey)}&format=csv`, {
      headers: { "X-BEG-Key": app.key },
    });
    expect(expCsvRes.status).toBe(200);
    expect(expCsvRes.headers.get("content-disposition")).toContain("beg-export.csv");
    const csvText = await expCsvRes.text();
    expect(csvText).toContain("合成六星");
    expect(csvText).not.toContain("寻访情报书"); // 默认过滤 gift

    // 手动备份接口
    const bakRes = await fetch(`${base}/api/backup`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(bakRes.status).toBe(200);
    const bakJson = (await bakRes.json()) as { file: string };
    expect(fs.existsSync(path.join(dataDir, "backups", bakJson.file))).toBe(true);
  });

  it("14. 通行证检查 + vault + 路线 B 同步（合成服务端）", async () => {
    const dataDir = mkTempDir("beg-w3-pp-");
    const store = GachaStore.open(dataDir);
    const hy = "SYNTH_HYTOKEN_1234567890ABCDEF";
    const u8Bili = fakeToken("pp-bili");
    const pp = createFakePassport({
      hytoken: hy,
      bindings: [
        {
          uid: "PP_UID_BILI_1",
          channelMasterId: "2",
          channelName: "bilibili服",
          isDefault: true,
          roles: [{ roleId: "PP_ROLE_BILI_1", nickName: "合成玩家" }],
          u8Token: u8Bili,
        },
      ],
    });
    const ef = createFakeServer({
      token: u8Bili,
      char: {
        E_CharacterGachaPoolType_Special: [makeChar(11, 5, "sp_1", "合成池")],
        E_CharacterGachaPoolType_Standard: [],
      },
      weaponPools: [],
      weapon: {},
      roleList: { uid: "PP_UID_BILI_1", roleId: "PP_ROLE_BILI_1", nickname: "合成玩家" },
    });

    const f = combineFetch(
      { match: (u) => u.hostname.endsWith(".hypergryph.com") && !u.hostname.startsWith("u8.") && !u.hostname.startsWith("ef-webview."), fetch: pp.fetch },
      { match: (u) => u.hostname.startsWith("u8.") || u.hostname.startsWith("ef-webview."), fetch: ef.fetch },
    );

    const { app } = createMemoryApp({ dataDir, deps: { store, fetch: f, sleep: async () => {} } });
    const base = (await app.listen()).split("#")[0]!.replace(/\/$/, "");

    // 先验证 parseHyTokenInput 可解析 JSON 并保存至 Vault
    expect(parseHyTokenInput(JSON.stringify({ status: 0, data: { content: hy } }))).toBe(hy);
    const inspectRes = await fetch(`${base}/api/passport/inspect`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ input: JSON.stringify({ data: { content: hy } }), save: true }),
    });
    expect(inspectRes.status).toBe(200);
    const inspectText = await inspectRes.text();
    expect(inspectText).not.toContain(hy);
    expect(inspectText).not.toContain("PP_UID_BILI_1");
    const inspectJson = JSON.parse(inspectText) as {
      bindings: Array<{ channelMasterId: string; uidFingerprint: string }>;
      vaultId?: string;
    };
    expect(inspectJson.vaultId).toBeTruthy();
    expect(inspectJson.bindings[0]?.channelMasterId).toBe("2");

    const vaultListRes = await fetch(`${base}/api/passport/vault`, { headers: { "X-BEG-Key": app.key } });
    expect(vaultListRes.status).toBe(200);
    const vaultList = (await vaultListRes.json()) as Array<{ id: string; provider: string }>;
    expect(vaultList).toHaveLength(1);
    expect(vaultList[0]?.id).toBe(inspectJson.vaultId);
    expect(new Vault(dataDir).list()).toHaveLength(1);

    // 触发 passport 模式同步
    const syncRes = await fetch(`${base}/api/sync`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "passport", vaultId: inspectJson.vaultId }),
    });
    expect(syncRes.status).toBe(200);
    const { jobId } = (await syncRes.json()) as { jobId: string };

    let job: any;
    for (let i = 0; i < 200; i++) {
      const jr = await fetch(`${base}/api/jobs/${jobId}`, { headers: { "X-BEG-Key": app.key } });
      job = await jr.json();
      if (job.state !== "running") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(job.state).toBe("done");
    expect(job.result.items[0].ok).toBe(true);

    // DELETE vault
    const delRes = await fetch(`${base}/api/passport/vault`, {
      method: "DELETE",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
    });
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ cleared: 1 });
  });

  it("15. 契约夹具与共用模块校验：fixtures 类型一致、maskKey 一致、serve 命令已注册", () => {
    const analysisCheck: AccountAnalysis = analysisFixture as AccountAnalysis;
    expect(analysisCheck.groups.length).toBeGreaterThanOrEqual(4);
    expect(accountsFixture.length).toBeGreaterThanOrEqual(2);
    expect(recordsFixture.items.length).toBe(recordsFixture.total);

    expect(cliMaskKey("cn_2_SYNTH1_ROLE1", false)).toBe(coreMaskKey("cn_2_SYNTH1_ROLE1", false));
    expect(cliMaskKey("cn_2_SYNTH1_ROLE1", true)).toBe("cn_2_SYNTH1_ROLE1");

    expect(COMMANDS.map((c) => c.name)).toContain("serve");
    const ctx = makeContext(["serve", "--port", "17890", "--no-open"]);
    expect(ctx.command).toBe("serve");
    expect(ctx.str("port")).toBe("17890");
    expect(ctx.bool("no-open")).toBe(true);
  });

  it("16. 离愁轩导入 API 与边界防护：lcx poolMap 干跑/落库、静态子资源/405/400/404 与 records order=desc", async () => {
    const dataDir = mkTempDir("beg-w3-lcx-");
    const webDir = mkTempDir("beg-w3-web-");
    fs.mkdirSync(path.join(webDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(webDir, "index.html"), "<!doctype html><title>App</title>", "utf8");
    fs.writeFileSync(path.join(webDir, "assets", "app.js"), "console.log('ok');", "utf8");

    const store = GachaStore.open(dataDir);
    const acc = mkAccount();
    store.upsertAccount(acc);
    store.insertRecords(acc.accountKey, [
      mkRecord(10, { poolId: "special_1_0_1", poolName: "测试特许池", itemId: "chr_6_a", itemName: "六星甲", rarity: 6 }),
      mkRecord(20, { poolId: "special_1_0_1", poolName: "测试特许池", itemId: "chr_4_a", itemName: "四星甲", rarity: 4 }),
    ]);

    const { app } = createMemoryApp({ dataDir, webDir, deps: { store } });
    const base = (await app.listen()).split("#")[0]!.replace(/\/$/, "");

    // 静态子文件与 405 / 非法编码
    const rAsset = await fetch(`${base}/assets/app.js`);
    expect(rAsset.status).toBe(200);
    expect(rAsset.headers.get("content-type")).toContain("text/javascript");
    const rBadUri = await rawRequest(app.port, "/%ZZ", { headers: { Host: `127.0.0.1:${app.port}` } });
    expect(rBadUri.status).toBe(404);
    const rMethod405 = await fetch(`${base}/`, { method: "POST" });
    expect(rMethod405.status).toBe(405);

    // 不存在的 job / records type 筛选 + desc 排序
    const rNoJob = await fetch(`${base}/api/jobs/nonexistent`, { headers: { "X-BEG-Key": app.key } });
    expect(rNoJob.status).toBe(404);
    const rDesc = await fetch(
      `${base}/api/accounts/${encodeURIComponent(acc.accountKey)}/records?type=char&order=desc&limit=1`,
      { headers: { "X-BEG-Key": app.key } },
    );
    expect(rDesc.status).toBe(200);
    const descData = (await rDesc.json()) as { total: number; items: GachaRecord[] };
    expect(descData.total).toBe(2);
    expect(descData.items[0]?.seqId).toBe("20");

    // lcx 缺少 account 返回 400
    const lcxText = JSON.stringify(lcxSample);
    const rNoAcc = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ text: lcxText, format: "lcx", apply: false }),
    });
    expect(rNoAcc.status).toBe(400);

    // lcx 带 poolMap 干跑与落库（测试特许池走本地映射，未登记旧池走 poolMap，测试武器箱进 unresolvedPools）
    const poolMap = {
      未登记旧池: {
        feed: "char:E_CharacterGachaPoolType_Special",
        poolId: "sp_unlisted_1",
        poolType: "E_CharacterGachaPoolType_Special",
      },
    };
    const rLcxDry = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ text: lcxText, account: acc.accountKey, poolMap, apply: false }),
    });
    expect(rLcxDry.status).toBe(200);
    const lcxDryJson = (await rLcxDry.json()) as {
      applied: boolean;
      plans: Array<{ added: number }>;
      unresolvedPools: string[];
      warnings: string[];
    };
    expect(lcxDryJson.applied).toBe(false);
    expect(lcxDryJson.plans[0]?.added).toBe(4);
    expect(lcxDryJson.unresolvedPools).toEqual(["测试武器箱"]);

    const rLcxApply = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ text: lcxText, account: acc.accountKey, poolMap, apply: true }),
    });
    expect(rLcxApply.status).toBe(200);
    const lcxApplyJson = (await rLcxApply.json()) as { applied: boolean; backup?: string; plans: Array<{ added: number }> };
    expect(lcxApplyJson.applied).toBe(true);
    expect(lcxApplyJson.backup).toBeTruthy();
    expect(store.getRecords(acc.accountKey).length).toBe(2 + (lcxApplyJson.plans[0]?.added ?? 0));
  });
});
