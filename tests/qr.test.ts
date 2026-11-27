import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encodeQr, renderQrTerminal, type QrEcLevel, type QrMatrix } from "../src/core/qr.js";

// 独立 ISO/IEC 18004 解码校验器（只读矩阵像素，验证结构、格式/版本 BCH、掩码、RS 伴随式与 UTF-8 原文还原）
const ALIGN_COORDS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
  11: [6, 30, 54],
  12: [6, 32, 58],
  13: [6, 34, 62],
  14: [6, 26, 46, 66],
  15: [6, 26, 48, 70],
  16: [6, 26, 50, 74],
  17: [6, 30, 54, 78],
  18: [6, 30, 56, 82],
  19: [6, 30, 58, 86],
  20: [6, 34, 62, 90],
};

const BLOCK_SPEC: Record<number, { total: number; L: [number, number]; M: [number, number] }> = {
  1: { total: 26, L: [7, 1], M: [10, 1] },
  2: { total: 44, L: [10, 1], M: [16, 1] },
  3: { total: 70, L: [15, 1], M: [26, 1] },
  4: { total: 100, L: [20, 1], M: [18, 2] },
  5: { total: 134, L: [26, 1], M: [24, 2] },
  6: { total: 172, L: [18, 2], M: [16, 4] },
  7: { total: 196, L: [20, 2], M: [18, 4] },
  8: { total: 242, L: [24, 2], M: [22, 4] },
  9: { total: 292, L: [30, 2], M: [22, 5] },
  10: { total: 346, L: [18, 4], M: [26, 5] },
  11: { total: 404, L: [20, 4], M: [30, 5] },
  12: { total: 466, L: [24, 4], M: [22, 8] },
  13: { total: 532, L: [26, 4], M: [22, 9] },
  14: { total: 581, L: [30, 4], M: [24, 9] },
  15: { total: 655, L: [22, 6], M: [24, 10] },
  16: { total: 733, L: [24, 6], M: [28, 10] },
  17: { total: 815, L: [28, 6], M: [28, 11] },
  18: { total: 901, L: [30, 6], M: [26, 13] },
  19: { total: 991, L: [28, 7], M: [26, 14] },
  20: { total: 1085, L: [28, 8], M: [26, 16] },
};

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_EXP[i + 255] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
}

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : GF_EXP[(GF_LOG[a]! + GF_LOG[b]!) % 255]!;
}

function polyEval(coeffs: number[], x: number): number {
  let acc = 0;
  for (const c of coeffs) acc = gfMul(acc, x) ^ c;
  return acc;
}

function bchSyndrome(val: number, poly: number, width: number): number {
  let rem = val;
  for (let i = 18; i >= width; i--) {
    if (rem & (1 << i)) rem ^= poly << (i - width);
  }
  return rem;
}

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function buildFuncMask(version: number, size: number): boolean[][] {
  const f = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const mark = (r: number, c: number) => {
    if (r >= 0 && r < size && c >= 0 && c < size) f[r]![c] = true;
  };
  for (const [fr, fc] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) mark(fr + dr, fc + dc);
    }
  }
  for (let i = 8; i <= size - 9; i++) {
    mark(6, i);
    mark(i, 6);
  }
  const coords = ALIGN_COORDS[version]!;
  for (let i = 0; i < coords.length; i++) {
    for (let j = 0; j < coords.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === coords.length - 1) || (i === coords.length - 1 && j === 0)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) mark(coords[i]! + dr, coords[j]! + dc);
      }
    }
  }
  mark(size - 8, 8);
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      mark(8, i);
      mark(i, 8);
    }
  }
  for (let c = size - 8; c < size; c++) mark(8, c);
  for (let r = size - 7; r < size; r++) mark(r, 8);
  if (version >= 7) {
    for (let r = 0; r < 6; r++) {
      for (let c = size - 11; c < size - 8; c++) {
        mark(r, c);
        mark(c, r);
      }
    }
  }
  return f;
}

