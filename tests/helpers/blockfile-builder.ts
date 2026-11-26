/**
 * 测试辅助：构造合成的 Chromium blockfile 缓存目录（index + data_0 + data_1 + 可选 f_*）。
 * 仅用于单元测试，所有 token/URL 均为虚构。
 */
import fs from "node:fs";
import path from "node:path";
import { BLOCK_HEADER_SIZE, BLOCK_MAGIC, INDEX_HEADER_SIZE, INDEX_MAGIC, superFastHash } from "../../src/core/cache/blockfile.js";

const WIN_EPOCH_MS = 11_644_473_600_000n;
export const toChromiumTime = (unixMs: number): bigint => (BigInt(unixMs) + WIN_EPOCH_MS) * 1000n;

export interface FakeEntry {
  url: string;
  keyPrefix?: string;
  creationMs: number;
  lastUsedMs: number;
  /** 强制把 key 放到外部 f_ 文件（模拟超长 key） */
  externalKey?: boolean;
  /** 破坏 key hash（模拟写入中的半成品） */
  corrupt?: boolean;
}

const BLOCK_ADDR = (type: number, file: number, start: number, nblocks: number) =>
  (0x80000000 | (type << 28) | ((nblocks - 1) << 24) | (file << 16) | start) >>> 0;

export function buildBlockfileCache(dir: string, entries: FakeEntry[], opts: { crash?: number; tableLen?: number } = {}): void {
  fs.mkdirSync(dir, { recursive: true });
  const tableLen = opts.tableLen ?? 1024;
  const index = Buffer.alloc(INDEX_HEADER_SIZE + tableLen * 4);
  index.writeUInt32LE(INDEX_MAGIC, 0);
  index.writeUInt32LE(0x20001, 4);
  index.writeInt32LE(entries.length, 8);
  index.writeInt32LE(tableLen, 28);
  index.writeInt32LE(opts.crash ?? 0, 32);

  const rankings = Buffer.alloc(BLOCK_HEADER_SIZE + 36 * (entries.length + 1));
  rankings.writeUInt32LE(BLOCK_MAGIC, 0);
  rankings.writeUInt32LE(0x20000, 4);
  rankings.writeInt32LE(36, 12);
  rankings.writeInt32LE(entries.length, 16);

  const store = Buffer.alloc(BLOCK_HEADER_SIZE + 1024 * (entries.length + 1));
  store.writeUInt32LE(BLOCK_MAGIC, 0);
  store.writeUInt32LE(0x20000, 4);
  store.writeInt16LE(1, 8);
  store.writeInt32LE(256, 12);
  store.writeInt32LE(entries.length, 16);

  let externalNo = 1;
  entries.forEach((e, i) => {
    const key = Buffer.from(`${e.keyPrefix ?? ""}${e.url}`, "utf8");
    // 4 个 256B 块，足够内联
    const startBlock = i * 4;
    const nblocks = 4;
    const blk = Buffer.alloc(256 * nblocks);

    let hash = superFastHash(key);
    if (e.corrupt) hash = (hash ^ 0xdeadbeef) >>> 0;
    blk.writeUInt32LE(hash, 0);
    blk.writeUInt32LE(0, 4); // next
    const rankAddr = BLOCK_ADDR(1, 0, i, 1);
    blk.writeUInt32LE(rankAddr, 8);
    blk.writeInt32LE(1, 12);
    blk.writeInt32LE(0, 20); // ENTRY_NORMAL
    blk.writeBigUInt64LE(toChromiumTime(e.creationMs), 24);
    blk.writeInt32LE(key.length, 32);
    if (e.externalKey) {
      const fno = externalNo++;
      fs.writeFileSync(path.join(dir, `f_${fno.toString(16).padStart(6, "0")}`), key);
      blk.writeUInt32LE((0x80000000 | fno) >>> 0, 36);
    } else {
      key.copy(blk, 0x60);
    }
    blk.writeUInt32LE(superFastHash(blk.subarray(0, 0x5c)), 0x5c);
    blk.copy(store, BLOCK_HEADER_SIZE + startBlock * 256);

    const entryAddr = BLOCK_ADDR(2, 1, startBlock, nblocks);
    // rankings node
    const node = Buffer.alloc(36);
    node.writeBigUInt64LE(toChromiumTime(e.lastUsedMs), 0);
    node.writeBigUInt64LE(toChromiumTime(e.lastUsedMs), 8);
    node.writeUInt32LE(entryAddr, 20);
    node.writeUInt32LE(superFastHash(node.subarray(0, 32)), 32);
    node.copy(rankings, BLOCK_HEADER_SIZE + i * 36);

    // 放入哈希桶（同桶用 next 链）
    const bucket = hash & (tableLen - 1);
    const prev = index.readUInt32LE(INDEX_HEADER_SIZE + bucket * 4);
    if (prev !== 0) {
      store.writeUInt32LE(prev, BLOCK_HEADER_SIZE + startBlock * 256 + 4);
      // next 字段改了，需要重算 self hash
      const b2 = store.subarray(BLOCK_HEADER_SIZE + startBlock * 256, BLOCK_HEADER_SIZE + startBlock * 256 + 256);
      b2.writeUInt32LE(superFastHash(b2.subarray(0, 0x5c)), 0x5c);
    }
    index.writeUInt32LE(entryAddr, INDEX_HEADER_SIZE + bucket * 4);
  });

  fs.writeFileSync(path.join(dir, "index"), index);
  fs.writeFileSync(path.join(dir, "data_0"), rankings);
  fs.writeFileSync(path.join(dir, "data_1"), store);
}

/** 虚构的 328 字符 Base64 token（含 + / =，用于验证百分号编解码） */
export function fakeToken(seed: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let s = "";
  let x = 0;
  for (const ch of seed) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  while (s.length < 326) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    s += alphabet[(x >>> 16) % 64];
  }
  // 确保含 + / ，328 字符以 == 结尾
  s = "+" + s.slice(1, 100) + "/" + s.slice(101);
  return s.slice(0, 326) + "==";
}
