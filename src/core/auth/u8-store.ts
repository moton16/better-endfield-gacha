/**
 * 路线 A 已验证 `u8_token` 的 DPAPI 加密持久化存储（u8-cache.json）。
 *
 * 与 `Vault` 保持相同的威胁模型与隔离约定：
 *  - 明文 `u8_token` 绝不落盘，仅保存 DPAPI 加密后的 `cipher` 与脱敏元数据；
 *  - 按 `${region}:${channel ?? ""}` 分键隔离，避免官服("1") / B 服("2") / 国际服相互覆盖；
 *  - 非 Windows 平台在未注入自定义 `crypto` 时，或 `dataDir === ":memory:"` 时，优雅跳过持久化。
 */
import fs from "node:fs";
import path from "node:path";
import type { CachedCredential, EfRegion, PickFilter } from "../cache/extract.js";
import { fingerprint } from "../redact.js";
import { dpapi, type SecretCrypto } from "./dpapi.js";

export interface U8CredentialMeta {
  id: string;
  region: EfRegion;
  channel?: string;
  subChannel?: string;
  serverId: string;
  lang?: string;
  host: string;
  tokenFingerprint: string;
  paths: string[];
  sortTimeMs: number;
  creationTimeMs: number;
  lastUsedMs: number;
  verifiedAt: number;
}

interface StoredU8Entry extends U8CredentialMeta {
  cipher: string;
}

interface U8StoreFile {
  version: 1;
  entries: StoredU8Entry[];
}

export interface LoadedU8Credential extends U8CredentialMeta {
  token: string;
}

export type SaveU8Input = Pick<
  CachedCredential,
  | "token"
  | "tokenFingerprint"
  | "host"
  | "region"
  | "channel"
  | "subChannel"
  | "serverId"
  | "lang"
  | "paths"
  | "sortTimeMs"
  | "creationTimeMs"
  | "lastUsedMs"
>;

export function u8EntryId(region: EfRegion, channel?: string): string {
  return `${region}:${channel ?? ""}`;
}

function isOptStr(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string";
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isValidEntry(raw: unknown): raw is StoredU8Entry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const e = raw as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    e.id.length > 0 &&
    (e.region === "cn" || e.region === "global") &&
    isOptStr(e.channel) &&
    isOptStr(e.subChannel) &&
    typeof e.serverId === "string" &&
    isOptStr(e.lang) &&
    typeof e.host === "string" &&
    e.host.length > 0 &&
    typeof e.tokenFingerprint === "string" &&
    Array.isArray(e.paths) &&
    e.paths.every((p) => typeof p === "string") &&
    isFiniteNum(e.sortTimeMs) &&
    isFiniteNum(e.creationTimeMs) &&
    isFiniteNum(e.lastUsedMs) &&
    isFiniteNum(e.verifiedAt) &&
    typeof e.cipher === "string" &&
    e.cipher.length > 0
  );
}

function compareRecencyDesc(a: U8CredentialMeta, b: U8CredentialMeta): number {
  return b.verifiedAt - a.verifiedAt || b.sortTimeMs - a.sortTimeMs || b.lastUsedMs - a.lastUsedMs;
}

/** 路线 A `u8_token` 持久化仓库（`u8-cache.json`，位于数据目录）。 */
export class U8Store {
  readonly filePath: string;
  readonly isAvailable: boolean;
  private readonly crypto: SecretCrypto;

  constructor(dataDir: string, crypto?: SecretCrypto) {
    const hasCustomCrypto = crypto !== undefined && crypto !== dpapi;
    const validDir = Boolean(dataDir) && dataDir !== ":memory:";
    this.isAvailable = validDir && (process.platform === "win32" || hasCustomCrypto);
    this.crypto = crypto ?? dpapi;
    this.filePath = validDir ? path.join(dataDir, "u8-cache.json") : "";
  }

  private read(): U8StoreFile {
    if (!this.isAvailable) return { version: 1, entries: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<U8StoreFile>;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
        return { version: 1, entries: parsed.entries.filter(isValidEntry) };
      }
    } catch {
      // 文件缺失或损坏 → 视为空
    }
    return { version: 1, entries: [] };
  }

  private write(file: U8StoreFile): void {
    if (!this.isAvailable) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), "utf8");
  }

  save(cred: SaveU8Input, verifiedAt = Date.now()): U8CredentialMeta | null {
    if (!this.isAvailable) return null;
    const id = u8EntryId(cred.region, cred.channel);
    const cipher = this.crypto.encrypt(cred.token);
    const entry: StoredU8Entry = {
      id,
      region: cred.region,
      ...(cred.channel !== undefined ? { channel: cred.channel } : {}),
      ...(cred.subChannel !== undefined ? { subChannel: cred.subChannel } : {}),
      serverId: cred.serverId,
      ...(cred.lang !== undefined ? { lang: cred.lang } : {}),
      host: cred.host,
      tokenFingerprint: cred.tokenFingerprint || fingerprint(cred.token),
      paths: [...cred.paths],
      sortTimeMs: cred.sortTimeMs,
      creationTimeMs: cred.creationTimeMs,
      lastUsedMs: cred.lastUsedMs,
      verifiedAt,
      cipher,
    };
    const data = this.read();
    data.entries = data.entries.filter((e) => e.id !== id);
    data.entries.push(entry);
    this.write(data);
    const { cipher: _omit, ...meta } = entry;
    return meta;
  }

  list(): U8CredentialMeta[] {
    return this.read()
      .entries.map(({ cipher: _omit, ...meta }) => meta)
      .sort(compareRecencyDesc);
  }

  pick(filter: PickFilter = {}): LoadedU8Credential | null {
    if (!this.isAvailable) return null;
    const matching = this.read()
      .entries.filter(
        (e) => (!filter.region || e.region === filter.region) && (!filter.channel || e.channel === filter.channel),
      )
      .sort(compareRecencyDesc);

    for (const entry of matching) {
      try {
        const token = this.crypto.decrypt(entry.cipher);
        if (!token) continue;
        const { cipher: _omit, ...meta } = entry;
        return { ...meta, token };
      } catch {
        // 解密失败（例如换机或条目损坏）时跳过并回退
      }
    }
    return null;
  }

  touch(id: string, verifiedAt = Date.now()): boolean {
    if (!this.isAvailable) return false;
    const data = this.read();
    const target = data.entries.find((e) => e.id === id);
    if (!target) return false;
    target.verifiedAt = verifiedAt;
    this.write(data);
    return true;
  }

  remove(id: string): boolean {
    if (!this.isAvailable) return false;
    const data = this.read();
    const next = data.entries.filter((e) => e.id !== id);
    if (next.length === data.entries.length) return false;
    data.entries = next;
    this.write(data);
    return true;
  }

  clear(): number {
    if (!this.isAvailable) return 0;
    const count = this.read().entries.length;
    fs.rmSync(this.filePath, { force: true });
    return count;
  }
}
