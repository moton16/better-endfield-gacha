/**
 * Chromium SimpleCache（CEF 126 默认后端）只读解析：仅读取 `<16hex>_0` 文件头里的 key（URL）。
 *
 * 状态：⚠️ 前瞻兼容路径。官方当前仍在国服使用 QtWebEngine blockfile，CEF 目录尚不存在，
 * 本解析器依据 Chromium 源码布局编写，仅经合成夹具验证，未经真实 CEF 缓存实测。
 *
 * SimpleFileHeader（24B）：u64 magic=0xfcfb6d1ba7725c30, u32 version, u32 key_length, u32 key_hash, u32 pad
 */
import fs from "node:fs";
import path from "node:path";
import { extractUrlFromKey, SharedReadFile } from "./blockfile.js";
import type { CacheUrlEntry } from "./types.js";

export const SIMPLE_MAGIC = 0xfcfb6d1ba7725c30n;
const SIMPLE_HEADER_SIZE = 24;
const MAX_KEY_LEN = 8192;

export function looksLikeSimpleCache(dir: string): boolean {
  try {
    if (fs.existsSync(path.join(dir, "index-dir"))) return true;
    return fs.readdirSync(dir).some((n) => /^[0-9a-f]{16}_0$/.test(n));
  } catch {
    return false;
  }
}

export function readSimpleCacheEntries(dir: string): CacheUrlEntry[] {
  const out: CacheUrlEntry[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => /^[0-9a-f]{16}_0$/.test(n));
  } catch {
    return out;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    let f: SharedReadFile | null = null;
    try {
      f = new SharedReadFile(full);
      const head = f.read(0, SIMPLE_HEADER_SIZE);
      if (head.length < SIMPLE_HEADER_SIZE || head.readBigUInt64LE(0) !== SIMPLE_MAGIC) continue;
      const keyLen = head.readUInt32LE(12);
      if (keyLen === 0 || keyLen > MAX_KEY_LEN) continue;
      const keyBytes = f.read(SIMPLE_HEADER_SIZE, keyLen);
      if (keyBytes.length !== keyLen) continue;
      const key = keyBytes.toString("utf8");
      const url = extractUrlFromKey(key);
      if (!url) continue;
      const st = fs.statSync(full);
      const creation = Math.round(st.birthtimeMs);
      const lastUsed = Math.round(st.mtimeMs);
      out.push({
        key,
        url,
        creationTimeMs: creation,
        lastUsedMs: lastUsed,
        sortTimeMs: Math.max(creation, lastUsed),
        // key_hash 为 base::PersistentHash（非 SuperFastHash），此处仅以 magic + key 完整读取作为校验
        verified: true,
      });
    } catch {
      // 单文件失败跳过
    } finally {
      f?.close();
    }
  }
  return out;
}