function decodeAndVerifyQr(qr: QrMatrix): { version: number; ec: QrEcLevel; mask: number; text: string } {
  const { size, modules } = qr;
  expect(modules).toHaveLength(size);
  for (const row of modules) expect(row).toHaveLength(size);

  const version = (size - 17) / 4;
  expect(Number.isInteger(version)).toBe(true);
  expect(version).toBeGreaterThanOrEqual(1);
  expect(version).toBeLessThanOrEqual(20);

  // 校验三个寻像图形 + 分隔区
  for (const [fr, fc] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = fr + dr;
        const c = fc + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const expected =
          dr >= 0 &&
          dr <= 6 &&
          dc >= 0 &&
          dc <= 6 &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        expect(modules[r]![c]).toBe(expected);
      }
    }
  }

  // 校验时序图形与暗模块
  for (let i = 8; i <= size - 9; i++) {
    expect(modules[6]![i]).toBe(i % 2 === 0);
    expect(modules[i]![6]).toBe(i % 2 === 0);
  }
  expect(modules[size - 8]![8]).toBe(true);

  // 校验校正图形
  const coords = ALIGN_COORDS[version]!;
  for (let i = 0; i < coords.length; i++) {
    for (let j = 0; j < coords.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === coords.length - 1) || (i === coords.length - 1 && j === 0)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          expect(modules[coords[i]! + dr]![coords[j]! + dc]).toBe(Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // 读取并校验两份格式信息（15-bit BCH）
  let fmt1 = 0;
  let fmt2 = 0;
  for (let i = 0; i <= 5; i++) {
    fmt1 |= (modules[i]![8] ? 1 : 0) << i;
    fmt2 |= (modules[8]![size - 1 - i] ? 1 : 0) << i;
  }
  fmt1 |= (modules[7]![8] ? 1 : 0) << 6;
  fmt2 |= (modules[8]![size - 7] ? 1 : 0) << 6;
  fmt1 |= (modules[8]![8] ? 1 : 0) << 7;
  fmt2 |= (modules[8]![size - 8] ? 1 : 0) << 7;
  fmt1 |= (modules[8]![7] ? 1 : 0) << 8;
  fmt2 |= (modules[size - 7]![8] ? 1 : 0) << 8;
  for (let i = 9; i < 15; i++) {
    fmt1 |= (modules[8]![14 - i] ? 1 : 0) << i;
    fmt2 |= (modules[size - 15 + i]![8] ? 1 : 0) << i;
  }
  expect(fmt1).toBe(fmt2);
  const rawFmt = fmt1 ^ 0x5412;
  expect(bchSyndrome(rawFmt, 0x537, 10)).toBe(0);
  const ecCode = (rawFmt >> 13) & 3;
  expect(ecCode === 1 || ecCode === 0).toBe(true);
  const ec: QrEcLevel = ecCode === 1 ? "L" : "M";
  const mask = (rawFmt >> 10) & 7;

  // Version >= 7 校验两份版本信息（18-bit BCH）
  if (version >= 7) {
    let v1 = 0;
    let v2 = 0;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      v1 |= (modules[b]![a] ? 1 : 0) << i;
      v2 |= (modules[a]![b] ? 1 : 0) << i;
    }
    expect(v1).toBe(v2);
    expect(bchSyndrome(v1, 0x1f25, 12)).toBe(0);
    expect(v1 >> 12).toBe(version);
  }

  // 提取全部数据位 + 掩码还原
  const isFunc = buildFuncMask(version, size);
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let off = 0; off < 2; off++) {
        const c = right - off;
        if (isFunc[r]![c]) continue;
        const val = modules[r]![c]! !== maskBit(mask, r, c);
        bits.push(val ? 1 : 0);
      }
    }
    upward = !upward;
  }

  const spec = BLOCK_SPEC[version]!;
  const [ecPerBlock, numBlocks] = spec[ec];
  expect(Math.floor(bits.length / 8)).toBe(spec.total);

  const codewords: number[] = [];
  for (let i = 0; i + 7 < bits.length && codewords.length < spec.total; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]!;
    codewords.push(b);
  }

  // 解交织数据块与纠错块，并校验每块 Reed-Solomon 伴随式 === 0
  const totalData = spec.total - ecPerBlock * numBlocks;
  const g2Blocks = totalData % numBlocks;
  const g1Blocks = numBlocks - g2Blocks;
  const g1Len = Math.floor(totalData / numBlocks);

  const dataBlocks: number[][] = Array.from({ length: numBlocks }, () => []);
  const ecBlocks: number[][] = Array.from({ length: numBlocks }, () => []);
  let idx = 0;
  for (let i = 0; i < g1Len; i++) {
    for (let b = 0; b < numBlocks; b++) dataBlocks[b]!.push(codewords[idx++]!);
  }
  for (let b = g1Blocks; b < numBlocks; b++) dataBlocks[b]!.push(codewords[idx++]!);
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) ecBlocks[b]!.push(codewords[idx++]!);
  }
  expect(idx).toBe(spec.total);

  for (let b = 0; b < numBlocks; b++) {
    const full = [...dataBlocks[b]!, ...ecBlocks[b]!];
    for (let root = 0; root < ecPerBlock; root++) {
      expect(polyEval(full, GF_EXP[root]!)).toBe(0);
    }
  }

  // 解析 Byte 模式载荷并还原 UTF-8 文本
  const flatData = dataBlocks.flat();
  const dataBits: number[] = [];
  for (const byte of flatData) {
    for (let k = 7; k >= 0; k--) dataBits.push((byte >>> k) & 1);
  }
  const readInt = (pos: number, len: number) => {
    let v = 0;
    for (let i = 0; i < len; i++) v = (v << 1) | dataBits[pos + i]!;
    return v;
  };
  expect(readInt(0, 4)).toBe(0b0100); // Byte 模式
  const ccLen = version <= 9 ? 8 : 16;
  const byteCount = readInt(4, ccLen);
  const rawBytes = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    rawBytes[i] = readInt(4 + ccLen + i * 8, 8);
  }
  return { version, ec, mask, text: new TextDecoder("utf-8", { fatal: true }).decode(rawBytes) };
}

