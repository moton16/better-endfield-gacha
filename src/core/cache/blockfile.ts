/**
 * Chromium "blockfile" disk cache 只读解析器（QtWebEngine / 旧版 Chromium 使用）。
 *
 * 布局参考 chromium/net/disk_cache/blockfile：
 *   index        : 368B 头 + table_len * 4B 地址哈希表
 *   data_0..3    : 8192B 头 + 定长块（0=rankings 36B, 1=256B, 2=1KB, 3=4KB）
 *   f_XXXXXX     : 外部文件（超长 key / 大 body）
 *
 * 红线：
 *  - 所有文件仅以只读方式打开。Node/libuv 在 Windows 上固定使用
 *    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE，等价于必须的 CreateFileW 共享标志，
 *    因此游戏运行期间（PlatformProcess.exe 持有 DELETE 句柄）也不会 EBUSY/EACCES。
 *  - 不因 index.crash != 0 退出，完整性只依赖 magic + SuperFastHash。
 */
import fs from "node:fs";
import path from "node:path";

export const INDEX_MAGIC = 0xc103cac3;
export const BLOCK_MAGIC = 0xc104cac3;
export const INDEX_HEADER_SIZE = 368;
export const BLOCK_HEADER_SIZE = 8192;
export const ENTRY_STORE_MIN_SIZE = 0x60;

/** 1601-01-01 → 1970-01-01 的毫秒偏移 */
const WINDOWS_EPOCH_OFFSET_MS = 11_644_473_600_000n;

/**
 * 缓存 key → URL。key 可能是裸 URL，也可能带 `1/0/_dk_<site> <site> <url>` 这类网络隔离前缀；
 * URL 经过百分号编码不含空格，因此取最后一个以 http(s):// 开头的空白分隔片段，兜底取第一个 http 起的后缀。
 */
export function extractUrlFromKey(key: string): string | null {
  const parts = key.split(/\s+/);
  const last = parts[parts.length - 1] ?? "";
  if (/^https?:\/\//.test(last)) return last;
  const m = /https?:\/\//.exec(key);
  return m ? key.slice(m.index) : null;
}

export function chromiumTimeToUnixMs(micros: bigint): number {
  if (micros <= 0n) return 0;
  return Number(micros / 1000n - WINDOWS_EPOCH_OFFSET_MS);
}

/** Paul Hsieh SuperFastHash（net::disk_cache::SuperFastHash），返回 uint32 */
export function superFastHash(data: Uint8Array): number {
  const len = data.length;
  if (len === 0) return 0;
  const g16 = (i: number) => data[i]! | (data[i + 1]! << 8);
  const s8 = (b: number) => (b >= 128 ? b - 256 : b);
  let h = len >>> 0;
  const rem = len & 3;
  let p = 0;
  for (let n = len >>> 2; n > 0; n--) {
    h = (h + g16(p)) >>> 0;
    const tmp = ((g16(p + 2) << 11) ^ h) >>> 0;
    h = ((h << 16) ^ tmp) >>> 0;
    p += 4;
    h = (h + (h >>> 11)) >>> 0;
  }
  switch (rem) {
    case 3:
      h = (h + g16(p)) >>> 0;
      h = (h ^ (h << 16)) >>> 0;
      h = (h ^ (s8(data[p + 2]!) << 18)) >>> 0;
      h = (h + (h >>> 11)) >>> 0;
      break;
    case 2:
      h = (h + g16(p)) >>> 0;
      h = (h ^ (h << 11)) >>> 0;
      h = (h + (h >>> 17)) >>> 0;
      break;
    case 1:
      h = (h + s8(data[p]!)) >>> 0;
      h = (h ^ (h << 10)) >>> 0;
      h = (h + (h >>> 1)) >>> 0;
      break;
  }
  h = (h ^ (h << 3)) >>> 0;
  h = (h + (h >>> 5)) >>> 0;
  h = (h ^ (h << 4)) >>> 0;
  h = (h + (h >>> 17)) >>> 0;
  h = (h ^ (h << 25)) >>> 0;
  h = (h + (h >>> 6)) >>> 0;
  return h >>> 0;
}

export interface DecodedAddr {
  initialized: boolean;
  /** 0 = 外部 f_ 文件，1..7 = 块文件类型 */
  fileType: number;
  /** 外部文件号（fileType==0） */
  fileNumber: number;
  /** 块文件序号（data_N 的 N） */
  fileSelector: number;
  startBlock: number;
  numBlocks: number;
}

export function decodeAddr(addr: number): DecodedAddr {
  const a = addr >>> 0;
  const fileType = (a >>> 28) & 0x7;
  return {
    initialized: (a & 0x80000000) !== 0,
    fileType,
    fileNumber: a & 0x0fffffff,
    fileSelector: (a >>> 16) & 0xff,
    startBlock: a & 0xffff,
    numBlocks: ((a >>> 24) & 0x3) + 1,
  };
}

/** 以只读（libuv 全共享）方式打开的文件，支持定位读取，不整体载入内存。 */
export class SharedReadFile {
  private fd: number;
  readonly size: number;

  constructor(readonly filePath: string) {
    this.fd = fs.openSync(filePath, "r");
    this.size = fs.fstatSync(this.fd).size;
  }

  read(offset: number, length: number): Buffer {
    if (offset < 0 || offset >= this.size) return Buffer.alloc(0);
    const len = Math.min(length, this.size - offset);
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const n = fs.readSync(this.fd, buf, got, len - got, offset + got);
      if (n === 0) break;
      got += n;
    }
    return got === len ? buf : buf.subarray(0, got);
  }

  close(): void {
    if (this.fd >= 0) {
      fs.closeSync(this.fd);
      this.fd = -1;
    }
  }
}

