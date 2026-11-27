import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMANDS } from "../src/cli/commands/index.js";
import { makeContext } from "../src/cli/context.js";
import { maskKey as cliMaskKey } from "../src/cli/util.js";
import type { AccountAnalysis } from "../src/core/analysis/types.js";
import { parseHyTokenInput } from "../src/core/auth/passport.js";
import { Vault } from "../src/core/auth/vault.js";
import { maskKey as coreMaskKey } from "../src/core/mask.js";
import { fingerprint } from "../src/core/redact.js";
import { GachaStore } from "../src/core/storage/store.js";
import { buildAccountKey, type AccountRow, type GachaRecord } from "../src/core/types.js";
import { HttpError } from "../src/server/http.js";
import { createApp } from "../src/server/index.js";
import { JobManager } from "../src/server/jobs.js";
import { VERSION } from "../src/version.js";
import lcxSample from "./fixtures/io/lcx-sample.json" with { type: "json" };
import analysisFixture from "./fixtures/server/analysis.json" with { type: "json" };
import accountsFixture from "./fixtures/server/accounts.json" with { type: "json" };
import passportVaultFixture from "./fixtures/server/passport-vault.json" with { type: "json" };
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
    const vaultList = (await vaultListRes.json()) as Array<{ id: string; provider: string; label: string; createdAt: number }>;
    expect(vaultList).toHaveLength(1);
    expect(vaultList[0]?.id).toBe(inspectJson.vaultId);
    expect(vaultList[0]?.label).toBe("bilibili服 · 1角色");
    expect(new Vault(dataDir).list()[0]?.label).toBe("bilibili服 · 1角色");

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
    expect(passportVaultFixture[0]?.label).toBe("bilibili服 · 1角色");

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

  it("17. 路线 B 空绑定跳过（ok=true + 警告）与 /api/import 离愁轩毫秒截断判重及内置池表", async () => {
    const dataDir = mkTempDir("beg-w3-empty-lcx-");
    const store = GachaStore.open(dataDir);
    const hy = "SYNTH_HYTOKEN_EMPTY_BIND_12345";
    const u8Bili = fakeToken("pp-bili-2");
    const pp = createFakePassport({
      hytoken: hy,
      bindings: [
        { uid: "PP_EMPTY_OFF", channelMasterId: "1", channelName: "官服", isDefault: false, roles: [], u8Token: "UNUSED" },
        {
          uid: "PP_UID_BILI_2",
          channelMasterId: "2",
          channelName: "bilibili服",
          isDefault: true,
          roles: [{ roleId: "PP_ROLE_BILI_2", nickName: "合成玩家" }],
          u8Token: u8Bili,
        },
      ],
    });
    const ef = createFakeServer({
      token: u8Bili,
      char: {
        E_CharacterGachaPoolType_Special: [makeChar(11, 5, "special_1_0_1", "熔火灼痕")],
        E_CharacterGachaPoolType_Standard: [],
      },
      weaponPools: [],
      weapon: {},
      roleList: { uid: "PP_UID_BILI_2", roleId: "PP_ROLE_BILI_2", nickname: "合成玩家" },
    });
    const f = combineFetch(
      { match: (u) => u.hostname.endsWith(".hypergryph.com") && !u.hostname.startsWith("u8.") && !u.hostname.startsWith("ef-webview."), fetch: pp.fetch },
      { match: (u) => u.hostname.startsWith("u8.") || u.hostname.startsWith("ef-webview."), fetch: ef.fetch },
    );

    const { app } = createMemoryApp({ dataDir, deps: { store, fetch: f, sleep: async () => {} } });
    const base = (await app.listen()).split("#")[0]!.replace(/\/$/, "");

    const inspectRes = await fetch(`${base}/api/passport/inspect`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ input: hy, save: true }),
    });
    expect(inspectRes.status).toBe(200);
    const { vaultId } = (await inspectRes.json()) as { vaultId: string };

    const syncRes = await fetch(`${base}/api/sync`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "passport", vaultId }),
    });
    expect(syncRes.status).toBe(200);
    const { jobId } = (await syncRes.json()) as { jobId: string };

    let job: any;
    for (let i = 0; i < 200; i++) {
      const jr = await fetch(`${base}/api/jobs/${jobId}`, { headers: { "X-BEG-Key": app.key } });
      job = await jr.json();
      if (job.state !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(job.state).toBe("done");
    expect(job.result.items).toHaveLength(2);
    expect(job.result.items[0]).toEqual({
      channelName: "官服",
      maskedKey: "已跳过（无角色）",
      ok: true,
      feeds: [],
      warnings: ["该渠道下没有角色，已跳过"],
    });
    expect(job.result.items[1]?.ok).toBe(true);

    // 验证 /api/import 离愁轩毫秒截断归入 duplicates 且内置 1.0~1.4 池表无需 poolMap
    const acc = mkAccount({
      accountKey: "cn_2_SYNTHUID9_SYNTHROLE9",
      bindingUid: "SYNTHUID9",
      roleId: "SYNTHROLE9",
    });
    store.upsertAccount(acc);
    store.insertRecords(acc.accountKey, [
      mkRecord(501, {
        poolId: "special_1_0_1",
        poolName: "熔火灼痕",
        itemId: "chr_0016_laevat",
        itemName: "莱万汀",
        rarity: 6,
        gachaTs: "1770000100932",
      }),
    ]);

    const lcxPayload = JSON.stringify({
      code: 0,
      data: {
        uid: "SYNTH_LCX",
        export_timestamp: 1775000000,
        total: 2,
        list: [
          { seqId: "501", gachaTs: 1770000100, rarity: 6, poolName: "熔火灼痕", isFree: false, charName: "莱万汀" },
          { seqId: "502", gachaTs: 1770000200, rarity: 4, poolName: "基础寻访", isFree: false, charName: "佩丽卡" },
        ],
      },
    });
    const impRes = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ text: lcxPayload, account: acc.accountKey, apply: false }),
    });
    expect(impRes.status).toBe(200);
    const impJson = (await impRes.json()) as {
      plans: Array<{ added: number; duplicates: number; conflicts: number }>;
      unresolvedPools: string[];
      warnings: string[];
    };
    expect(impJson.unresolvedPools).toEqual([]);
    expect(impJson.plans[0]).toMatchObject({ added: 1, duplicates: 1, conflicts: 0 });
    expect(impJson.warnings.some((w) => w.includes("截断为 000"))).toBe(true);
  });

  it("18. QR 登录边界校验：拒绝 gryphline、内存模式禁止 save=true、支持 save=false 与 5 分钟 TTL 过期 404", async () => {
    const pp = createFakePassport({ hytoken: "SYNTH_QR_BOUND_HY_01", bindings: [] });
    const { app: memApp } = createMemoryApp({ deps: { fetch: pp.fetch } });
    const memBase = (await memApp.listen()).split("#")[0]!.replace(/\/$/, "");

    // 国际服拒绝扫码
    const rGlobal = await fetch(`${memBase}/api/passport/qr`, {
      method: "POST",
      headers: { "X-BEG-Key": memApp.key, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "gryphline" }),
    });
    expect(rGlobal.status).toBe(400);
    expect((await rGlobal.json()) as { message: string }).toMatchObject({
      message: "国际服暂不支持扫码登录，请使用通行证 token",
    });

    // 内存模式默认 save=true 被拒
    const rMemSave = await fetch(`${memBase}/api/passport/qr`, {
      method: "POST",
      headers: { "X-BEG-Key": memApp.key, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(rMemSave.status).toBe(400);
    expect((await rMemSave.json()) as { message: string }).toMatchObject({
      message: "内存模式不支持保存通行证保险库",
    });

    // 不存在的 scanId 返回 404 qr_expired
    const rMissing = await fetch(`${memBase}/api/passport/qr/NONEXISTENT_SCAN`, {
      headers: { "X-BEG-Key": memApp.key },
    });
    expect(rMissing.status).toBe(404);
    expect(await rMissing.json()).toEqual({
      error: "qr_expired",
      message: "扫码会话不存在或已过期，请重新生成二维码",
    });

    // save=false 在内存模式允许创建，且超过 5 分钟 TTL 后过期返回 404
    let fakeNow = 1_760_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => fakeNow);
    try {
      const rCreate = await fetch(`${memBase}/api/passport/qr`, {
        method: "POST",
        headers: { "X-BEG-Key": memApp.key, "Content-Type": "application/json" },
        body: JSON.stringify({ save: false }),
      });
      expect(rCreate.status).toBe(200);
      const { scanId } = (await rCreate.json()) as { scanId: string; scanUrl: string };
      expect(scanId).toBe("SCAN-SYNTH-1");

      fakeNow += 5 * 60 * 1000 + 1;
      const rExpired = await fetch(`${memBase}/api/passport/qr/${encodeURIComponent(scanId)}`, {
        headers: { "X-BEG-Key": memApp.key },
      });
      expect(rExpired.status).toBe(404);
      expect((await rExpired.json()) as { error: string }).toMatchObject({ error: "qr_expired" });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("19. QR 登录全链路：create -> pending（含 hint）-> confirmed -> Vault 写入语义 label 且不泄露凭据、重复轮询幂等", async () => {
    const dataDir = mkTempDir("beg-w3-qr-");
    const qrHy = "SYNTH_QR_HYTOKEN_ABCDEF0123456789";
    let step = 0;
    const pp = createFakePassport({
      hytoken: qrHy,
      qrToken: qrHy,
      bindings: [
        {
          uid: "QR_DEL_UID",
          channelMasterId: "1",
          channelName: "官服",
          isDeleted: true,
          roles: [{ roleId: "QR_DEL_ROLE", nickName: "已删角色" }],
          u8Token: "UNUSED_DEL",
        },
        {
          uid: "QR_OFF_UID",
          channelMasterId: "1",
          channelName: "官服",
          isDefault: false,
          roles: [{ roleId: "QR_OFF_ROLE", nickName: "官服测试" }],
          u8Token: "U8_QR_OFF",
        },
        {
          uid: "QR_BILI_UID",
          channelMasterId: "2",
          channelName: "bilibili服",
          isDefault: true,
          roles: [{ roleId: "QR_BILI_ROLE", nickName: "B服测试" }],
          u8Token: "U8_QR_BILI",
        },
      ],
      override: (url) => {
        if (url.pathname !== "/general/v1/scan_status") return undefined;
        step += 1;
        if (step === 1) {
          return new Response(JSON.stringify({ status: 100, msg: "未扫码" }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (step === 2) {
          return new Response(JSON.stringify({ status: 101, msg: "已扫码，请在手机确认" }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ status: 0, data: { scanCode: "SCANCODE-SYNTH-OK" } }), {
          headers: { "content-type": "application/json" },
        });
      },
    });

    const { app } = createMemoryApp({ dataDir, deps: { fetch: pp.fetch } });
    const base = (await app.listen()).split("#")[0]!.replace(/\/$/, "");

    const createRes = await fetch(`${base}/api/passport/qr`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { scanId: string; scanUrl: string };
    expect(created.scanId).toBe("SCAN-SYNTH-1");
    expect(created.scanUrl).toBeTruthy();

    // Poll 1: status=100 -> pending（无 hint / 无 consecutiveErrors）
    const p1 = await fetch(`${base}/api/passport/qr/${created.scanId}`, { headers: { "X-BEG-Key": app.key } });
    expect(p1.status).toBe(200);
    expect(await p1.json()).toEqual({ status: "pending" });

    // Poll 2: status=101 -> pending 带 hint
    const p2 = await fetch(`${base}/api/passport/qr/${created.scanId}`, { headers: { "X-BEG-Key": app.key } });
    expect(p2.status).toBe(200);
    expect(await p2.json()).toEqual({ status: "pending", hint: "已扫码，请在手机确认" });

    // Poll 3: confirmed -> 换票并落库 Vault，绝不泄露 hytoken / uid / roleId / scanCode
    const p3 = await fetch(`${base}/api/passport/qr/${created.scanId}`, { headers: { "X-BEG-Key": app.key } });
    expect(p3.status).toBe(200);
    const p3Text = await p3.text();
    expect(p3Text).not.toContain(qrHy);
    expect(p3Text).not.toContain("QR_OFF_UID");
    expect(p3Text).not.toContain("QR_BILI_UID");
    expect(p3Text).not.toContain("QR_OFF_ROLE");
    expect(p3Text).not.toContain("QR_BILI_ROLE");
    expect(p3Text).not.toContain("SCANCODE-SYNTH-OK");

    const p3Json = JSON.parse(p3Text) as {
      status: string;
      vaultId?: string;
      label: string;
      bindings: Array<{ channelMasterId: string; uidFingerprint: string }>;
    };
    const expectedVaultId = fingerprint(qrHy);
    expect(p3Json).toEqual({
      status: "confirmed",
      vaultId: expectedVaultId,
      label: "官服 · 1角色 / bilibili服 · 1角色",
      bindings: [
        {
          channelName: "官服",
          channelMasterId: "1",
          roleCount: 1,
          isDefault: false,
          uidFingerprint: fingerprint("QR_OFF_UID"),
        },
        {
          channelName: "bilibili服",
          channelMasterId: "2",
          roleCount: 1,
          isDefault: true,
          uidFingerprint: fingerprint("QR_BILI_UID"),
        },
      ],
    });

    // Vault 已加密保存且包含语义 label，磁盘不含明文 hytoken
    const vaultRaw = fs.readFileSync(path.join(dataDir, "vault.json"), "utf8");
    expect(vaultRaw).not.toContain(qrHy);
    const vault = new Vault(dataDir);
    expect(vault.load(expectedVaultId)).toEqual({ provider: "hypergryph", token: qrHy });

    const vaultListRes = await fetch(`${base}/api/passport/vault`, { headers: { "X-BEG-Key": app.key } });
    expect(vaultListRes.status).toBe(200);
    const vaultList = (await vaultListRes.json()) as Array<{ id: string; provider: string; label: string; createdAt: number }>;
    expect(vaultList).toHaveLength(1);
    expect(vaultList[0]).toMatchObject({
      id: expectedVaultId,
      provider: "hypergryph",
      label: "官服 · 1角色 / bilibili服 · 1角色",
    });

    // Poll 4: 幂等返回缓存结果，不再次请求上游 scan_status / token_by_scan_code
    const callsBeforeIdempotent = pp.calls.length;
    const p4 = await fetch(`${base}/api/passport/qr/${created.scanId}`, { headers: { "X-BEG-Key": app.key } });
    expect(p4.status).toBe(200);
    expect(await p4.json()).toEqual(p3Json);
    expect(pp.calls.length).toBe(callsBeforeIdempotent);

    // save=false 确认后不写 Vault 且响应不含 vaultId
    step = 2; // 下次 scan_status 直接 confirmed
    const noSaveCreate = await fetch(`${base}/api/passport/qr`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: JSON.stringify({ save: false }),
    });
    expect(noSaveCreate.status).toBe(200);
    const noSavePoll = await fetch(`${base}/api/passport/qr/SCAN-SYNTH-1`, { headers: { "X-BEG-Key": app.key } });
    expect(noSavePoll.status).toBe(200);
    const noSaveJson = (await noSavePoll.json()) as { status: string; vaultId?: string; label: string };
    expect(noSaveJson.status).toBe("confirmed");
    expect(noSaveJson.vaultId).toBeUndefined();
    expect(noSaveJson.label).toBe("官服 · 1角色 / bilibili服 · 1角色");
  });

  it("20. QR 轮询区分连续网络/HTTP 异常（<3 次暂态后由 status=100 清零；>=3 次返回 status=error）", async () => {
    const dataDir = mkTempDir("beg-w3-qr-err-");
    const qrHy = "SYNTH_QR_ERR_HYTOKEN_123456";
    let mode: "reset_then_ok" | "fail_three" = "reset_then_ok";
    let pollIdx = 0;

    const basePp = createFakePassport({
      hytoken: qrHy,
      qrToken: qrHy,
      bindings: [
        {
          uid: "QR_ERR_UID",
          channelMasterId: "2",
          channelName: "bilibili服",
          roles: [{ roleId: "QR_ERR_ROLE", nickName: "容错测试" }],
          u8Token: "U8_QR_ERR",
        },
      ],
    });

    const f: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/general/v1/scan_status") {
        pollIdx += 1;
        if (mode === "reset_then_ok") {
          if (pollIdx === 1) throw new Error("ECONNRESET https://x.invalid?token=SHOULD_SCRUB");
          if (pollIdx === 2) {
            return new Response(JSON.stringify({ msg: "gateway down" }), {
              status: 502,
              headers: { "content-type": "application/json" },
            });
          }
          if (pollIdx === 3) {
            return new Response(JSON.stringify({ status: 100, msg: "未扫码" }), {
              headers: { "content-type": "application/json" },
            });
          }
          if (pollIdx === 4) {
            return new Response(JSON.stringify({ msg: "bad gateway 2" }), {
              status: 503,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ status: 0, data: { scanCode: "SCANCODE-SYNTH-OK" } }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ msg: `upstream down #${pollIdx}` }), {
          status: 502,
          headers: { "content-type": "application/json" },
        });
      }
      return basePp.fetch(input, init);
    };

    const { app } = createMemoryApp({ dataDir, deps: { fetch: f } });
    const base = (await app.listen()).split("#")[0]!.replace(/\/$/, "");

    // 场景 A：2 次异常 → status=100 正常 pending 清零计数 → 再 1 次异常仍为 consecutiveErrors=1 → 最终 confirmed
    await fetch(`${base}/api/passport/qr`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: "{}",
    });

    const a1 = (await (await fetch(`${base}/api/passport/qr/SCAN-SYNTH-1`, { headers: { "X-BEG-Key": app.key } })).json()) as {
      status: string;
      consecutiveErrors?: number;
      transientError?: string;
    };
    expect(a1.status).toBe("pending");
    expect(a1.consecutiveErrors).toBe(1);
    expect(a1.transientError).toContain("<redacted>");
    expect(a1.transientError).not.toContain("SHOULD_SCRUB");

    const a2 = (await (await fetch(`${base}/api/passport/qr/SCAN-SYNTH-1`, { headers: { "X-BEG-Key": app.key } })).json()) as {
      status: string;
      consecutiveErrors?: number;
      transientError?: string;
    };
    expect(a2).toMatchObject({ status: "pending", consecutiveErrors: 2 });
    expect(a2.transientError).toContain("502");

    const a3 = await (await fetch(`${base}/api/passport/qr/SCAN-SYNTH-1`, { headers: { "X-BEG-Key": app.key } })).json();
    expect(a3).toEqual({ status: "pending" });

    const a4 = (await (await fetch(`${base}/api/passport/qr/SCAN-SYNTH-1`, { headers: { "X-BEG-Key": app.key } })).json()) as {
      status: string;
      consecutiveErrors?: number;
    };
    expect(a4).toMatchObject({ status: "pending", consecutiveErrors: 1 });

    const a5 = (await (await fetch(`${base}/api/passport/qr/SCAN-SYNTH-1`, { headers: { "X-BEG-Key": app.key } })).json()) as {
      status: string;
      label: string;
    };
    expect(a5).toMatchObject({ status: "confirmed", label: "bilibili服 · 1角色" });

    // 场景 B：连续 3 次网络/HTTP 异常 → 返回 status="error" 并中止后续上游轮询
    mode = "fail_three";
    pollIdx = 0;
    await fetch(`${base}/api/passport/qr`, {
      method: "POST",
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: "{}",
    });

    const b1 = await (await fetch(`${base}/api/passport/qr/SCAN-SYNTH-1`, { headers: { "X-BEG-Key": app.key } })).json();
    expect(b1).toMatchObject({ status: "pending", consecutiveErrors: 1 });
    const b2 = await (await fetch(`${base}/api/passport/qr/SCAN-SYNTH-1`, { headers: { "X-BEG-Key": app.key } })).json();
    expect(b2).toMatchObject({ status: "pending", consecutiveErrors: 2 });
    const b3 = (await (await fetch(`${base}/api/passport/qr/SCAN-SYNTH-1`, { headers: { "X-BEG-Key": app.key } })).json()) as {
      status: string;
      error: string;
    };
    expect(b3.status).toBe("error");
    expect(b3.error).toContain("连续 3 次");
    expect(b3.error).toContain("upstream down #3");

    // 再次轮询直接返回缓存错误，不再递增 pollIdx
    const b4 = await (await fetch(`${base}/api/passport/qr/SCAN-SYNTH-1`, { headers: { "X-BEG-Key": app.key } })).json();
    expect(b4).toEqual(b3);
    expect(pollIdx).toBe(3);
  });

  it("21. 账号头像持久化：PUT /api/accounts/:key/avatar 校验与 GET /api/accounts SQLite 持久化", async () => {
    const dataDir = mkTempDir("beg-p1-avatar-");
    const webDir = mkTempDir("beg-p1-emptyweb-");
    const store1 = GachaStore.open(dataDir);
    let store1Open = true;
    const app1 = createApp({ dataDir, webDir, deps: { store: store1 } });
    let app1Open = true;
    cleanups.push(async () => {
      if (app1Open) await app1.close();
      if (store1Open) store1.close();
    });

    const acc1 = mkAccount({
      accountKey: "cn_2_SYNTHAVATAR1_SYNTHROLE1",
      bindingUid: "SYNTHAVATAR1",
      roleId: "SYNTHROLE1",
      nickname: "头像主号",
      updatedAt: 1_760_000_002_000,
    });
    const acc2 = mkAccount({
      accountKey: "cn_1_SYNTHAVATAR2_SYNTHROLE2",
      channelMasterId: "1",
      channelName: "官服",
      bindingUid: "SYNTHAVATAR2",
      roleId: "SYNTHROLE2",
      nickname: "头像副号",
      updatedAt: 1_760_000_001_000,
    });
    store1.upsertAccount(acc1);
    store1.upsertAccount(acc2);

    const base1 = (await app1.listen()).split("#")[0]!.replace(/\/$/, "");
    const acc1Path = `/api/accounts/${encodeURIComponent(acc1.accountKey)}/avatar`;

    // 初始默认返回空字符串
    const initList = (await (await fetch(`${base1}/api/accounts`, { headers: { "X-BEG-Key": app1.key } })).json()) as Array<{
      accountKey: string;
      avatar: string;
    }>;
    expect(initList.map((x) => [x.accountKey, x.avatar])).toEqual([
      [acc1.accountKey, ""],
      [acc2.accountKey, ""],
    ]);

    // 1. 不存在账号 -> 404
    const r404 = await fetch(`${base1}/api/accounts/nonexistent_acc/avatar`, {
      method: "PUT",
      headers: { "X-BEG-Key": app1.key, "Content-Type": "application/json" },
      body: JSON.stringify({ avatar: "media/avatars/preset_1.webp" }),
    });
    expect(r404.status).toBe(404);

    // 2. 非法类型 / 非法格式 / 路径穿越 / SVG / HTTP / 超限 DataURL -> 400 bad_avatar
    const prefixPng = "data:image/png;base64,";
    const over64KbDataUrl = prefixPng + "A".repeat(64 * 1024 - prefixPng.length + 1);
    expect(Buffer.byteLength(over64KbDataUrl, "utf8")).toBe(64 * 1024 + 1);

    const badPayloads: unknown[] = [
      {},
      { avatar: 123 },
      { avatar: null },
      { avatar: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
      { avatar: "data:image/svg+xml,<svg/>" },
      { avatar: "https://evil.example.com/avatar.webp" },
      { avatar: "http://127.0.0.1:8080/avatar.webp" },
      { avatar: "media/avatars/../secret.webp" },
      { avatar: "media/avatars/..webp" },
      { avatar: "media/weapons/wpn_001.webp" },
      { avatar: "media/avatars/not_webp.png" },
      { avatar: "./media/avatars/preset_1.webp" },
      { avatar: over64KbDataUrl },
    ];
    for (const payload of badPayloads) {
      const rBad = await fetch(`${base1}${acc1Path}`, {
        method: "PUT",
        headers: { "X-BEG-Key": app1.key, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(rBad.status).toBe(400);
      expect((await rBad.json()) as { error: string }).toMatchObject({ error: "bad_avatar" });
    }
    expect(store1.getAccountAvatar(acc1.accountKey)).toBe("");

    // 3. 合法预设路径 media/avatars/*.webp 与干员路径 media/chars/*.webp
    const rPreset = await fetch(`${base1}${acc1Path}`, {
      method: "PUT",
      headers: { "X-BEG-Key": app1.key, "Content-Type": "application/json" },
      body: JSON.stringify({ avatar: "media/avatars/endmin_01.webp" }),
    });
    expect(rPreset.status).toBe(200);
    expect(await rPreset.json()).toEqual({ accountKey: acc1.accountKey, avatar: "media/avatars/endmin_01.webp" });

    const rChar = await fetch(`${base1}${acc1Path}`, {
      method: "PUT",
      headers: { "X-BEG-Key": app1.key, "Content-Type": "application/json" },
      body: JSON.stringify({ avatar: "media/chars/chr_0016_laevat.webp" }),
    });
    expect(rChar.status).toBe(200);
    expect(await rChar.json()).toEqual({ accountKey: acc1.accountKey, avatar: "media/chars/chr_0016_laevat.webp" });

    // 4. 合法 <= 64 KB 光栅 DataURL（PNG/JPEG/WebP 与精确 64 KB 边界）与跨实例 SQLite 持久化验证
    const exact64KbDataUrl = prefixPng + "A".repeat(64 * 1024 - prefixPng.length);
    expect(Buffer.byteLength(exact64KbDataUrl, "utf8")).toBe(64 * 1024);

    const rBoundary = await fetch(`${base1}${acc1Path}`, {
      method: "PUT",
      headers: { "X-BEG-Key": app1.key, "Content-Type": "application/json" },
      body: JSON.stringify({ avatar: exact64KbDataUrl }),
    });
    expect(rBoundary.status).toBe(200);

    const jpegDataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const rJpeg = await fetch(`${base1}${acc1Path}`, {
      method: "PUT",
      headers: { "X-BEG-Key": app1.key, "Content-Type": "application/json" },
      body: JSON.stringify({ avatar: jpegDataUrl }),
    });
    expect(rJpeg.status).toBe(200);

    const webpDataUrl = "data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=";
    const rWebp = await fetch(`${base1}${acc1Path}`, {
      method: "PUT",
      headers: { "X-BEG-Key": app1.key, "Content-Type": "application/json" },
      body: JSON.stringify({ avatar: webpDataUrl }),
    });
    expect(rWebp.status).toBe(200);
    expect(await rWebp.json()).toEqual({ accountKey: acc1.accountKey, avatar: webpDataUrl });

    // 关闭 app1 与 store1 后重新打开 SQLite，验证账号头像按 accountKey 隔离并持久保留
    await app1.close();
    app1Open = false;
    store1.close();
    store1Open = false;

    const store2 = GachaStore.open(dataDir);
    const app2 = createApp({ dataDir, webDir, deps: { store: store2 } });
    cleanups.push(async () => {
      await app2.close();
      store2.close();
    });

    expect(store2.getAccountAvatar(acc1.accountKey)).toBe(webpDataUrl);
    expect(store2.getAccountAvatar(acc2.accountKey)).toBe("");

    const base2 = (await app2.listen()).split("#")[0]!.replace(/\/$/, "");
    const list2 = (await (await fetch(`${base2}/api/accounts`, { headers: { "X-BEG-Key": app2.key } })).json()) as Array<{
      accountKey: string;
      avatar: string;
    }>;
    expect(list2.map((x) => [x.accountKey, x.avatar])).toEqual([
      [acc1.accountKey, webpDataUrl],
      [acc2.accountKey, ""],
    ]);

    // 5. 传入 "" 恢复默认，清空持久化头像
    const rReset = await fetch(`${base2}${acc1Path}`, {
      method: "PUT",
      headers: { "X-BEG-Key": app2.key, "Content-Type": "application/json" },
      body: JSON.stringify({ avatar: "" }),
    });
    expect(rReset.status).toBe(200);
    expect(await rReset.json()).toEqual({ accountKey: acc1.accountKey, avatar: "" });
    expect(store2.getAccountAvatar(acc1.accountKey)).toBe("");

    const listAfterReset = (await (await fetch(`${base2}/api/accounts`, { headers: { "X-BEG-Key": app2.key } })).json()) as Array<{
      accountKey: string;
      avatar: string;
    }>;
    expect(listAfterReset.map((x) => [x.accountKey, x.avatar])).toEqual([
      [acc1.accountKey, ""],
      [acc2.accountKey, ""],
    ]);
  });

  it("22. 兼容旧版 gacha.sqlite（无 account_prefs 表时自动建表且保留既有账号与记录）", () => {
    const dataDir = mkTempDir("beg-p1-legacy-db-");
    const dbPath = path.join(dataDir, "gacha.sqlite");
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta (key, value) VALUES ('schema_version', '1');
      CREATE TABLE accounts (
        account_key TEXT PRIMARY KEY,
        region TEXT NOT NULL,
        channel_master_id TEXT NOT NULL,
        binding_uid TEXT NOT NULL,
        role_id TEXT NOT NULL,
        nickname TEXT NOT NULL DEFAULT '',
        server_id TEXT NOT NULL DEFAULT '',
        server_name TEXT NOT NULL DEFAULT '',
        channel_name TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE records (
        account_key TEXT NOT NULL,
        feed TEXT NOT NULL,
        seq_id TEXT NOT NULL,
        type TEXT NOT NULL,
        pool_type TEXT NOT NULL,
        pool_id TEXT NOT NULL,
        pool_name TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_name TEXT NOT NULL,
        item_sub_type TEXT NOT NULL DEFAULT '',
        rarity INTEGER NOT NULL,
        is_free INTEGER NOT NULL,
        is_new INTEGER NOT NULL,
        gacha_ts TEXT NOT NULL,
        kind TEXT NOT NULL,
        PRIMARY KEY (account_key, feed, seq_id)
      ) WITHOUT ROWID;
      CREATE TABLE pools (
        pool_id TEXT PRIMARY KEY,
        gacha_type TEXT NOT NULL,
        pool_name TEXT NOT NULL,
        pool_type TEXT NOT NULL,
        up6_ids TEXT NOT NULL,
        version_num TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE rerun_counts (
        account_key TEXT NOT NULL,
        type TEXT NOT NULL,
        pool_id TEXT NOT NULL,
        pool_name TEXT NOT NULL,
        total_pull_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (account_key, type, pool_id)
      ) WITHOUT ROWID;
      INSERT INTO accounts VALUES ('cn_2_LEGACY1_ROLE1', 'cn', '2', 'LEGACY1', 'ROLE1', '旧库玩家', '1', 'China', 'bilibili服', 'cache', 1760000000000);
    `);
    legacyDb.close();

    const store = GachaStore.open(dataDir);
    try {
      expect(store.listAccounts().map((a) => a.accountKey)).toEqual(["cn_2_LEGACY1_ROLE1"]);
      expect(store.getAccountAvatar("cn_2_LEGACY1_ROLE1")).toBe("");
      store.setAccountAvatar("cn_2_LEGACY1_ROLE1", "media/avatars/legacy.webp");
      expect(store.getAccountAvatar("cn_2_LEGACY1_ROLE1")).toBe("media/avatars/legacy.webp");
    } finally {
      store.close();
    }
  });
});
