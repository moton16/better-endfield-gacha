import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeAccount,
  badges,
  CHAR_BEGINNER,
  CHAR_JOINT,
  CHAR_RERUN,
  CHAR_SPECIAL,
  CHAR_STANDARD,
  luck,
  makeUpResolver,
  RULES,
  tone,
} from "../src/core/analysis/index.js";
import { stats } from "../src/cli/commands/stats.js";
import { makeContext } from "../src/cli/context.js";
import { GachaStore } from "../src/core/storage/store.js";
import { buildAccountKey, type GachaRecord, type PoolInfo } from "../src/core/types.js";

const ACC_KEY = "cn_2_fakeBind123_fakeRole456";

function mk(opts: {
  n: number;
  rarity: number;
  poolId: string;
  poolName?: string;
  free?: boolean;
  isNew?: boolean;
  id?: string;
  name?: string;
  ts?: number;
  feed?: string;
  poolType?: string;
  type?: "char" | "weapon";
  kind?: string;
}): GachaRecord {
  const type = opts.type ?? "char";
  const poolType = opts.poolType ?? CHAR_SPECIAL;
  const feed = opts.feed ?? (type === "char" ? `char:${poolType}` : `weapon:${opts.poolId}`);
  return {
    type,
    feed,
    poolType,
    poolId: opts.poolId,
    poolName: opts.poolName ?? opts.poolId,
    itemId: opts.id ?? `item_${opts.rarity}_${opts.n}`,
    itemName: opts.name ?? `Item_${opts.n}`,
    itemSubType: type === "weapon" ? "sword" : "",
    rarity: opts.rarity,
    isFree: opts.free ?? false,
    isNew: opts.isNew ?? false,
    gachaTs: String(opts.ts ?? 1700000000000 + opts.n * 1000),
    seqId: String(opts.n),
    kind: opts.kind ?? "draw",
  };
}

function mkMany(
  startSeq: number,
  count: number,
  rarity: number,
  base: Omit<Parameters<typeof mk>[0], "n" | "rarity">,
): GachaRecord[] {
  return Array.from({ length: count }, (_, idx) =>
    mk({ ...base, n: startSeq + idx, rarity }),
  );
}

