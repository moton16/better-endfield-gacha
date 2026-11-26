export interface CacheUrlEntry {
  /** 原始缓存 key */
  key: string;
  /** key 中的 http(s) URL */
  url: string;
  creationTimeMs: number;
  lastUsedMs: number;
  /** max(creation, last_used)，决定凭据新旧 */
  sortTimeMs: number;
  /** 完整性校验是否通过（blockfile: SuperFastHash；simple: key_hash/magic） */
  verified: boolean;
}

export type CacheBackend = "blockfile" | "simple";
export type CacheOrigin = "qtwebengine" | "cef" | "custom";

export interface CacheLocation {
  dir: string;
  backend: CacheBackend;
  origin: CacheOrigin;
}