interface BlockFileInfo {
  file: SharedReadFile;
  entrySize: number;
}

export interface BlockfileIndexInfo {
  magic: number;
  version: number;
  numEntries: number;
  tableLen: number;
  /** 仅供诊断：crash==1 不是错误 */
  crash: number;
}

export interface BlockfileEntry {
  /** 原始 key（可能带 `1/0/_dk_...` 之类前缀） */
  key: string;
  /** key 内第一个 http(s):// 开始的 URL，没有则 null */
  url: string | null;
  creationTimeMs: number;
  lastUsedMs: number;
  /** max(creation, last_used)，凭据新旧排序依据 */
  sortTimeMs: number;
  state: number;
  reuseCount: number;
  /** key 的 SuperFastHash 是否与 entry.hash 一致 */
  keyHashOk: boolean;
  /** EntryStore 自身 SuperFastHash 是否一致 */
  selfHashOk: boolean;
}

export class BlockfileCache {
  readonly index: BlockfileIndexInfo;
  private table: Uint32Array;
  private blockFiles = new Map<number, BlockFileInfo>();

  constructor(readonly cacheDir: string) {
    const indexPath = path.join(cacheDir, "index");
    const idx = new SharedReadFile(indexPath);
    try {
      const head = idx.read(0, INDEX_HEADER_SIZE);
      if (head.length < INDEX_HEADER_SIZE) throw new Error("index 文件过短");
      const magic = head.readUInt32LE(0);
      if (magic !== INDEX_MAGIC) {
        throw new Error(`非 blockfile 缓存 index（magic=0x${magic.toString(16)}）`);
      }
      let tableLen = head.readInt32LE(28);
      if (tableLen === 0) tableLen = 0x10000;
      this.index = {
        magic,
        version: head.readUInt32LE(4),
        numEntries: head.readInt32LE(8),
        tableLen,
        crash: head.readInt32LE(32),
      };
      const raw = idx.read(INDEX_HEADER_SIZE, tableLen * 4);
      if (raw.length < tableLen * 4) {
        // 容忍被截断的 index（崩溃/写入中）：缺失桶视为空
        const padded = Buffer.alloc(tableLen * 4);
        raw.copy(padded);
        this.table = new Uint32Array(padded.buffer, padded.byteOffset, tableLen);
      } else {
        this.table = new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
      }
    } finally {
      idx.close();
    }

    for (const name of fs.readdirSync(cacheDir)) {
      const m = /^data_(\d+)$/.exec(name);
      if (!m) continue;
      try {
        const f = new SharedReadFile(path.join(cacheDir, name));
        const head = f.read(0, 24);
        if (head.length < 24 || head.readUInt32LE(0) !== BLOCK_MAGIC) {
          f.close();
          continue;
        }
        this.blockFiles.set(Number(m[1]), { file: f, entrySize: head.readInt32LE(12) });
      } catch {
        // 单个块文件不可读不影响其余文件
      }
    }
  }

  close(): void {
    for (const b of this.blockFiles.values()) b.file.close();
    this.blockFiles.clear();
  }