function pool(poolId: string, up6Ids: string[], poolName = poolId, poolType = CHAR_SPECIAL): PoolInfo {
  return {
    poolId,
    gachaType: poolType === "special" || poolType === "constant" || poolType === "rerun" ? "weapon" : "char",
    poolName,
    poolType,
    up6Ids,
    versionNum: "1.0",
  };
}

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("analysis engine (W1)", () => {
  it("1. 跨池小保底延续（Special）：池 A 垫 50 抽无 6★，池 B 第 30 抽出 6★ → pity=80, tone=pink, luck=fei", () => {
    const records = [
      ...mkMany(1, 50, 4, { poolId: "sp_a", poolName: "池A", ts: 1000 }),
      ...mkMany(51, 29, 4, { poolId: "sp_b", poolName: "池B", ts: 2000 }),
      mk({ n: 80, rarity: 6, poolId: "sp_b", poolName: "池B", id: "U_B", ts: 2080 }),
    ];
    const res = analyzeAccount({
      accountKey: ACC_KEY,
      records,
      pools: [pool("sp_a", ["U_A"]), pool("sp_b", ["U_B"])],
      rerunChar: [],
      rerunWeapon: [],
      now: 1,
    });

    // groups 按 lastTs 新 → 旧：池B 在前，池A 在后
    expect(res.groups.map((g) => g.poolId)).toEqual(["sp_b", "sp_a"]);
    const groupB = res.groups[0]!;
    const groupA = res.groups[1]!;

    expect(groupA.pending).toBe(50);
    expect(groupA.isCurrent).toBe(false);
    expect(groupB.isCurrent).toBe(true);
    expect(groupB.hits).toHaveLength(1);
    expect(groupB.hits[0]).toMatchObject({
      pity: 80, // 50 + 30
      tone: "pink",
      luck: "fei", // 80 >= ceil(80*0.925)=74
      isUp: true,
      prevPoolDiff: 50,
    });
    expect(groupB.pending).toBe(0);
  });

  it("1b. 免费十连无 6★ 时写入 freeBatches（不含出金批次）", () => {
    const records = [
      ...mkMany(1, 10, 4, { poolId: "sp_free", free: true, ts: 1000 }),
      ...mkMany(11, 5, 4, { poolId: "sp_free", free: true, ts: 2000 }),
      mk({ n: 16, rarity: 6, poolId: "sp_free", free: true, id: "U_F", ts: 2000 }),
    ];
    const res = analyzeAccount({
      accountKey: ACC_KEY,
      records,
      pools: [pool("sp_free", ["U_F"])],
      rerunChar: [],
      rerunWeapon: [],
      now: 1,
    });
    expect(res.groups[0]!.freeBatches).toEqual([{ gachaTs: "1000", size: 10, sixStars: 0 }]);
  });

  it("2. 免费抽不计入且不重置后续计数；免费 6★ 取当时计数、luck 为 null", () => {
    // 场景 A：10 条免费 + 20 条付费出 6★ → pity=20
    const recordsA = [
      ...mkMany(1, 10, 4, { poolId: "sp_1", free: true }),
      ...mkMany(11, 19, 4, { poolId: "sp_1", free: false }),
      mk({ n: 30, rarity: 6, poolId: "sp_1", free: false, id: "U1" }),
    ];
    const resA = analyzeAccount({
      accountKey: ACC_KEY,
      records: recordsA,
      pools: [pool("sp_1", ["U1"])],
      rerunChar: [],
      rerunWeapon: [],
      now: 1,
    });
    expect(resA.groups[0]!.hits[0]!.pity).toBe(20);
    expect(resA.groups[0]!.free).toBe(10);
    expect(resA.groups[0]!.paid).toBe(20);

    // 场景 B：付费 10 抽后免费出 6★（取计数 10，luck=null，不重置），再 10 抽付费出 6★（计数 20）
    const recordsB = [
      ...mkMany(1, 10, 4, { poolId: "sp_2", free: false }),
      mk({ n: 11, rarity: 6, poolId: "sp_2", free: true, id: "X_FREE" }),
      ...mkMany(12, 9, 4, { poolId: "sp_2", free: false }),
      mk({ n: 21, rarity: 6, poolId: "sp_2", free: false, id: "U2" }),
    ];
    const resB = analyzeAccount({
      accountKey: ACC_KEY,
      records: recordsB,
      pools: [pool("sp_2", ["U2"])],
      rerunChar: [],
      rerunWeapon: [],
      now: 1,
    });
    // hits 按新 → 旧排列
    const hits = resB.groups[0]!.hits;
    expect(hits).toHaveLength(2);
    expect(hits[0]!.pity).toBe(20); // 第21抽付费6★，未被免费6★重置
    expect(hits[0]!.isFree).toBe(false);
    expect(hits[1]!.pity).toBe(10); // 免费6★取当时计数
    expect(hits[1]!.isFree).toBe(true);
    expect(hits[1]!.luck).toBeNull();
    // avgPity6 只算 paidHits：只有 20
    expect(resB.overview.limited.avgPity6).toBe(20);
  });

  it("3. 歪判定与未知 UP 提示：仅非 Standard/Beginner/constant 池未知 UP 时才在 notes 提示", () => {
    const records = [
      // 池1：已知 UP=["U"]，先歪 X，后出 U
      mk({ n: 1, rarity: 6, poolId: "sp_known", poolName: "已知池", id: "X", ts: 1000 }),
      mk({ n: 2, rarity: 6, poolId: "sp_known", poolName: "已知池", id: "U", ts: 1001 }),
      // 池2：Special 未知 UP
      mk({ n: 3, rarity: 6, poolId: "sp_unknown", poolName: "未知限定池", id: "Y", ts: 2000 }),
      // 池3：Standard 无 UP，不应触发 notes
      mk({ n: 4, rarity: 6, poolId: "standard", poolName: "基础寻访", poolType: CHAR_STANDARD, id: "S1", ts: 3000 }),
      // 池4：Beginner 无 UP，不应触发 notes
      mk({ n: 5, rarity: 6, poolId: "beginner", poolName: "启程寻访", poolType: CHAR_BEGINNER, id: "B1", ts: 4000 }),
      // 池5：武器 constant 无 UP，不应触发 notes
      mk({
        n: 6,
        rarity: 6,
        type: "weapon",
        poolId: "weaponbox_constant_1",
        poolName: "常驻武器",
        poolType: "constant",
        id: "W1",
        ts: 5000,
      }),
    ];

    const res = analyzeAccount({
      accountKey: ACC_KEY,
      records,
      pools: [pool("sp_known", ["U"], "已知池")],
      rerunChar: [],
      rerunWeapon: [],
      now: 1,
    });

    const knownGroup = res.groups.find((g) => g.poolId === "sp_known")!;
    expect(knownGroup.hits[0]!.isUp).toBe(true); // 新→旧：U
    expect(knownGroup.hits[1]!.isUp).toBe(false); // 歪：X

    const unknownGroup = res.groups.find((g) => g.poolId === "sp_unknown")!;
    expect(unknownGroup.hits[0]!.isUp).toBeNull();
    expect(unknownGroup.upKnown).toBe(false);

    expect(res.notes).toHaveLength(1);
    expect(res.notes[0]).toContain("未知限定池");
    expect(res.overview.limited.upCount).toBe(1);
    expect(res.overview.limited.offBanner).toBe(1);
  });

  it("4. 大保底（Special）：付费 119 抽无 UP → remaining=1；第 120 抽出 UP → remaining=0, gotUp=true", () => {
    // 119 抽无 UP（中间第 80 抽歪一次）
    const rec119 = [
      ...mkMany(1, 79, 4, { poolId: "sp_big", poolName: "限定" }),
      mk({ n: 80, rarity: 6, poolId: "sp_big", poolName: "限定", id: "OFF" }),
      ...mkMany(81, 39, 4, { poolId: "sp_big", poolName: "限定" }),
    ];
    const res119 = analyzeAccount({
      accountKey: ACC_KEY,
      records: rec119,
      pools: [pool("sp_big", ["UP_CHAR"])],
      rerunChar: [],
      rerunWeapon: [],
      now: 1,
    });
    expect(res119.groups[0]!.bigPity).toEqual({
      max: RULES.charBigPity,
      count: 119,
      remaining: 1,
      gotUp: false,
      fromOfficialCount: false,
    });

    // 第 120 抽出 UP
    const rec120 = [
      ...rec119,
      mk({ n: 120, rarity: 6, poolId: "sp_big", poolName: "限定", id: "UP_CHAR" }),
    ];
    const res120 = analyzeAccount({
      accountKey: ACC_KEY,
      records: rec120,
      pools: [pool("sp_big", ["UP_CHAR"])],
      rerunChar: [],
      rerunWeapon: [],
      now: 1,
    });
    expect(res120.groups[0]!.bigPity).toEqual({
      max: RULES.charBigPity,
      count: 120,
      remaining: 0,
      gotUp: true,
      fromOfficialCount: false,
    });
  });

  it("5. Rerun：不同 poolId 同 poolName 归并成 1 组；rerunCounts=200 → count 封顶 120", () => {
    const records = [
      ...mkMany(1, 30, 4, {
        poolId: "rerun_v1",
        poolName: "往期复刻",
        poolType: CHAR_RERUN,
        ts: 1000,
      }),
      ...mkMany(31, 20, 4, {
        poolId: "rerun_v2",
        poolName: "往期复刻",
        poolType: CHAR_RERUN,
        ts: 2000,
      }),
    ];
    const res = analyzeAccount({
      accountKey: ACC_KEY,
      records,
      pools: [pool("rerun_v2", ["U_RERUN"], "往期复刻", CHAR_RERUN)],
      rerunChar: [{ poolId: "rerun_v2", poolName: "往期复刻", totalPullCount: 200 }],
      rerunWeapon: [],
      now: 1,
    });

    expect(res.groups).toHaveLength(1);
    const g = res.groups[0]!;
    expect(g.poolId).toBe("rerun_v2");
    expect(g.total).toBe(50);
    expect(g.pending).toBe(50);
    expect(g.bigPity).toEqual({
      max: 120,
      count: 120, // 200 封顶 120
      remaining: 0,
      gotUp: false,
      fromOfficialCount: true,
    });
  });

  it("6. Joint（辉光庆典）：无 bigPity，每池小保底各自从 0 计", () => {
    const records = [
      ...mkMany(1, 25, 4, { poolId: "joint_1", poolName: "庆典一", poolType: CHAR_JOINT, ts: 1000 }),
      ...mkMany(26, 4, 4, { poolId: "joint_2", poolName: "庆典二", poolType: CHAR_JOINT, ts: 2000 }),
      mk({ n: 30, rarity: 6, poolId: "joint_2", poolName: "庆典二", poolType: CHAR_JOINT, id: "J_UP", ts: 2005 }),
    ];
    const res = analyzeAccount({
      accountKey: ACC_KEY,
      records,
      pools: [pool("joint_1", ["J1"], "庆典一", CHAR_JOINT), pool("joint_2", ["J_UP"], "庆典二", CHAR_JOINT)],
      rerunChar: [],
      rerunWeapon: [],
      now: 1,
    });

    expect(res.groups).toHaveLength(2);
    const j2 = res.groups[0]!;
    const j1 = res.groups[1]!;
    expect(j1.bigPity).toBeUndefined();
    expect(j2.bigPity).toBeUndefined();
    expect(j1.pending).toBe(25);
    expect(j2.hits[0]!.pity).toBe(5); // 从 0 开始计，不继承 joint_1 的 25 抽
  });

  it("7. 武器池：第 40 抽出 6★ → pity=40, tone=pink, luck=fei；大保底 80；constant 归入 standard", () => {
    const wRecords = [
      ...mkMany(1, 39, 4, { type: "weapon", poolId: "wpn_sp", poolName: "武器限定", poolType: "special", ts: 1000 }),
      mk({ n: 40, rarity: 6, type: "weapon", poolId: "wpn_sp", poolName: "武器限定", poolType: "special", id: "W_OFF", ts: 1040 }),
      ...mkMany(41, 39, 4, { type: "weapon", poolId: "wpn_sp", poolName: "武器限定", poolType: "special", ts: 1080 }),
    ];
    const cRecords = [
      mk({
        n: 100,
        rarity: 5,
        type: "weapon",
        poolId: "weaponbox_constant_1",
        poolName: "常驻武器",
        poolType: "constant",
        ts: 2000,
      }),
    ];
    const res = analyzeAccount({
      accountKey: ACC_KEY,
      records: [...wRecords, ...cRecords],
      pools: [pool("wpn_sp", ["W_UP"], "武器限定", "special")],
      rerunChar: [],
      rerunWeapon: [],
      now: 1,
    });

    const wpn = res.groups.find((g) => g.poolId === "wpn_sp")!;
    expect(wpn.tab).toBe("weapon");
    expect(wpn.hits[0]).toMatchObject({
      pity: 40,
      isFree: false,
      isUp: false,
      tone: "pink",
      luck: "fei",
    });
    expect(wpn.pending).toBe(39);
    expect(wpn.bigPity).toEqual({
      max: 80,
      count: 79,
      remaining: 1,
      gotUp: false,
      fromOfficialCount: false,
    });

    const constantWpn = res.groups.find((g) => g.poolId === "weaponbox_constant_1")!;
    expect(constantWpn.tab).toBe("standard");

    // 武器 rerun 池优先使用 rerunWeapon 官方计数（封顶 80）
    const rerunWpnRes = analyzeAccount({
      accountKey: ACC_KEY,
      records: [
        ...mkMany(1, 10, 4, {
          type: "weapon",
          poolId: "rerun_wpn_1",
          poolName: "复刻武器",
          poolType: "rerun",
          ts: 3000,
        }),
      ],
      pools: [pool("rerun_wpn_1", ["W_R"], "复刻武器", "rerun")],
      rerunChar: [],
      rerunWeapon: [{ poolId: "rerun_wpn_1", poolName: "复刻武器", totalPullCount: 95 }],
      now: 1,
    });
    expect(rerunWpnRes.groups[0]!.bigPity).toEqual({
      max: 80,
      count: 80,
      remaining: 0,
      gotUp: false,
      fromOfficialCount: true,
    });
  });

  it("8. gift 过滤：非 draw（如 gift_intel_book）6★ 不计入 count6/pity/total", () => {
    const records = [
      ...mkMany(1, 10, 4, { poolId: "sp_gift", poolName: "限定" }),
      mk({ n: 11, rarity: 6, poolId: "sp_gift", poolName: "限定", id: "GIFT_6", kind: "gift_intel_book" }),
      ...mkMany(12, 4, 4, { poolId: "sp_gift", poolName: "限定" }),
      mk({ n: 16, rarity: 6, poolId: "sp_gift", poolName: "限定", id: "REAL_6" }),
      // 仅包含 gift 的武器池，不应生成空组
      mk({
        n: 17,
        rarity: 6,
        type: "weapon",
        poolId: "wpn_only_gift",
        poolType: "special",
        kind: "gift_reward",
      }),
    ];
    const res = analyzeAccount({
      accountKey: ACC_KEY,
      records,
      pools: [pool("sp_gift", ["REAL_6"])],
      rerunChar: [],
      rerunWeapon: [],
      now: 1,
    });

    expect(res.groups).toHaveLength(1);
    const g = res.groups[0]!;
    expect(g.total).toBe(15); // 10 + 4 + 1 (gift 被过滤)
    expect(g.count6).toBe(1);
    expect(g.hits).toHaveLength(1);
    expect(g.hits[0]!.itemId).toBe("REAL_6");
    expect(g.hits[0]!.pity).toBe(15);
  });

  it("9. 徽章：十连双金、九蓝一紫、不足 10 条不计、lcx 占位跳过", () => {
    const batchDoubleGold = [
      ...mkMany(1, 2, 6, { poolId: "p1", ts: 10000 }),
      ...mkMany(3, 8, 4, { poolId: "p1", ts: 10000 }),
    ];
    const batchNineBlue = [
      ...mkMany(11, 9, 4, { poolId: "p1", ts: 20000 }),
      mk({ n: 20, rarity: 5, poolId: "p1", ts: 20000 }),
    ];
    // 9 条不计入
    const batchNineOnly = [
      ...mkMany(21, 8, 4, { poolId: "p1", ts: 30000 }),
      mk({ n: 29, rarity: 5, poolId: "p1", ts: 30000 }),
    ];
    // lcx:* 占位不计入
    const batchLcx = [
      ...mkMany(31, 8, 4, { poolId: "p1", ts: 40000 }),
      mk({ n: 39, rarity: 4, poolId: "p1", ts: 40000, id: "lcx:placeholder:1" }),
      mk({ n: 40, rarity: 5, poolId: "p1", ts: 40000 }),
    ];
    // 同 ts 但 isFree 混合，各自不足 10 条不合并
    const batchSplitFree = [
      ...mkMany(41, 5, 6, { poolId: "p1", ts: 50000, free: true }),
      ...mkMany(46, 5, 6, { poolId: "p1", ts: 50000, free: false }),
    ];

    const b = badges([...batchDoubleGold, ...batchNineBlue, ...batchNineOnly, ...batchLcx, ...batchSplitFree]);
    expect(b).toEqual([
      { id: "double_gold", label: "十连双金", count: 1 },
      { id: "nine_blue_one_purple", label: "九蓝一紫", count: 1 },
    ]);
  });

  it("10. tone 与 luck 阈值边界（角色 max=80，武器 max=40）", () => {
    // 角色（max=80）
    expect(tone(15, 80)).toBe("green");
    expect(tone(16, 80)).toBe("yellow");
    expect(tone(63, 80)).toBe("yellow");
    expect(tone(64, 80)).toBe("pink"); // 80 * 0.8 = 64

    expect(luck(10, 80)).toBe("ou");
    expect(luck(11, 80)).toBeNull();
    expect(luck(73, 80)).toBeNull();
    expect(luck(74, 80)).toBe("fei"); // ceil(80 * 0.925) = 74

    // 武器（max=40）
    expect(tone(15, 40)).toBe("green");
    expect(tone(16, 40)).toBe("yellow");
    expect(tone(31, 40)).toBe("yellow");
    expect(tone(32, 40)).toBe("pink"); // 40 * 0.8 = 32

    expect(luck(10, 40)).toBe("ou");
    expect(luck(11, 40)).toBeNull();
    expect(luck(36, 40)).toBeNull();
    expect(luck(37, 40)).toBe("fei"); // ceil(40 * 0.925) = 37
  });

  it("11. 纯函数幂等性：相同输入两次调用返回结果严格 deep equal", () => {
    const records = [
      ...mkMany(1, 59, 4, { poolId: "sp_1", ts: 1000 }),
      mk({ n: 60, rarity: 6, poolId: "sp_1", id: "UP_1", ts: 1060 }),
      ...mkMany(61, 40, 4, { poolId: "sp_2", ts: 2000 }),
    ];
    const snapshot = structuredClone(records);
    const input = {
      accountKey: ACC_KEY,
      records,
      pools: [pool("sp_1", ["UP_1"])],
      rerunChar: [],
      rerunWeapon: [],
      now: 1700000000000,
    };

    const a = analyzeAccount(input);
    const b = analyzeAccount(input);
    expect(a).toEqual(b);
    expect(records).toEqual(snapshot); // 未修改输入
  });

  it("总览 avgCostPerUp 与 up-map.json 回退校验", () => {
    // 池A：paid=60, 含1 UP；池B：paid=40, 无UP（不计入简化口径）；池C：paid=60, 含2 UP
    // avgCostPerUp = (60 + 60) / (1 + 2) = 40
    const records = [
      ...mkMany(1, 59, 4, { poolId: "sp_a", ts: 1000 }),
      mk({ n: 60, rarity: 6, poolId: "sp_a", id: "U_A", ts: 1060 }),
      ...mkMany(61, 40, 4, { poolId: "sp_b", ts: 2000 }),
      ...mkMany(101, 58, 4, { poolId: "sp_c", ts: 3000 }),
      mk({ n: 159, rarity: 6, poolId: "sp_c", id: "U_C", ts: 3059 }),
      mk({ n: 160, rarity: 6, poolId: "sp_c", id: "U_C", ts: 3060 }),
    ];
    const res = analyzeAccount({
      accountKey: ACC_KEY,
      records,
      pools: [pool("sp_a", ["U_A"]), pool("sp_b", ["U_B"]), pool("sp_c", ["U_C"])],
      rerunChar: [],
      rerunWeapon: [],
      now: 1,
    });
    expect(res.overview.limited.avgCostPerUp).toBe(40);
    // 池A 60抽(pity=60)，池B垫40抽延续至池C第59抽(pity=40+59=99)，池C第60抽(pity=1) → (60+99+1)/3 = 53.3
    expect(res.overview.limited.avgPity6).toBe(53.3);

    // up-map.json _comment 等下划线键应被忽略
    const up = makeUpResolver(new Map());
    expect(up.up6("_comment")).toEqual({ ids: [], known: false });
    expect(up.up6("special_1_0_1")).toEqual({ ids: [], known: false });
  });

  it("12. 同周期 5★ 陪跑明细 subHits5 与 pendingSubHits5（含 gift 过滤与跨池继承）", () => {
    const records = [
      // 池 A：5★ 甲×2 + 1 条非 draw 5★ 赠品（应忽略），无 6★
      mk({ n: 1, rarity: 5, poolId: "sp_a", id: "c5_a", name: "五星甲", ts: 1000 }),
      mk({ n: 2, rarity: 5, poolId: "sp_a", id: "c5_a", name: "五星甲", ts: 1001 }),
      mk({ n: 3, rarity: 5, poolId: "sp_a", id: "c5_gift", name: "赠品五", kind: "gift_box", ts: 1002 }),
      // 池 B：延续池 A 周期，再出 5★ 乙×1，然后出 6★（应带出 甲×2 + 乙×1 并清零），之后再垫 5★ 丙×1
      mk({ n: 4, rarity: 5, poolId: "sp_b", id: "c5_b", name: "五星乙", ts: 2000 }),
      mk({ n: 5, rarity: 6, poolId: "sp_b", id: "U_B", name: "六星B", ts: 2001 }),
      mk({ n: 6, rarity: 5, poolId: "sp_b", id: "c5_c", name: "五星丙", ts: 2002 }),
      // 武器池：6★ 前出 5★ 甲×1，6★ 后出 5★ 乙×2
      mk({ n: 7, type: "weapon", poolId: "w_1", poolType: "special", rarity: 5, id: "w5_a", name: "武五甲", ts: 3000 }),
      mk({ n: 8, type: "weapon", poolId: "w_1", poolType: "special", rarity: 6, id: "W_U", name: "武六U", ts: 3000 }),
      mk({ n: 9, type: "weapon", poolId: "w_1", poolType: "special", rarity: 5, id: "w5_b", name: "武五乙", ts: 3100 }),
      mk({ n: 10, type: "weapon", poolId: "w_1", poolType: "special", rarity: 5, id: "w5_b", name: "武五乙", ts: 3100 }),
    ];
    const res = analyzeAccount({
      accountKey: ACC_KEY,
      records,
      pools: [pool("sp_b", ["U_B"]), pool("w_1", ["W_U"], "w_1", "special")],
      rerunChar: [],
      rerunWeapon: [],
      now: 1,
    });

    const groupA = res.groups.find((g) => g.poolId === "sp_a")!;
    const groupB = res.groups.find((g) => g.poolId === "sp_b")!;
    const groupW = res.groups.find((g) => g.poolId === "w_1")!;

    expect(groupA.pendingSubHits5).toEqual([{ itemId: "c5_a", itemName: "五星甲", count: 2 }]);
    expect(groupB.hits[0]!.subHits5).toEqual([
      { itemId: "c5_a", itemName: "五星甲", count: 2 },
      { itemId: "c5_b", itemName: "五星乙", count: 1 },
    ]);
    expect(groupB.pendingSubHits5).toEqual([{ itemId: "c5_c", itemName: "五星丙", count: 1 }]);
    expect(groupW.hits[0]!.subHits5).toEqual([{ itemId: "w5_a", itemName: "武五甲", count: 1 }]);
    expect(groupW.pendingSubHits5).toEqual([{ itemId: "w5_b", itemName: "武五乙", count: 2 }]);
  });

  it("13. 武器十连聚合 weaponTenRolls 与全账号全局摘要 global（含 mock/fixture 校验）", () => {
    const records: GachaRecord[] = [
      // 第 1 个十连（ts=10000）：1× 5★ + 9× 4★
      mk({ n: 1, type: "weapon", poolId: "wpn_t", poolType: "special", rarity: 5, id: "w5_1", name: "武五一", ts: 10000 }),
      ...mkMany(2, 9, 4, { type: "weapon", poolId: "wpn_t", poolType: "special", ts: 10000 }),
      // 第 2 个十连（ts=20000）：1× 6★ UP + 2× 5★ 同名聚合 + 7× 4★ + 1× 赠品
      mk({ n: 11, type: "weapon", poolId: "wpn_t", poolType: "special", rarity: 6, id: "W_UP", name: "专武", ts: 20000 }),
      mk({ n: 12, type: "weapon", poolId: "wpn_t", poolType: "special", rarity: 5, id: "w5_2", name: "武五二", ts: 20000 }),
      mk({ n: 13, type: "weapon", poolId: "wpn_t", poolType: "special", rarity: 5, id: "w5_2", name: "武五二", ts: 20000 }),
      ...mkMany(14, 7, 4, { type: "weapon", poolId: "wpn_t", poolType: "special", ts: 20000 }),
      mk({ n: 21, type: "weapon", poolId: "wpn_t", poolType: "special", rarity: 6, id: "W_GIFT", name: "自选武器箱", kind: "gift_weapon_box", ts: 20000 }),
      // 角色限定池：8×4★ + 1×5★ + 1×6★ → 1× 超欧 6★（pity=10）
      ...mkMany(22, 8, 4, { poolId: "sp_g", ts: 30000 }),
      mk({ n: 30, rarity: 5, poolId: "sp_g", id: "c5_g", name: "五角", ts: 30000 }),
      mk({ n: 31, rarity: 6, poolId: "sp_g", id: "C_UP", name: "六角", ts: 31000 }),
    ];

    const res = analyzeAccount({
      accountKey: ACC_KEY,
      records,
      pools: [pool("wpn_t", ["W_UP"], "武器测试池", "special"), pool("sp_g", ["C_UP"], "限定测试池")],
      rerunChar: [],
      rerunWeapon: [],
      now: 1,
    });

    const wpn = res.groups.find((g) => g.poolId === "wpn_t")!;
    expect(wpn.weaponTenRolls).toHaveLength(2);
    // 新 → 旧排序：第 2 个十连在前
    expect(wpn.weaponTenRolls![0]).toMatchObject({
      rollIndex: 2,
      gachaTs: "20000",
      drawCount: 10,
      items: [
        { itemId: "W_UP", rarity: 6, count: 1, isUp: true, isGift: false },
        { itemId: "w5_2", rarity: 5, count: 2, isUp: null, isGift: false },
        { itemId: "W_GIFT", rarity: 6, count: 1, isUp: null, isGift: true },
      ],
    });
    expect(wpn.weaponTenRolls![1]).toMatchObject({
      rollIndex: 1,
      drawCount: 10,
      items: [{ itemId: "w5_1", rarity: 5, count: 1, isGift: false }],
    });

    expect(res.global).toMatchObject({
      totalDraws: 30,
      totalFree: 0,
      totalNonDraw: 1,
      total6: 2,
      firstRecordTs: "10000",
      globalBadges: [{ id: "nine_blue_one_purple", label: "九蓝一紫", count: 1 }],
      globalLuckCounts: { ou: 1, fei: 0 },
      isLucky: true,
    });

    // 校验内置 mock 与 server analysis 夹具 100% 符合 tone/luck 公式
    for (const file of ["src/web/mock/analysis.sample.json", "tests/fixtures/server/analysis.json"]) {
      const sample = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as ReturnType<typeof analyzeAccount>;
      expect(sample.global).toBeDefined();
      for (const g of sample.groups) {
        for (const h of g.hits) {
          expect(h.tone).toBe(tone(h.pity, g.smallPityMax));
          expect(h.luck).toBe(h.isFree ? null : luck(h.pity, g.smallPityMax));
        }
      }
    }
  });
});

