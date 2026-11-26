import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import preact from "@preact/preset-vite";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

function walkSize(dir: string): { files: string[]; totalBytes: number } {
  const files: string[] = [];
  let totalBytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = walkSize(full);
      files.push(...sub.files);
      totalBytes += sub.totalBytes;
    } else {
      files.push(full);
      totalBytes += fs.statSync(full).size;
    }
  }
  return { files, totalBytes };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("web build smoke", () => {
  it("builds production bundle under 200 KB with no external URLs", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "beg-web-build-"));
    tempDirs.push(outDir);

    await build({
      configFile: false,
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

    const indexPath = path.join(outDir, "index.html");
    expect(fs.existsSync(indexPath)).toBe(true);
    const html = fs.readFileSync(indexPath, "utf8");
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).toContain('src="./assets/');

    const { files, totalBytes } = walkSize(outDir);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(totalBytes).toBeLessThan(200 * 1024);

    // 校验打包产物（HTML/CSS 零 http URL；JS 仅允许标准 XML namespace 与 mock 示例字符串）
    for (const f of files) {
      if (/\.(html|css)$/i.test(f)) {
        const text = fs.readFileSync(f, "utf8");
        expect(text).not.toMatch(/https?:\/\//i);
      } else if (/\.js$/i.test(f)) {
        const text = fs.readFileSync(f, "utf8");
        const urls = text.match(/https?:\/\/[^\s"'`)\\]+/gi) ?? [];
        for (const u of urls) {
          expect(
            u.startsWith("http://www.w3.org/") ||
              u.startsWith("https://ef-webview.hypergryph.com/page/gacha_char"),
          ).toBe(true);
        }
      }
    }
  });
});
