/**
 * 从缓存 URL 中提取 u8_token（路线 A 的核心）。
 *
 * 规则（均有实机依据，见 docs/DEVELOPER.md）：
 *  - `/page/gacha_*`   → 查询参数 `u8_token=`
 *  - `/api/record/*`   → 查询参数 `token=`
 *  - 值在缓存里是 URL 编码的 Base64（`+ / =` 被百分号转义），必须先 decodeURIComponent
 *    还原成 328 字符 Base64，再在请求时重新编码；
 *  - 按 max(creation_time, last_used) 选最新，避免取到前几天的过期令牌；
 *  - 不使用 Session Storage（非抽卡页面写入，关窗即 DEL）。
 */
import { BlockfileCache } from "./blockfile.js";
import { readSimpleCacheEntries } from "./simplecache.js";
import type { CacheLocation, CacheUrlEntry } from "./types.js";
import { fingerprint } from "../redact.js";

export type EfRegion = "cn" | "global";

export interface CachedCredential {
  /** 已 URL 解码的 token（328 字符 Base64）。严禁打印/落库明文。 */
  token: string;
  tokenFingerprint: string;
  host: string;
  region: EfRegion;
  /** 来自页面 URL 的 channel（"1" 官服 / "2" B 服），API 请求没有此信息，同 token 的页面条目可补全 */
  channel?: string;
  subChannel?: string;
  /** 国服恒为 "1"；国际服取 URL 中的 server/server_id */
  serverId: string;
  lang?: string;
  /** 该 token 出现过的路径（去重） */
  paths: string[];
  sortTimeMs: number;
  creationTimeMs: number;
  lastUsedMs: number;
  /** 命中所属的缓存位置 */
  source: Pick<CacheLocation, "dir" | "backend" | "origin">;
  /** token 不是预期的 328 字符时给出提示 */
  warnings: string[];
}

const CN_HOST = "ef-webview.hypergryph.com";
const GLOBAL_HOST = "ef-webview.gryphline.com";
const EXPECTED_TOKEN_LEN = 328;

function rawQuery(url: string): Map<string, string> {
  const q = url.indexOf("?");
  const map = new Map<string, string>();
  if (q < 0) return map;
  const hash = url.indexOf("#", q);
  const qs = url.slice(q + 1, hash < 0 ? undefined : hash);
  for (const part of qs.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const k = eq < 0 ? part : part.slice(0, eq);
    const v = eq < 0 ? "" : part.slice(eq + 1);
    if (!map.has(k)) map.set(k, v);
  }
  return map;
}

/** 还原百分号编码；绝不把 `+` 当空格（Base64 里的 + 若未被编码，空格才是被错误转换的结果）。 */
export function decodeTokenValue(raw: string): string | null {
  let v: string;
  try {
    v = decodeURIComponent(raw);
  } catch {
    return null;
  }
  v = v.replace(/ /g, "+").trim();
  if (v.length < 100) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  return v;
}

export interface ParsedCredentialUrl {
  token: string;
  host: string;
  region: EfRegion;
  path: string;
  kind: "page" | "api";
  channel?: string;
  subChannel?: string;
  serverId: string;
  lang?: string;
}

export function parseCredentialUrl(url: string): ParsedCredentialUrl | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host !== CN_HOST && host !== GLOBAL_HOST) return null;
  const region: EfRegion = host === GLOBAL_HOST ? "global" : "cn";
  const p = u.pathname;
  let kind: "page" | "api";
  let param: string;
  if (p.startsWith("/page/gacha_")) {
    kind = "page";
    param = "u8_token";
  } else if (p.startsWith("/api/record/")) {
    kind = "api";
    param = "token";
  } else {
    return null;
  }
  const q = rawQuery(url);
  const rawToken = q.get(param);
  if (!rawToken) return null;
  const token = decodeTokenValue(rawToken);
  if (!token) return null;
  const dec = (k: string) => {
    const v = q.get(k);
    if (v == null) return undefined;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  const serverId = region === "cn" ? "1" : (dec("server_id") ?? dec("server") ?? "");
  return {
    token,
    host,
    region,
    path: p,
    kind,
    channel: dec("channel"),
    subChannel: dec("subChannel"),
    serverId,
    lang: dec("lang"),
  };
}

