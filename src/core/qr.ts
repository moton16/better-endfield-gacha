/**
 * 零依赖 ISO/IEC 18004 二维码编码器（Byte 模式 / UTF-8，EC 等级 L / M，支持 Version 1..20）。
 * 无任何 Node.js 依赖，供 CLI 终端渲染与 Web 前端 SVG 共用。
 */

export type QrEcLevel = "L" | "M";

export interface QrMatrix {
  size: number;
  modules: boolean[][];
}

interface VersionSpec {
  totalCodewords: number;
  ecL: readonly [ecPerBlock: number, numBlocks: number];
  ecM: readonly [ecPerBlock: number, numBlocks: number];
  align: readonly number[];
}

// ISO/IEC 18004 表 9（Version 1..20，纠错等级 L / M）与校正图形中心坐标
const VERSIONS: readonly VersionSpec[] = [
  { totalCodewords: 0, ecL: [0, 0], ecM: [0, 0], align: [] }, // 占位（1-based）
  { totalCodewords: 26, ecL: [7, 1], ecM: [10, 1], align: [] },
  { totalCodewords: 44, ecL: [10, 1], ecM: [16, 1], align: [6, 18] },
  { totalCodewords: 70, ecL: [15, 1], ecM: [26, 1], align: [6, 22] },
  { totalCodewords: 100, ecL: [20, 1], ecM: [18, 2], align: [6, 26] },
  { totalCodewords: 134, ecL: [26, 1], ecM: [24, 2], align: [6, 30] },
  { totalCodewords: 172, ecL: [18, 2], ecM: [16, 4], align: [6, 34] },
  { totalCodewords: 196, ecL: [20, 2], ecM: [18, 4], align: [6, 22, 38] },
  { totalCodewords: 242, ecL: [24, 2], ecM: [22, 4], align: [6, 24, 42] },
  { totalCodewords: 292, ecL: [30, 2], ecM: [22, 5], align: [6, 26, 46] },
  { totalCodewords: 346, ecL: [18, 4], ecM: [26, 5], align: [6, 28, 50] },
  { totalCodewords: 404, ecL: [20, 4], ecM: [30, 5], align: [6, 30, 54] },
  { totalCodewords: 466, ecL: [24, 4], ecM: [22, 8], align: [6, 32, 58] },
  { totalCodewords: 532, ecL: [26, 4], ecM: [22, 9], align: [6, 34, 62] },
  { totalCodewords: 581, ecL: [30, 4], ecM: [24, 9], align: [6, 26, 46, 66] },
  { totalCodewords: 655, ecL: [22, 6], ecM: [24, 10], align: [6, 26, 48, 70] },
  { totalCodewords: 733, ecL: [24, 6], ecM: [28, 10], align: [6, 26, 50, 74] },
  { totalCodewords: 815, ecL: [28, 6], ecM: [28, 11], align: [6, 30, 54, 78] },
  { totalCodewords: 901, ecL: [30, 6], ecM: [26, 13], align: [6, 30, 56, 82] },
  { totalCodewords: 991, ecL: [28, 7], ecM: [26, 14], align: [6, 30, 58, 86] },
  { totalCodewords: 1085, ecL: [28, 8], ecM: [26, 16], align: [6, 34, 62, 90] },
];

// GF(256) 指数与对数表（本原多项式 x^8 + x^4 + x^3 + x^2 + 1 = 0x11d）
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
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a]! + GF_LOG[b]!) % 255]!;
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i]!;
    for (let j = 0; j < poly.length; j++) {
      const c = poly[j]!;
      next[j] = (next[j]! ^ c) & 0xff;
      next[j + 1] = (next[j + 1]! ^ gfMul(c, root)) & 0xff;
    }
    poly = next;
  }
  return poly;
}

function rsComputeEc(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGeneratorPoly(ecCount);
  const rem = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i]! ^ rem[0]!;
    rem.copyWithin(0, 1);
    rem[ecCount - 1] = 0;
    for (let j = 0; j < ecCount; j++) {
      rem[j] = (rem[j]! ^ gfMul(gen[j + 1]!, factor)) & 0xff;
    }
  }
  return rem;
}

function bchRemainder(data: number, poly: number, width: number): number {
  let rem = data << width;
  const topBit = 1 << width;
  for (let i = 16; i >= 0; i--) {
    if (rem & (topBit << i)) {
      rem ^= poly << i;
    }
  }
  return rem;
}

function formatBits(ec: QrEcLevel, mask: number): number {
  // ISO 18004: L=01, M=00
  const data = ((ec === "L" ? 1 : 0) << 3) | (mask & 7);
  return (((data << 10) | bchRemainder(data, 0x537, 10)) ^ 0x5412) & 0x7fff;
}

