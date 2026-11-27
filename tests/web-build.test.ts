import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import preact from "@preact/preset-vite";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

interface BuildOutputFile {
  fullPath: string;
  relPath: string;
  size: number;
}

function walkBuildFiles(dir: string, rootDir = dir): BuildOutputFile[] {
  const files: BuildOutputFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkBuildFiles(fullPath, rootDir));
    } else {
      const relPath = path.relative(rootDir, fullPath).split(path.sep).join("/");
      files.push({
        fullPath,
        relPath,
        size: fs.statSync(fullPath).size,
      });
    }
  }
  return files;
}

function isMediaAssetPath(relPath: string): boolean {
  return relPath === "media" || relPath.startsWith("media/");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("web build smoke", () => {
  it("builds production bundle with split code/font (<200 KB) and media (<10 MB) budgets and no external URLs", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "beg-web-build-"));
    tempDirs.push(outDir);

    // Vitest 默认将 NODE_ENV 设为 "test"，需临时恢复为 "production" 才能测真实生产产物而非 jsxDEV 调试包
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await build({
        configFile: false,
        mode: "production",
        root: path.resolve("src/web"),
        base: "./",
        plugins: [preact()],
        logLevel: "silent",
        build: {
          outDir,
          emptyOutDir: true,
          sourcemap: false,
        },
      });
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }

    const indexPath = path.join(outDir, "index.html");
    expect(fs.existsSync(indexPath)).toBe(true);
    const html = fs.readFileSync(indexPath, "utf8");
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).toContain('src="./assets/');

    const files = walkBuildFiles(outDir);
    const codeAndFontFiles = files.filter((f) => !isMediaAssetPath(f.relPath));
    const mediaFiles = files.filter((f) => isMediaAssetPath(f.relPath));

    const codeAndFontBytes = codeAndFontFiles.reduce((sum, f) => sum + f.size, 0);
    const mediaBytes = mediaFiles.reduce((sum, f) => sum + f.size, 0);

    expect(codeAndFontFiles.length).toBeGreaterThanOrEqual(2);
    expect(codeAndFontBytes).toBeLessThan(200 * 1024);
    expect(mediaBytes).toBeLessThan(10 * 1024 * 1024);

    const srcManifestPath = path.resolve("src/web/public/media/manifest.json");
    if (fs.existsSync(srcManifestPath)) {
      const emittedManifestPath = path.join(outDir, "media", "manifest.json");
      expect(fs.existsSync(emittedManifestPath)).toBe(true);
      expect(mediaFiles.some((f) => f.relPath === "media/manifest.json")).toBe(true);
      expect(() => JSON.parse(fs.readFileSync(emittedManifestPath, "utf8"))).not.toThrow();
    }

    // 校验打包产物（HTML/CSS/JSON 零 http URL；JS 仅允许标准 XML namespace 与 mock 示例字符串）
    for (const f of files) {
      if (/\.(html|css|json)$/i.test(f.relPath)) {
        const text = fs.readFileSync(f.fullPath, "utf8");
        const urls = text.match(/https?:\/\/[^\s"'`)\\]*/gi) ?? [];
        expect({ file: f.relPath, urls }).toEqual({ file: f.relPath, urls: [] });
      } else if (/\.js$/i.test(f.relPath)) {
        const text = fs.readFileSync(f.fullPath, "utf8");
        const urls = text.match(/https?:\/\/[^\s"'`)\\]*/gi) ?? [];
        const unexpected = urls.filter(
          (u) =>
            !u.startsWith("http://www.w3.org/") &&
            !u.startsWith("https://ef-webview.hypergryph.com/page/gacha_char"),
        );
        expect({ file: f.relPath, unexpected }).toEqual({ file: f.relPath, unexpected: [] });
      }
    }
  });
});