/** 把若干缓存条目聚合成按 token 去重、按新旧倒序的凭据列表 */
export function collectCredentials(
  entries: Iterable<CacheUrlEntry>,
  source: CachedCredential["source"],
): CachedCredential[] {
  const byToken = new Map<string, CachedCredential>();
  for (const e of entries) {
    if (!e.verified) continue;
    const parsed = parseCredentialUrl(e.url);
    if (!parsed) continue;
    let cred = byToken.get(parsed.token);
    if (!cred) {
      const warnings: string[] = [];
      if (parsed.token.length !== EXPECTED_TOKEN_LEN) {
        warnings.push(`token 长度 ${parsed.token.length}，与已实证的 ${EXPECTED_TOKEN_LEN} 不一致`);
      }
      cred = {
        token: parsed.token,
        tokenFingerprint: fingerprint(parsed.token),
        host: parsed.host,
        region: parsed.region,
        serverId: parsed.serverId,
        paths: [],
        sortTimeMs: 0,
        creationTimeMs: 0,
        lastUsedMs: 0,
        source,
        warnings,
      };
      byToken.set(parsed.token, cred);
    }
    if (!cred.paths.includes(parsed.path)) cred.paths.push(parsed.path);
    if (parsed.channel && !cred.channel) cred.channel = parsed.channel;
    if (parsed.subChannel && !cred.subChannel) cred.subChannel = parsed.subChannel;
    if (parsed.lang && !cred.lang) cred.lang = parsed.lang;
    if (parsed.region === "global" && parsed.serverId && !cred.serverId) cred.serverId = parsed.serverId;
    cred.creationTimeMs = Math.max(cred.creationTimeMs, e.creationTimeMs);
    cred.lastUsedMs = Math.max(cred.lastUsedMs, e.lastUsedMs);
    cred.sortTimeMs = Math.max(cred.sortTimeMs, e.sortTimeMs);
  }
  return [...byToken.values()].sort((a, b) => b.sortTimeMs - a.sortTimeMs);
}

export function* blockfileUrlEntries(cache: BlockfileCache): Generator<CacheUrlEntry> {
  for (const e of cache.entries()) {
    if (!e.url) continue;
    yield {
      key: e.key,
      url: e.url,
      creationTimeMs: e.creationTimeMs,
      lastUsedMs: e.lastUsedMs,
      sortTimeMs: e.sortTimeMs,
      // 同时要求 key 哈希与 entry 自哈希通过；写入中的半成品条目会被丢弃
      verified: e.keyHashOk && e.selfHashOk,
    };
  }
}

export interface ScanResult {
  locations: CacheLocation[];
  credentials: CachedCredential[];
  errors: Array<{ dir: string; message: string }>;
}

export function scanLocations(locations: CacheLocation[]): ScanResult {
  const all: CachedCredential[] = [];
  const errors: ScanResult["errors"] = [];
  for (const loc of locations) {
    try {
      const src = { dir: loc.dir, backend: loc.backend, origin: loc.origin };
      if (loc.backend === "blockfile") {
        const cache = new BlockfileCache(loc.dir);
        try {
          all.push(...collectCredentials(blockfileUrlEntries(cache), src));
        } finally {
          cache.close();
        }
      } else {
        all.push(...collectCredentials(readSimpleCacheEntries(loc.dir), src));
      }
    } catch (err) {
      errors.push({ dir: loc.dir, message: err instanceof Error ? err.message : String(err) });
    }
  }
  // 跨目录同 token 合并取最新
  const merged = new Map<string, CachedCredential>();
  for (const c of all) {
    const prev = merged.get(c.token);
    if (!prev || c.sortTimeMs > prev.sortTimeMs) {
      if (prev) {
        c.channel ??= prev.channel;
        c.subChannel ??= prev.subChannel;
      }
      merged.set(c.token, c);
    }
  }
  return {
    locations,
    credentials: [...merged.values()].sort((a, b) => b.sortTimeMs - a.sortTimeMs),
    errors,
  };
}

export interface PickFilter {
  region?: EfRegion;
  /** "1" 官服 / "2" B 服 */
  channel?: string;
}

export function pickBestCredential(creds: CachedCredential[], filter: PickFilter = {}): CachedCredential | undefined {
  return creds.find(
    (c) => (!filter.region || c.region === filter.region) && (!filter.channel || c.channel === filter.channel),
  );
}

/** 构造可直接粘贴的完整抽卡链接（含 u8_token，属敏感信息） */
export function buildGachaLink(
  cred: Pick<CachedCredential, "token" | "host" | "channel" | "subChannel" | "serverId" | "lang">,
  page: "gacha_char" | "gacha_weapon" = "gacha_char",
): string {
  const q = new URLSearchParams();
  if (cred.channel) q.set("channel", cred.channel);
  if (cred.subChannel) q.set("subChannel", cred.subChannel);
  q.set("platform", "Windows");
  q.set("lang", cred.lang ?? "zh-cn");
  q.set("server", cred.serverId);
  q.set("u8_token", cred.token);
  return `https://${cred.host}/page/${page}?${q.toString()}`;
}