function versionBits(version: number): number {
  return ((version << 12) | bchRemainder(version, 0x1f25, 12)) & 0x3ffff;
}

function pushBits(bits: number[], value: number, count: number): void {
  for (let i = count - 1; i >= 0; i--) {
    bits.push((value >>> i) & 1);
  }
}

function buildCodewords(bytes: Uint8Array, version: number, ec: QrEcLevel): Uint8Array {
  const spec = VERSIONS[version]!;
  const [ecPerBlock, numBlocks] = ec === "L" ? spec.ecL : spec.ecM;
  const totalData = spec.totalCodewords - ecPerBlock * numBlocks;

  const bits: number[] = [];
  pushBits(bits, 0b0100, 4); // Byte 模式
  pushBits(bits, bytes.length, version <= 9 ? 8 : 16);
  for (let i = 0; i < bytes.length; i++) {
    pushBits(bits, bytes[i]!, 8);
  }

  const capacityBits = totalData * 8;
  const term = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(totalData);
  let byteIdx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]!;
    dataBytes[byteIdx++] = b;
  }
  for (let padIdx = 0; byteIdx < totalData; padIdx++) {
    dataBytes[byteIdx++] = padIdx % 2 === 0 ? 0xec : 0x11;
  }

  // 分块（Group 1 短块在前，Group 2 长块在后）
  const g2Blocks = totalData % numBlocks;
  const g1Blocks = numBlocks - g2Blocks;
  const g1Len = Math.floor(totalData / numBlocks);
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];

  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = b < g1Blocks ? g1Len : g1Len + 1;
    const block = dataBytes.subarray(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(rsComputeEc(block, ecPerBlock));
  }

  // 数据码字与纠错码字按列交织
  const out = new Uint8Array(spec.totalCodewords);
  let outIdx = 0;
  const maxDataLen = g2Blocks > 0 ? g1Len + 1 : g1Len;
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      const blk = dataBlocks[b]!;
      if (i < blk.length) out[outIdx++] = blk[i]!;
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) {
      out[outIdx++] = ecBlocks[b]![i]!;
    }
  }
  return out;
}

