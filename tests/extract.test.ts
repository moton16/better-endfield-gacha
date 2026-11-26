import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlockfileCache } from "../src/core/cache/blockfile.js";
import {
  blockfileUrlEntries,
  buildGachaLink,
  collectCredentials,
  decodeTokenValue,
  parseCredentialUrl,
  pickBestCredential,
  scanLocations,
} from "../src/core/cache/extract.js";
import { cefCacheDirName, discoverCacheLocations } from "../src/core/cache/locations.js";
import { SIMPLE_MAGIC } from "../src/core/cache/simplecache.js";
import { buildBlockfileCache, fakeToken } from "./helpers/blockfile-builder.js";

const SRC = { dir: "x", backend: "blockfile", origin: "custom" } as const;
const enc = encodeURIComponent;

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beg-ex-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("token 解析", () => {
  it("先 URL 解码还原 Base64，不把 + 当空格；重编码后可往返", () => {
    const t = fakeToken("rt");
    expect(t).toMatch(/\+/);
    expect(t).toMatch(/\//);
    const p = parseCredentialUrl(`https://ef-webview.hypergryph.com/page/gacha_char?channel=2&subChannel=2&u8_token=${enc(t)}`)!;
    expect(p.token).toBe(t);
    expect(p.token.length).toBe(328);
    expect(new URLSearchParams({ token: p.token }).get("token")).toBe(t);
    // 缓存里若 + 未被编码而变成了空格，还原回 +
    expect(decodeTokenValue(t.replace(/\+/g, " "))).toBe(t);
  });

  it("page 取 u8_token，api 取 token；其它路径/域名/过短 token 忽略", () => {
    const t = fakeToken("k");
    const ok1 = parseCredentialUrl(`https://ef-webview.hypergryph.com/api/record/char/meta?lang=zh-cn&server_id=1&token=${enc(t)}`);
    expect(ok1?.kind).toBe("api");
    // page 上的 token= 不算（必须是 u8_token）；api 上的 u8_token= 不算
    expect(parseCredentialUrl(`https://ef-webview.hypergryph.com/page/gacha_char?token=${enc(t)}`)).toBeNull();
    expect(parseCredentialUrl(`https://ef-webview.hypergryph.com/api/record/char?u8_token=${enc(t)}`)).toBeNull();
    expect(parseCredentialUrl(`https://ef-webview.hypergryph.com/page/gate_bulletin?u8_token=${enc(t)}`)).toBeNull();
    expect(parseCredentialUrl(`https://evil.example.com/page/gacha_char?u8_token=${enc(t)}`)).toBeNull();
    expect(parseCredentialUrl(`https://ef-webview.hypergryph.com/page/gacha_char?u8_token=short`)).toBeNull();
  });

  it("国服 server_id 恒为 1；国际服取 URL 中的 server", () => {
    const t = fakeToken("g");
    const cn = parseCredentialUrl(`https://ef-webview.hypergryph.com/page/gacha_char?server=2&u8_token=${enc(t)}`)!;
    expect(cn.region).toBe("cn");
    expect(cn.serverId).toBe("1");
    const gl = parseCredentialUrl(`https://ef-webview.gryphline.com/page/gacha_char?server=3&u8_token=${enc(t)}`)!;
    expect(gl.region).toBe("global");
    expect(gl.serverId).toBe("3");
  });
});

describe("凭据选择", () => {
  const e = (url: string, c: number, l: number) => ({ key: url, url, creationTimeMs: c, lastUsedMs: l, sortTimeMs: Math.max(c, l), verified: true });
  const H = "https://ef-webview.hypergryph.com";

  it("按 max(creation, last_used) 取最新；API-only 的 token 继承同 token 页面的渠道", () => {
    const old = fakeToken("old");
    const cur = fakeToken("cur");
    const creds = collectCredentials(
      [
        e(`${H}/page/gacha_char?channel=1&subChannel=1&u8_token=${enc(old)}`, 1000, 1500),
        e(`${H}/page/gacha_char?channel=2&subChannel=2&u8_token=${enc(cur)}`, 900, 900),
        e(`${H}/api/record/char/meta?token=${enc(cur)}`, 900, 3000),
      ],
      SRC,
    );
    expect(creds.map((c) => c.token)).toEqual([cur, old]);
    expect(creds[0]!.channel).toBe("2");
    expect(creds[0]!.sortTimeMs).toBe(3000);
    expect(pickBestCredential(creds, { channel: "1" })?.token).toBe(old);
    expect(pickBestCredential(creds)?.token).toBe(cur);

    const apiOnly = collectCredentials([e(`${H}/api/record/char?token=${enc(cur)}`, 1, 1)], SRC);
    expect(apiOnly[0]!.channel).toBeUndefined();
  });

  it("未通过哈希校验的条目被丢弃", () => {
    const t = fakeToken("bad");
    const bad = { ...e(`${H}/page/gacha_char?u8_token=${enc(t)}`, 5, 5), verified: false };
    expect(collectCredentials([bad], SRC)).toEqual([]);
  });

  it("buildGachaLink 重新编码 token", () => {
    const t = fakeToken("lnk");
    const link = buildGachaLink({ token: t, host: "ef-webview.hypergryph.com", channel: "2", subChannel: "2", serverId: "1", lang: "zh-cn" });
    const u = new URL(link);
    expect(u.pathname).toBe("/page/gacha_char");
    expect(u.searchParams.get("u8_token")).toBe(t);
    expect(u.searchParams.get("channel")).toBe("2");
    expect(u.searchParams.get("server")).toBe("1");
  });
});

describe("缓存目录发现与端到端扫描", () => {
  it("CEF 目录名 = md5(appCode+channel+subChannel)，与逆向报告一致", () => {
    expect(cefCacheDirName("6LL0KJuqHBVz33WK", "2", "2")).toBe("cd9a4c61d2a7aac0dd76f613e07f1bb4");
    expect(cefCacheDirName("4df8f5a7c2ad711b497a", "2", "2")).toBe("e8dab03198d19b909c78db9895cf4bfa");
  });

  it("同时发现 QtWebEngine blockfile 与 CEF SimpleCache，并按时间合并取最新", () => {
    const local = path.join(tmp, "Local");
    const home = path.join(tmp, "Home");
    const qt = path.join(local, "PlatformProcess", "Cache");
    const tQt = fakeToken("qt");
    const tCef = fakeToken("cef");
    const t0 = Date.UTC(2026, 10, 25);
    buildBlockfileCache(qt, [
      { url: `https://ef-webview.hypergryph.com/page/gacha_char?channel=2&subChannel=2&u8_token=${enc(tQt)}`, creationMs: t0, lastUsedMs: t0 },
    ], { crash: 1 });

    const cef = path.join(home, "AppData", "LocalLow", "Hypergryph", "Endfield", "PlatformProcess", cefCacheDirName("6LL0KJuqHBVz33WK", "2", "2"), "Default", "Cache", "Cache_Data");
    fs.mkdirSync(cef, { recursive: true });
    const key = Buffer.from(`1/0/_dk_https://a https://a https://ef-webview.hypergryph.com/page/gacha_weapon?channel=2&subChannel=2&u8_token=${enc(tCef)}`);
    const head = Buffer.alloc(24);
    head.writeBigUInt64LE(SIMPLE_MAGIC, 0);
    head.writeUInt32LE(5, 8);
    head.writeUInt32LE(key.length, 12);
    fs.writeFileSync(path.join(cef, "0123456789abcdef_0"), Buffer.concat([head, key]));

    const locs = discoverCacheLocations({ localAppData: local, userProfile: home });
    expect(locs.map((l) => `${l.origin}/${l.backend}`).sort()).toEqual(["cef/simple", "qtwebengine/blockfile"]);
    const res = scanLocations(locs);
    expect(res.errors).toEqual([]);
    expect(res.credentials.map((c) => c.token).sort()).toEqual([tCef, tQt].sort());
    // CEF 文件是刚写入的（mtime=now），比 2026-11-25 新
    expect(res.credentials[0]!.token).toBe(tCef);
  });

  it("blockfile 条目经 blockfileUrlEntries 后丢弃坏哈希", () => {
    const t = fakeToken("z");
    const dir = path.join(tmp, "c");
    buildBlockfileCache(dir, [
      { url: `https://ef-webview.hypergryph.com/page/gacha_char?u8_token=${enc(t)}`, creationMs: 1, lastUsedMs: 1, corrupt: true },
    ]);
    const c = new BlockfileCache(dir);
    expect(collectCredentials(blockfileUrlEntries(c), SRC)).toEqual([]);
    c.close();
  });
});
