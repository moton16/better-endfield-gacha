import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlockfileCache, looksLikeBlockfileCache, superFastHash } from "../src/core/cache/blockfile.js";
import { buildBlockfileCache, fakeToken } from "./helpers/blockfile-builder.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "beg-bf-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("superFastHash", () => {
  it("覆盖 len%4 = 0/1/2/3 并且确定性", () => {
    const hs = [1, 2, 3, 4, 5, 6, 7].map((n) => superFastHash(Buffer.alloc(n, 0xab)));
    expect(new Set(hs).size).toBe(hs.length);
    expect(superFastHash(Buffer.from("abc"))).toBe(superFastHash(Buffer.from("abc")));
    expect(superFastHash(Buffer.alloc(0))).toBe(0);
    // 高位字节按 signed char 处理：0xff 与 0x7f 结果必须不同
    expect(superFastHash(Buffer.from([0xff]))).not.toBe(superFastHash(Buffer.from([0x7f])));
  });
});

describe("BlockfileCache", () => {
  it("解析 inline / 外部长 key / 带前缀 key，并区分哈希校验失败的条目；crash=1 不报错", () => {
    const t = fakeToken("a");
    const base = Date.UTC(2026, 10, 25, 9, 0, 0);
    buildBlockfileCache(
      dir,
      [
        { url: `https://ef-webview.hypergryph.com/page/gacha_char?u8_token=${encodeURIComponent(t)}`, creationMs: base, lastUsedMs: base + 5000 },
        { url: `https://ef-webview.hypergryph.com/api/record/char?token=${encodeURIComponent(t)}`, keyPrefix: "1/0/_dk_https://x https://x ", creationMs: base + 1000, lastUsedMs: base + 1000 },
        { url: `https://ef-webview.hypergryph.com/page/gacha_weapon?u8_token=${encodeURIComponent(t)}&pad=${"p".repeat(1500)}`, creationMs: base + 2000, lastUsedMs: base + 2000, externalKey: true },
        { url: "https://example.com/broken", creationMs: base, lastUsedMs: base, corrupt: true },
      ],
      { crash: 1 },
    );
    expect(looksLikeBlockfileCache(dir)).toBe(true);
    const c = new BlockfileCache(dir);
    expect(c.index.crash).toBe(1);
    const es = [...c.entries()];
    c.close();
    expect(es).toHaveLength(4);
    const byPath = (s: string) => es.find((e) => e.url?.includes(s))!;
    const page = byPath("/page/gacha_char");
    expect(page.keyHashOk && page.selfHashOk).toBe(true);
    expect(page.creationTimeMs).toBe(base);
    expect(page.lastUsedMs).toBe(base + 5000);
    expect(page.sortTimeMs).toBe(base + 5000); // max(creation, last_used)
    expect(byPath("/api/record/char").key.startsWith("1/0/_dk_")).toBe(true);
    expect(byPath("/api/record/char").url!.startsWith("https://ef-webview")).toBe(true);
    const longOne = byPath("/page/gacha_weapon");
    expect(longOne.key.length).toBeGreaterThan(1500);
    expect(longOne.keyHashOk).toBe(true);
    expect(byPath("example.com").keyHashOk).toBe(false);
  });

  it("非 blockfile 目录被拒绝", () => {
    fs.writeFileSync(path.join(dir, "index"), Buffer.alloc(400));
    fs.writeFileSync(path.join(dir, "data_0"), Buffer.alloc(100));
    expect(looksLikeBlockfileCache(dir)).toBe(false);
    expect(() => new BlockfileCache(dir)).toThrow();
  });
});