describe("GachaStore.getAllPools & CLI stats --analysis", () => {
  it("store.getAllPools() 读取已写入的全部卡池", () => {
    const store = GachaStore.open(":memory:");
    try {
      expect(store.getAllPools()).toEqual([]);
      store.upsertPool(pool("p1", ["c1", "c2"], "池一", CHAR_SPECIAL));
      store.upsertPool(pool("w1", ["weapon_6"], "武器一", "special"));
      const all = store.getAllPools().sort((a, b) => a.poolId.localeCompare(b.poolId));
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({ poolId: "p1", up6Ids: ["c1", "c2"], poolName: "池一" });
      expect(all[1]).toMatchObject({ poolId: "w1", up6Ids: ["weapon_6"], gachaType: "weapon" });
    } finally {
      store.close();
    }
  });

  it("stats --analysis 默认脱敏输出 JSON，--show-ids 输出完整 accountKey", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beg-w1-cli-"));
    tempDirs.push(dir);

    const store = GachaStore.open(dir);
    const identity = { region: "cn" as const, channelMasterId: "2", bindingUid: "999888", roleId: "777666" };
    const key = buildAccountKey(identity);
    store.upsertAccount({
      ...identity,
      accountKey: key,
      nickname: "TestNick",
      serverId: "1",
      serverName: "China",
      channelName: "bilibili服",
      source: "test",
      updatedAt: 1,
    });
    store.upsertPool(pool("sp_1", ["U_1"], "限定池"));
    store.insertRecords(key, [mk({ n: 1, rarity: 6, poolId: "sp_1", poolName: "限定池", id: "U_1" })]);
    store.close();

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (s: unknown) => logs.push(String(s));
    try {
      // 默认脱敏模式
      await stats.run(makeContext(["stats", "--analysis", "--data-dir", dir]));
      const maskedJson = logs.pop()!;
      expect(maskedJson).not.toContain("999888");
      expect(maskedJson).not.toContain("777666");
      expect(maskedJson).not.toContain("TestNick");
      const maskedArr = JSON.parse(maskedJson);
      expect(maskedArr).toHaveLength(1);
      expect(maskedArr[0].accountKey).toMatch(/^cn_2_#[a-f0-9]+$/);
      expect(maskedArr[0].overview.limited.total).toBe(1);
      expect(maskedArr[0].overview.limited.upCount).toBe(1);

      // --show-ids 模式
      await stats.run(makeContext(["stats", "--analysis", "--show-ids", "--data-dir", dir]));
      const shownArr = JSON.parse(logs.pop()!);
      expect(shownArr[0].accountKey).toBe(key);
    } finally {
      console.log = origLog;
    }
  });
});
