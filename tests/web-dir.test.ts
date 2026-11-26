import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GachaStore } from "../src/core/storage/store.js";
import { createApp } from "../src/server/index.js";
import { resolveWebDir } from "../src/server/web-dir.js";

const tempDirs: string[] = [];

function mkTempDir(prefix = "beg-webdir-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeIndex(dir: string, marker = "BEG"): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><title>${marker}</title>`, "utf8");
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("resolveWebDir", () => {
  it("1. 源码运行布局：src/server 解析到同仓 dist-web", () => {
    const root = mkTempDir();
    const modDir = path.join(root, "src", "server");
    fs.mkdirSync(modDir, { recursive: true });
    const web = writeIndex(path.join(root, "dist-web"), "SRC");

    expect(resolveWebDir({ envDir: "", moduleDir: modDir, cwd: mkTempDir() })).toBe(path.resolve(web));
  });

  it("2. dist 编译产物布局：dist/server 解析到同仓 dist-web", () => {
    const root = mkTempDir();
    const modDir = path.join(root, "dist", "server");
    fs.mkdirSync(modDir, { recursive: true });
    const web = writeIndex(path.join(root, "dist-web"), "DIST");

    expect(resolveWebDir({ envDir: "", moduleDir: modDir, cwd: mkTempDir() })).toBe(path.resolve(web));
  });

  it("3. 便携包布局（app/dist + app/dist-web）：app/dist/server 解析到 app/dist-web", () => {
    const root = mkTempDir();
    const modDir = path.join(root, "app", "dist", "server");
    fs.mkdirSync(modDir, { recursive: true });
    const web = writeIndex(path.join(root, "app", "dist-web"), "PORTABLE");

    expect(resolveWebDir({ envDir: "", moduleDir: modDir, cwd: mkTempDir() })).toBe(path.resolve(web));
  });

  it("4. 兼容扁平便携布局（app/ + web/）：app/server 解析到 web", () => {
    const root = mkTempDir();
    const modDir = path.join(root, "app", "server");
    fs.mkdirSync(modDir, { recursive: true });
    const web = writeIndex(path.join(root, "web"), "FLAT_PORTABLE");

    expect(resolveWebDir({ envDir: "", moduleDir: modDir, cwd: mkTempDir() })).toBe(path.resolve(web));
  });

  it("5. BEG_WEB_DIR 环境变量优先级最高，并可驱动 createApp 静态托管", async () => {
    const root = mkTempDir();
    const fallbackWeb = writeIndex(path.join(root, "dist-web"), "FALLBACK");
    const overrideWeb = writeIndex(path.join(root, "custom-web"), "OVERRIDE_TITLE");
    const modDir = path.join(root, "dist", "server");
    fs.mkdirSync(modDir, { recursive: true });

    expect(resolveWebDir({ envDir: overrideWeb, moduleDir: modDir, cwd: root })).toBe(path.resolve(overrideWeb));
    expect(resolveWebDir({ envDir: "", moduleDir: modDir, cwd: root })).toBe(path.resolve(fallbackWeb));

    vi.stubEnv("BEG_WEB_DIR", overrideWeb);
    const store = GachaStore.open(":memory:");
    const app = createApp({ dataDir: ":memory:", deps: { store } });
    try {
      const url = await app.listen();
      const base = url.split("#")[0]!.replace(/\/$/, "");
      const res = await fetch(`${base}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("OVERRIDE_TITLE");
    } finally {
      await app.close();
      store.close();
    }
  });
});