  private readAddr(addr: number, maxLen?: number): Buffer | null {
    const a = decodeAddr(addr);
    if (!a.initialized) return null;
    if (a.fileType === 0) {
      const p = path.join(this.cacheDir, `f_${a.fileNumber.toString(16).padStart(6, "0")}`);
      let f: SharedReadFile | null = null;
      try {
        f = new SharedReadFile(p);
        return f.read(0, maxLen ?? f.size);
      } catch {
        return null;
      } finally {
        f?.close();
      }
    }
    const bf = this.blockFiles.get(a.fileSelector);
    if (!bf) return null;
    const off = BLOCK_HEADER_SIZE + a.startBlock * bf.entrySize;
    const buf = bf.file.read(off, a.numBlocks * bf.entrySize);
    return buf.length > 0 ? buf : null;
  }

  private readRankingsLastUsedMs(addr: number): number {
    const blk = this.readAddr(addr);
    if (!blk || blk.length < 36) return 0;
    const selfHash = blk.readUInt32LE(32);
    if (superFastHash(blk.subarray(0, 32)) !== selfHash) return 0;
    return chromiumTimeToUnixMs(blk.readBigUInt64LE(0));
  }

  /** 遍历哈希表所有桶/链，逐条解析 EntryStore。单条异常会被跳过。 */
  *entries(): Generator<BlockfileEntry> {
    const visited = new Set<number>();
    for (let bucket = 0; bucket < this.table.length; bucket++) {
      let cur = this.table[bucket]!;
      while (cur !== 0 && !visited.has(cur)) {
        visited.add(cur);
        let parsed: { entry: BlockfileEntry; next: number } | null = null;
        try {
          parsed = this.parseEntry(cur);
        } catch {
          parsed = null;
        }
        if (!parsed) break;
        yield parsed.entry;
        cur = parsed.next;
      }
    }
  }

  private parseEntry(addr: number): { entry: BlockfileEntry; next: number } | null {
    const blk = this.readAddr(addr);
    if (!blk || blk.length < 256) return null;
    const hash = blk.readUInt32LE(0);
    const next = blk.readUInt32LE(4);
    const rankAddr = blk.readUInt32LE(8);
    const reuseCount = blk.readInt32LE(12);
    const state = blk.readInt32LE(20);
    const creation = blk.readBigUInt64LE(24);
    const keyLen = blk.readInt32LE(32);
    const longKey = blk.readUInt32LE(36);
    const selfHash = blk.readUInt32LE(0x5c);
    if (keyLen <= 0 || keyLen > 1_000_000) return { entry: this.emptyEntry(state), next };

    let keyBytes: Buffer;
    if (longKey !== 0) {
      const kb = this.readAddr(longKey, keyLen);
      keyBytes = kb ? kb.subarray(0, keyLen) : Buffer.alloc(0);
    } else {
      keyBytes = blk.subarray(0x60, 0x60 + keyLen);
    }

    const key = keyBytes.toString("utf8");
    const creationMs = chromiumTimeToUnixMs(creation);
    const lastUsedMs = rankAddr ? this.readRankingsLastUsedMs(rankAddr) : 0;
    return {
      next,
      entry: {
        key,
        url: extractUrlFromKey(key),
        creationTimeMs: creationMs,
        lastUsedMs,
        sortTimeMs: Math.max(creationMs, lastUsedMs),
        state,
        reuseCount,
        keyHashOk: keyBytes.length === keyLen && superFastHash(keyBytes) === hash,
        selfHashOk: superFastHash(blk.subarray(0, 0x5c)) === selfHash,
      },
    };
  }

  private emptyEntry(state: number): BlockfileEntry {
    return {
      key: "",
      url: null,
      creationTimeMs: 0,
      lastUsedMs: 0,
      sortTimeMs: 0,
      state,
      reuseCount: 0,
      keyHashOk: false,
      selfHashOk: false,
    };
  }
}

/** 判断目录是否像 blockfile 缓存（index + data_0） */
export function looksLikeBlockfileCache(dir: string): boolean {
  try {
    if (!fs.existsSync(path.join(dir, "index")) || !fs.existsSync(path.join(dir, "data_0"))) return false;
    const f = new SharedReadFile(path.join(dir, "index"));
    try {
      const h = f.read(0, 4);
      return h.length === 4 && h.readUInt32LE(0) === INDEX_MAGIC;
    } finally {
      f.close();
    }
  } catch {
    return false;
  }
}