function maskCond(mask: number, r: number, c: number): boolean {
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

function writeFormatInfo(modules: boolean[][], size: number, ec: QrEcLevel, mask: number): void {
  const bits = formatBits(ec, mask);
  for (let i = 0; i <= 5; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    modules[i]![8] = dark;
    modules[8]![size - 1 - i] = dark;
  }
  const b6 = ((bits >>> 6) & 1) === 1;
  modules[7]![8] = b6;
  modules[8]![size - 7] = b6;

  const b7 = ((bits >>> 7) & 1) === 1;
  modules[8]![8] = b7;
  modules[8]![size - 8] = b7;

  const b8 = ((bits >>> 8) & 1) === 1;
  modules[8]![7] = b8;
  modules[size - 7]![8] = b8;

  for (let i = 9; i < 15; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    modules[8]![14 - i] = dark;
    modules[size - 15 + i]![8] = dark;
  }
}

function computePenalty(modules: boolean[][], size: number): number {
  let penalty = 0;

  // N1: 同色连续 >= 5；N3: 1011101 前后接 4 个浅色模块
  for (let r = 0; r < size; r++) {
    let runRow = 1;
    let runCol = 1;
    let winRow = 0;
    let winCol = 0;
    for (let c = 0; c < size; c++) {
      const rowVal = modules[r]![c]!;
      const colVal = modules[c]![r]!;
      if (c > 0) {
        if (rowVal === modules[r]![c - 1]!) {
          runRow++;
        } else {
          if (runRow >= 5) penalty += runRow - 2;
          runRow = 1;
        }
        if (colVal === modules[c - 1]![r]!) {
          runCol++;
        } else {
          if (runCol >= 5) penalty += runCol - 2;
          runCol = 1;
        }
      }
      winRow = ((winRow << 1) | (rowVal ? 1 : 0)) & 0x7ff;
      winCol = ((winCol << 1) | (colVal ? 1 : 0)) & 0x7ff;
      if (c >= 10) {
        if (winRow === 0b10111010000 || winRow === 0b00001011101) penalty += 40;
        if (winCol === 0b10111010000 || winCol === 0b00001011101) penalty += 40;
      }
    }
    if (runRow >= 5) penalty += runRow - 2;
    if (runCol >= 5) penalty += runCol - 2;
  }

  // N2: 2x2 同色方块；N4: 深色占比偏离 50%
  let darkCount = 0;
  for (let r = 0; r < size; r++) {
    const row = modules[r]!;
    for (let c = 0; c < size; c++) {
      const v = row[c]!;
      if (v) darkCount++;
      if (r < size - 1 && c < size - 1) {
        if (v === row[c + 1]! && v === modules[r + 1]![c]! && v === modules[r + 1]![c + 1]!) {
          penalty += 3;
        }
      }
    }
  }

  const total = size * size;
  penalty += Math.floor(Math.abs(darkCount * 20 - total * 10) / total) * 10;
  return penalty;
}

function selectVersion(byteLen: number, ec: QrEcLevel): number {
  for (let v = 1; v < VERSIONS.length; v++) {
    const spec = VERSIONS[v]!;
    const [ecPerBlock, numBlocks] = ec === "L" ? spec.ecL : spec.ecM;
    const totalData = spec.totalCodewords - ecPerBlock * numBlocks;
    const headerBytes = v <= 9 ? 2 : 3; // Byte 模式 4bit + 长度 (8|16)bit + 4bit 结束符
    if (byteLen <= totalData - headerBytes) return v;
  }
  throw new RangeError(`QR payload too long (${byteLen} bytes) for EC level ${ec}`);
}

export function encodeQr(text: string, ec: QrEcLevel = "M"): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const version = selectVersion(bytes.length, ec);
  const size = 17 + 4 * version;
  const spec = VERSIONS[version]!;

  const base: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const isFunc: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));

  const setFunc = (r: number, c: number, dark: boolean): void => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      base[r]![c] = dark;
      isFunc[r]![c] = true;
    }
  };

  // 1. 三个定位寻像图形 + 1 格浅色分隔区
  const finderOrigins: readonly [number, number][] = [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ];
  for (const [fr, fc] of finderOrigins) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const dark =
          dr >= 0 &&
          dr <= 6 &&
          dc >= 0 &&
          dc <= 6 &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setFunc(fr + dr, fc + dc, dark);
      }
    }
  }

  // 2. 时序图形
  for (let i = 8; i <= size - 9; i++) {
    const dark = i % 2 === 0;
    setFunc(6, i, dark);
    setFunc(i, 6, dark);
  }

  // 3. 校正图形（Version >= 2）
  const coords = spec.align;
  const nAlign = coords.length;
  for (let i = 0; i < nAlign; i++) {
    for (let j = 0; j < nAlign; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === nAlign - 1) || (i === nAlign - 1 && j === 0)) continue;
      const cr = coords[i]!;
      const cc = coords[j]!;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFunc(cr + dr, cc + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // 4. 固定深色模块
  setFunc(size - 8, 8, true);

  // 5. 预留格式信息区（实际位在掩码评估时写入）
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunc(8, i, false);
      setFunc(i, 8, false);
    }
  }
  for (let c = size - 8; c < size; c++) setFunc(8, c, false);
  for (let r = size - 7; r < size; r++) setFunc(r, 8, false);

  // 6. 版本信息（Version >= 7）
  if (version >= 7) {
    const vBits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((vBits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(b, a, dark);
      setFunc(a, b, dark);
    }
  }

  // 7. 填充数据与纠错码字（双列锯齿向上/向下，跳过第 6 列垂直时序）
  const codewords = buildCodewords(bytes, version, ec);
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset++) {
        const c = right - offset;
        if (isFunc[r]![c]!) continue;
        let dark = false;
        if (bitIndex < totalBits) {
          const byteVal = codewords[bitIndex >>> 3]!;
          dark = ((byteVal >>> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex++;
        }
        base[r]![c] = dark;
      }
    }
    upward = !upward;
  }

  // 8. 评估全部 8 种掩码并择优
  let bestPenalty = Number.POSITIVE_INFINITY;
  let bestModules: boolean[][] = base;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = base.map((row, r) =>
      row.map((val, c) => (isFunc[r]![c]! ? val : maskCond(mask, r, c) ? !val : val)),
    );
    writeFormatInfo(candidate, size, ec, mask);
    const penalty = computePenalty(candidate, size);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestModules = candidate;
    }
  }

  return { size, modules: bestModules };
}

/** 用 Unicode 半高块字符将二维码渲染到终端（含 2 格浅色静默区，深浅终端皆具对比度）。 */
export function renderQrTerminal(text: string, ec: QrEcLevel = "M"): string {
  const { size, modules } = encodeQr(text, ec);
  const quiet = 2;
  const total = size + quiet * 2;
  const isDark = (r: number, c: number): boolean => {
    const mr = r - quiet;
    const mc = c - quiet;
    if (mr < 0 || mr >= size || mc < 0 || mc >= size) return false;
    return modules[mr]![mc]!;
  };

  const lines: string[] = [];
  for (let r = 0; r < total; r += 2) {
    let line = "";
    for (let c = 0; c < total; c++) {
      const topLight = !isDark(r, c);
      const bottomLight = r + 1 >= total ? true : !isDark(r + 1, c);
      if (topLight && bottomLight) line += "█";
      else if (!topLight && !bottomLight) line += " ";
      else if (topLight) line += "▀";
      else line += "▄";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
