import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { COMMANDS } from "../src/cli/commands/index.js";
import { makeContext } from "../src/cli/context.js";
import { VERSION } from "../src/version.js";

const PRE_RE = /-(dev|a|b|rc)(\.\d+)?$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface GuardInput {
  pkgVersion: string;
  codeVersion: string;
  readme: string;
  changelog: string;
  isReleaseEnv: boolean;
}

function assertVersionGuard(input: GuardInput): void {
  if (input.codeVersion !== input.pkgVersion) {
    throw new Error(`version mismatch: src/version.ts=${input.codeVersion} !== package.json=${input.pkgVersion}`);
  }
  const isPre = PRE_RE.test(input.pkgVersion);
  if (input.isReleaseEnv && isPre) {
    throw new Error(`release guard (BEG_RELEASE=1) blocks pre-release suffix: ${input.pkgVersion}`);
  }
  if (!isPre) {
    const badge = /Version-([0-9][^-\s)]*)-/.exec(input.readme)?.[1];
    if (badge && badge !== input.pkgVersion) {
      throw new Error(`README badge version=${badge} !== ${input.pkgVersion}`);
    }
    const releaseHeader = new RegExp(`^## \\[${escapeRegExp(input.pkgVersion)}\\]`, "m");
    if (!releaseHeader.test(input.changelog)) {
      throw new Error(`CHANGELOG.md missing release section ## [${input.pkgVersion}]`);
    }
    return;
  }

  if (!/^## \[Unreleased\]/m.test(input.changelog)) {
    throw new Error("CHANGELOG.md must keep ## [Unreleased] during pre-release");
  }
  const baseVersion = input.pkgVersion.replace(PRE_RE, "");
  const prematureHeader = new RegExp(`^## \\[${escapeRegExp(baseVersion)}\\]`, "m");
  if (prematureHeader.test(input.changelog)) {
    throw new Error(`CHANGELOG.md must not prematurely declare ## [${baseVersion}] while at ${input.pkgVersion}`);
  }
}

describe("版本一致性与发布守卫", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { version: string };
  const readme = fs.readFileSync("README.md", "utf8");
  const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
  const isReleaseEnv = process.env.BEG_RELEASE === "1" || process.env.BEG_RELEASE === "true";

  it("当前仓库锚点（package.json / src/version.ts / README.md / CHANGELOG.md）满足守卫", () => {
    expect(VERSION).toBe(pkg.version);
    expect(() =>
      assertVersionGuard({
        pkgVersion: pkg.version,
        codeVersion: VERSION,
        readme,
        changelog,
        isReleaseEnv,
      }),
    ).not.toThrow();
  });

  it("BEG_RELEASE=1 时强制拦截 -dev 等预发布后缀", () => {
    expect(() =>
      assertVersionGuard({
        pkgVersion: "0.1.0-dev",
        codeVersion: "0.1.0-dev",
        readme,
        changelog,
        isReleaseEnv: true,
      }),
    ).toThrow(/pre-release/);
  });

  it("开发期不得提前出现正式版 CHANGELOG 条目", () => {
    expect(() =>
      assertVersionGuard({
        pkgVersion: "0.1.0-dev",
        codeVersion: "0.1.0-dev",
        readme,
        changelog: "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-11-26\n",
        isReleaseEnv: false,
      }),
    ).toThrow(/prematurely declare/);
  });

  it("正式版状态（0.1.0）守卫检查全锚点一致且在缺失/不匹配时拦截", () => {
    const validReadme = "[![Version: 0.1.0](https://img.shields.io/badge/Version-0.1.0-blue.svg)](CHANGELOG.md)";
    const validChangelog = "# Changelog\n\n## [0.1.0] - 2026-11-26\n- 首个正式版本\n";

    expect(() =>
      assertVersionGuard({
        pkgVersion: "0.1.0",
        codeVersion: "0.1.0",
        readme: validReadme,
        changelog: validChangelog,
        isReleaseEnv: true,
      }),
    ).not.toThrow();

    expect(() =>
      assertVersionGuard({
        pkgVersion: "0.1.0",
        codeVersion: "0.1.0",
        readme: "[![Version: 0.0.9](https://img.shields.io/badge/Version-0.0.9-blue.svg)](CHANGELOG.md)",
        changelog: validChangelog,
        isReleaseEnv: true,
      }),
    ).toThrow(/README badge/);

    expect(() =>
      assertVersionGuard({
        pkgVersion: "0.1.0",
        codeVersion: "0.1.0",
        readme: validReadme,
        changelog: "# Changelog\n\n## [Unreleased]\n",
        isReleaseEnv: true,
      }),
    ).toThrow(/CHANGELOG.md missing/);
  });

  it("CLI version 命令输出与 VERSION 一致（含 --json）", async () => {
    const cmd = COMMANDS.find((c) => c.name === "version");
    expect(cmd).toBeDefined();

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });
    try {
      expect(await cmd!.run(makeContext(["version"]))).toBe(0);
      expect(logs[0]).toBe(VERSION);

      expect(await cmd!.run(makeContext(["version", "--json"]))).toBe(0);
      expect(JSON.parse(logs[1]!)).toEqual({ version: VERSION });
    } finally {
      spy.mockRestore();
    }
  });
});