function parseTerminalQr(ascii: string): QrMatrix {
  const lines = ascii.split("\n");
  const quiet = 2;
  const totalCols = lines[0]!.length;
  const size = totalCols - quiet * 2;
  const modules: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const gridRow = r + quiet;
    const line = lines[Math.floor(gridRow / 2)]!;
    const isTop = gridRow % 2 === 0;
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) {
      const ch = line[c + quiet]!;
      const dark =
        ch === " "
          ? true
          : ch === "█"
            ? false
            : ch === "▀"
              ? !isTop
              : ch === "▄"
                ? isTop
                : (() => {
                    throw new Error(`unexpected char: ${ch}`);
                  })();
      row.push(dark);
    }
    modules.push(row);
  }
  return { size, modules };
}

describe("零依赖二维码编码器 (src/core/qr.ts)", () => {
  it("零 Node.js 依赖与零外部 URL", () => {
    const src = fs.readFileSync(path.resolve("src/core/qr.ts"), "utf8");
    expect(src).not.toMatch(/["']node:/);
    expect(src).not.toMatch(/https?:\/\//i);
  });

  it("支持默认 M 级与 L 级编码、完整往返解码与 RS 伴随式校验", () => {
    const scanUrl63 = "hypergryph://scan_login?scanId=0123456789abcdef0123456789abcdef"; // 63 字节
    const mDefault = encodeQr(scanUrl63);
    expect(mDefault.size).toBe(37); // 63 字节超过 V4-M 上限 (62B)，自动升至 Version 5 (37x37)
    expect(decodeAndVerifyQr(mDefault)).toEqual({ version: 5, ec: "M", mask: expect.any(Number), text: scanUrl63 });

    const scanUrl59 = "hypergryph://scan_login?scanId=0123456789abcdef0123456789ab"; // 59 字节
    const mV4 = encodeQr(scanUrl59);
    expect(mV4.size).toBe(33); // 59 字节落入 V4-M (33x33)
    expect(decodeAndVerifyQr(mV4)).toEqual({ version: 4, ec: "M", mask: expect.any(Number), text: scanUrl59 });

    const mLow = encodeQr(scanUrl63, "L");
    expect(mLow.size).toBe(33); // 63 字节在 L 级落入 Version 4 (上限 78B)
    expect(decodeAndVerifyQr(mLow)).toEqual({ version: 4, ec: "L", mask: expect.any(Number), text: scanUrl63 });
  });

  it("核对 ISO 18004 已知格式信息/版本信息/Byte 载荷与多版本扩展 (V1..V15)", () => {
    // 验证 V7 版本信息 BCH 固定常数为 ISO 18004 Annex D 的 0x07c94
    const v7 = encodeQr("x".repeat(122), "M");
    let verBits = 0;
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = v7.size - 11 + (i % 3);
      verBits |= (v7.modules[r]![c] ? 1 : 0) << i;
    }
    expect(verBits).toBe(0x07c94);

    const cases: Array<{ text: string; ec: QrEcLevel; expectedVersion: number }> = [
      { text: "", ec: "M", expectedVersion: 1 },
      { text: "hello", ec: "L", expectedVersion: 1 },
      { text: "12345678901234", ec: "M", expectedVersion: 1 }, // 14B 满 V1-M
      { text: "123456789012345", ec: "M", expectedVersion: 2 }, // 15B -> V2-M
      { text: "终末地抽卡分析 · 扫码登录 🚀 café", ec: "M", expectedVersion: 4 }, // 50B UTF-8 -> V4-M
      { text: "x".repeat(122), ec: "M", expectedVersion: 7 }, // V7-M（首次出现版本信息）
      { text: "x".repeat(213), ec: "M", expectedVersion: 10 }, // V10-M（16-bit 长度字段）
      { text: "x".repeat(271), ec: "L", expectedVersion: 10 }, // V10-L
      { text: "x".repeat(400), ec: "M", expectedVersion: 15 }, // V15-M（4 个校正点）
    ];

    for (const c of cases) {
      const qr = encodeQr(c.text, c.ec);
      expect(qr.size).toBe(17 + 4 * c.expectedVersion);
      const decoded = decodeAndVerifyQr(qr);
      expect(decoded).toEqual({ version: c.expectedVersion, ec: c.ec, mask: expect.any(Number), text: c.text });
    }
  });

  it("超长载荷抛出 RangeError", () => {
    expect(() => encodeQr("a".repeat(900), "L")).toThrow(RangeError);
    expect(() => encodeQr("a".repeat(700), "M")).toThrow(RangeError);
  });

  it("renderQrTerminal 渲染 2 格浅色静默区半高块字符，且可无损反向解析解码", () => {
    const url = "hypergryph://scan_login?scanId=fedcba9876543210fedcba9876543210";
    const ascii = renderQrTerminal(url);
    const lines = ascii.split("\n");
    const { size } = encodeQr(url);
    const total = size + 4;

    expect(lines).toHaveLength(Math.ceil(total / 2));
    for (const line of lines) {
      expect(line).toHaveLength(total);
      expect(line).toMatch(/^[█ ▀▄]+$/);
      expect(line.startsWith("██")).toBe(true);
      expect(line.endsWith("██")).toBe(true);
    }
    // 首行与末行对应上下 2 格静默区，应全部为浅色块 "█"
    expect(lines[0]).toBe("█".repeat(total));
    expect(lines[lines.length - 1]).toBe("█".repeat(total));

    // 从终端字符反向还原矩阵再走独立解码器验证端到端无损
    const roundtrip = parseTerminalQr(ascii);
    expect(decodeAndVerifyQr(roundtrip).text).toBe(url);
  });
});
