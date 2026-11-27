import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stats } from "../src/cli/commands/stats.js";
import { makeContext } from "../src/cli/context.js";
import {
  analyzeAccount,
  CHAR_SPECIAL,
  loadUpMapOverride,
  makeUpResolver,
  type AccountAnalysis,
} from "../src/core/analysis/index.js";
import { GachaStore } from "../src/core/storage/store.js";
import { buildAccountKey, type GachaRecord, type PoolInfo } from "../src/core/types.js";
import { createApp } from "../src/server/index.js";

const tempDirs: string[] = [];
const cleanups: Array<() => Promise<void> | void> = [];

function mkTempDir(prefix = "beg-up-override-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function mkPool(poolId: string, up6Ids: string[], poolName = poolId, poolType = CHAR_SPECIAL): PoolInfo {
  return {
    poolId,
    gachaType: "char",
    poolName,
    poolType,
    up6Ids,
    versionNum: "1.0",
  };
}

function mkCharDraw(seq: number, poolId: string, rarity: number, itemId: string, poolName = poolId): GachaRecord {
  return {
    type: "char",
    feed: `char:${CHAR_SPECIAL}`,
    poolType: CHAR_SPECIAL,
    poolId,
    poolName,
    itemId,
    itemName: `角色_${itemId}`,
    itemSubType: "",
    rarity,
    isFree: false,
    isNew: false,
    gachaTs: String(1_760_000_000_000 + seq * 1000),
    seqId: String(seq),
    kind: "draw",
  };
}

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("P0-4 up-map.override.json local override layer", () => {
  it("loadUpMapOverride 处理缺失、:memory:、BOM、下划线键、空白修剪与非法 JSON/条目", () => {
    expect(loadUpMapOverride(undefined)).toEqual({});
    expect(loadUpMapOverride("")).toEqual({});
    expect(loadUpMapOverride(":memory:")).toEqual({});

    const emptyDir = mkTempDir();
    expect(loadUpMapOverride(emptyDir)).toEqual({});

    // 目录同名防御（不应抛异常）
    const dirCollision = mkTempDir();
    fs.mkdirSync(path.join(dirCollision, "up-map.override.json"));
    expect(loadUpMapOverride(dirCollision)).toEqual({});

    // 损坏 JSON 与非对象 JSON
    const malformedDir = mkTempDir();
    fs.writeFileSync(path.join(malformedDir, "up-map.override.json"), "{ invalid json", "utf8");
    expect(loadUpMapOverride(malformedDir)).toEqual({});

    const arrayDir = mkTempDir();
    fs.writeFileSync(path.join(arrayDir, "up-map.override.json"), '["special_1_0_1"]', "utf8");
    expect(loadUpMapOverride(arrayDir)).toEqual({});

    const nullDir = mkTempDir();
    fs.writeFileSync(path.join(nullDir, "up-map.override.json"), "null", "utf8");
    expect(loadUpMapOverride(nullDir)).toEqual({});

    // 带 BOM、_comment、空白裁剪与坏条目混杂
    const validDir = mkTempDir();
    const content =
      "\uFEFF" +
      JSON.stringify({
        _comment: "说明文字应被忽略",
        _another: { up6Ids: ["should_ignore"] },
        bad_str: "not_an_object",
        bad_arr: { up6Ids: "not_an_array" },
        bad_missing: {},
        special_trim: { up6Ids: ["  chr_a  ", "", "   ", 123, null, "chr_b"] },
        special_empty: { up6Ids: [] },
      });
    fs.writeFileSync(path.join(validDir, "up-map.override.json"), content, "utf8");

    expect(loadUpMapOverride(validDir)).toEqual({
      special_trim: { up6Ids: ["chr_a", "chr_b"] },
      special_empty: { up6Ids: [] },
    });
  });

  it("makeUpResolver 优先级：_前缀 < 空 -> DB pools -> override(file/opts) -> 内置 up-map.json", () => {
    const dir = mkTempDir();
    fs.writeFileSync(
      path.join(dir, "up-map.override.json"),
      "\uFEFF" +
        JSON.stringify({
          _comment: "ignored",
          special_40402_new: { up6Ids: ["chr_40402_up"] },
          special_1_0_1: { up6Ids: ["chr_override_laevat"] },
          special_1_0_2: { up6Ids: [] },
          special_db_wins: { up6Ids: ["chr_from_override"] },
        }),
      "utf8",
    );

    const pools = new Map<string, PoolInfo>([
      ["special_db_wins", mkPool("special_db_wins", ["chr_from_db"])],
      ["special_40402_new", mkPool("special_40402_new", [])], // DB 有记录但 up6Ids 为空，应回退到 override
      ["_comment", mkPool("_comment", ["chr_should_not_resolve"])],
    ]);

    const up = makeUpResolver(pools, {
      dataDir: dir,
      override: {
        special_inline: { up6Ids: ["  chr_inline_1 "] },
        special_1_0_3: { up6Ids: "invalid" }, // 无效条目忽略，回退内置 up-map.json
      },
    });

    // 1. _ 开头始终未知
    expect(up.up6("_comment")).toEqual({ ids: [], known: false });
    expect(up.up6("_anything")).toEqual({ ids: [], known: false });

    // 2. DB pools (length > 0) 优先于 override
    expect(up.up6("special_db_wins")).toEqual({ ids: ["chr_from_db"], known: true });

    // 3. override 填补 DB 空记录 / 40402 未知池，且覆盖内置 up-map.json（含显式空数组覆盖）
    expect(up.up6("special_40402_new")).toEqual({ ids: ["chr_40402_up"], known: true });
    expect(up.up6("special_1_0_1")).toEqual({ ids: ["chr_override_laevat"], known: true });
    expect(up.up6("special_1_0_2")).toEqual({ ids: [], known: false });
    expect(up.up6("special_inline")).toEqual({ ids: ["chr_inline_1"], known: true });

    // 4. 无效 override 条目不遮蔽内置 up-map.json；未覆盖键正常回退内置表
    expect(up.up6("special_1_0_3")).toEqual({ ids: ["chr_0013_aglina"], known: true });
    expect(up.up6("special_1_1_1")).toEqual({ ids: ["chr_0027_tangtang"], known: true });
  });

  it("analyzeAccount({ dataDir }) 填补 40402 下线池并更新缺 UP 提示文案", () => {
    const dir = mkTempDir();
    const accountKey = buildAccountKey({
      region: "cn",
      channelMasterId: "2",
      bindingUid: "SYNTH_UID_40402",
      roleId: "SYNTH_ROLE_40402",
    });
    const records = [
      mkCharDraw(1, "special_40402_offlined", 6, "chr_off_banner", "已下线未知池"),
      mkCharDraw(2, "special_40402_offlined", 6, "chr_40402_target", "已下线未知池"),
    ];

    // 无 override 时提示包含 up-map.override.json
    const withoutOverride = analyzeAccount({
      accountKey,
      records,
      pools: [],
      rerunChar: [],
      rerunWeapon: [],
      dataDir: dir,
      now: 1,
    });
    expect(withoutOverride.groups[0]!.upKnown).toBe(false);
    expect(withoutOverride.groups[0]!.hits.every((h) => h.isUp === null)).toBe(true);
    expect(withoutOverride.notes).toHaveLength(1);
    expect(withoutOverride.notes[0]).toContain("up-map.override.json");

    // 写入 up-map.override.json 后自动识别 UP/歪
    fs.writeFileSync(
      path.join(dir, "up-map.override.json"),
      JSON.stringify({
        special_40402_offlined: { up6Ids: ["chr_40402_target"] },
      }),
      "utf8",
    );

    const withOverride = analyzeAccount({
      accountKey,
      records,
      pools: [],
      rerunChar: [],
      rerunWeapon: [],
      dataDir: dir,
      now: 1,
    });
    const group = withOverride.groups[0]!;
    expect(group.upKnown).toBe(true);
    expect(group.up6Ids).toEqual(["chr_40402_target"]);
    // hits 按新 → 旧排序
    expect(group.hits[0]!.isUp).toBe(true);
    expect(group.hits[1]!.isUp).toBe(false);
    expect(withOverride.notes).toEqual([]);

    // 内存 upOverride 同样生效
    const withInline = analyzeAccount({
      accountKey,
      records,
      pools: [],
      rerunChar: [],
      rerunWeapon: [],
      upOverride: { special_40402_offlined: { up6Ids: ["chr_off_banner"] } },
      now: 1,
    });
    expect(withInline.groups[0]!.hits[0]!.isUp).toBe(false);
    expect(withInline.groups[0]!.hits[1]!.isUp).toBe(true);
  });

  it("集成校验：createApp({ dataDir }) 与 CLI stats --analysis --data-dir 均透传 dataDir 生效", async () => {
    const dataDir = mkTempDir();
    const webDir = mkTempDir("beg-up-web-");

    fs.writeFileSync(
      path.join(dataDir, "up-map.override.json"),
      "\uFEFF" +
        JSON.stringify({
          _comment: "40402 local override",
          special_40402_int: { up6Ids: ["chr_40402_up_int"] },
          special_1_0_1: { up6Ids: ["chr_override_1_0_1"] },
        }),
      "utf8",
    );

    const identity = {
      region: "cn" as const,
      channelMasterId: "2",
      bindingUid: "SYNTH_INT_UID",
      roleId: "SYNTH_INT_ROLE",
    };
    const accountKey = buildAccountKey(identity);
    const store = GachaStore.open(dataDir);
    store.upsertAccount({
      ...identity,
      accountKey,
      nickname: "SynthTester",
      serverId: "1",
      serverName: "China",
      channelName: "bilibili服",
      source: "test",
      updatedAt: 1,
    });
    store.insertRecords(accountKey, [
      mkCharDraw(1, "special_40402_int", 6, "chr_40402_up_int", "下线池40402"),
      mkCharDraw(2, "special_1_0_1", 6, "chr_override_1_0_1", "熔火灼痕"),
    ]);
    store.close();

    // 1) createApp({ dataDir }) 不注入自定义 deps.analysis，使用默认 analyzeAccount
    const app = createApp({ dataDir, webDir });
    cleanups.push(() => app.close());
    const base = (await app.listen()).split("#")[0]!.replace(/\/$/, "");

    const res = await fetch(`${base}/api/accounts/${encodeURIComponent(accountKey)}/analysis`, {
      headers: { "X-BEG-Key": app.key },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AccountAnalysis;
    expect(body.notes).toEqual([]);
    const srv40402 = body.groups.find((g) => g.poolId === "special_40402_int")!;
    const srv101 = body.groups.find((g) => g.poolId === "special_1_0_1")!;
    expect(srv40402.upKnown).toBe(true);
    expect(srv40402.hits[0]!.isUp).toBe(true);
    expect(srv101.upKnown).toBe(true);
    expect(srv101.up6Ids).toEqual(["chr_override_1_0_1"]);
    expect(srv101.hits[0]!.isUp).toBe(true);

    // 2) CLI stats --analysis --data-dir
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (s: unknown) => logs.push(String(s));
    try {
      const code = await stats.run(makeContext(["stats", "--analysis", "--data-dir", dataDir]));
      expect(code).toBe(0);
    } finally {
      console.log = origLog;
    }

    const cliArr = JSON.parse(logs.pop()!) as AccountAnalysis[];
    expect(cliArr).toHaveLength(1);
    const cliAnalysis = cliArr[0]!;
    expect(cliAnalysis.accountKey).toMatch(/^cn_2_#[a-f0-9]+$/);
    expect(cliAnalysis.notes).toEqual([]);
    const cli40402 = cliAnalysis.groups.find((g) => g.poolId === "special_40402_int")!;
    const cli101 = cliAnalysis.groups.find((g) => g.poolId === "special_1_0_1")!;
    expect(cli40402.upKnown).toBe(true);
    expect(cli40402.hits[0]!.isUp).toBe(true);
    expect(cli101.upKnown).toBe(true);
    expect(cli101.hits[0]!.isUp).toBe(true);
  });
});
