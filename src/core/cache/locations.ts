/**
 * 缓存目录发现：
 *  - QtWebEngine（当前国服/B 服）：%LOCALAPPDATA%\PlatformProcess\Cache
 *  - QCefView（前瞻，官方尚未对国服启用）：
 *      %USERPROFILE%\AppData\LocalLow\Hypergryph\Endfield\PlatformProcess\<md5(appCode+channel+subChannel)>
 *    子目录层级随 CEF 版本而异，因此对该根目录做深度 ≤3 的探测。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { looksLikeBlockfileCache } from "./blockfile.js";
import { looksLikeSimpleCache } from "./simplecache.js";
import type { CacheLocation } from "./types.js";

/** 逆向报告中出现过的 appCode（u8ExtraConfig / config.bin） */
export const KNOWN_APP_CODES = ["6LL0KJuqHBVz33WK", "4df8f5a7c2ad711b497a"] as const;
/** (channel, subChannel)：官服 1/1，B 服 2/2 */
export const KNOWN_CHANNELS: ReadonlyArray<readonly [string, string]> = [
  ["1", "1"],
  ["2", "2"],
];

/** CEF 缓存根子目录名 = md5(appCode + channel + subChannel) */
export function cefCacheDirName(appCode: string, channel: string, subChannel: string): string {
  return createHash("md5").update(`${appCode}${channel}${subChannel}`, "utf8").digest("hex");
}

export interface DiscoverEnv {
  localAppData?: string;
  userProfile?: string;
}

function envDefaults(env: DiscoverEnv): Required<DiscoverEnv> {
  const home = env.userProfile ?? process.env.USERPROFILE ?? os.homedir();
  return {
    userProfile: home,
    localAppData: env.localAppData ?? process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"),
  };
}

export function qtWebEngineCacheDir(env: DiscoverEnv = {}): string {
  return path.join(envDefaults(env).localAppData, "PlatformProcess", "Cache");
}

export function cefPlatformProcessRoot(env: DiscoverEnv = {}): string {
  return path.join(envDefaults(env).userProfile, "AppData", "LocalLow", "Hypergryph", "Endfield", "PlatformProcess");
}

/** 已知的 CEF 缓存根（按 md5 推算），不要求存在 */
export function knownCefRoots(env: DiscoverEnv = {}): string[] {
  const root = cefPlatformProcessRoot(env);
  const names = new Set<string>();
  for (const code of KNOWN_APP_CODES) {
    for (const [ch, sub] of KNOWN_CHANNELS) names.add(cefCacheDirName(code, ch, sub));
  }
  return [...names].map((n) => path.join(root, n));
}

function classify(dir: string): CacheLocation["backend"] | null {
  if (looksLikeBlockfileCache(dir)) return "blockfile";
  if (looksLikeSimpleCache(dir)) return "simple";
  return null;
}

function probeTree(root: string, maxDepth: number, out: CacheLocation[], origin: CacheLocation["origin"]): void {
  const walk = (dir: string, depth: number) => {
    const backend = classify(dir);
    if (backend) out.push({ dir, backend, origin });
    if (depth >= maxDepth) return;
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const c of children) {
      if (c.isDirectory()) walk(path.join(dir, c.name), depth + 1);
    }
  };
  if (fs.existsSync(root)) walk(root, 0);
}

export interface DiscoverOptions extends DiscoverEnv {
  /** 用户显式指定的额外缓存目录（--cache-dir） */
  extraDirs?: string[];
}

export function discoverCacheLocations(opts: DiscoverOptions = {}): CacheLocation[] {
  const out: CacheLocation[] = [];

  const qt = qtWebEngineCacheDir(opts);
  const qtBackend = fs.existsSync(qt) ? classify(qt) : null;
  if (qtBackend) out.push({ dir: qt, backend: qtBackend, origin: "qtwebengine" });

  // CEF：已知 md5 目录 + PlatformProcess 下所有子目录
  const cefRoot = cefPlatformProcessRoot(opts);
  const roots = new Set<string>(knownCefRoots(opts));
  try {
    for (const c of fs.readdirSync(cefRoot, { withFileTypes: true })) {
      if (c.isDirectory()) roots.add(path.join(cefRoot, c.name));
    }
  } catch {
    // 目录不存在是当前常态
  }
  for (const r of roots) probeTree(r, 3, out, "cef");

  for (const d of opts.extraDirs ?? []) {
    const b = classify(d);
    if (b) out.push({ dir: d, backend: b, origin: "custom" });
  }

  // 去重
  const seen = new Set<string>();
  return out.filter((l) => {
    const k = path.resolve(l.dir).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
