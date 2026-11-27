import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backup } from "../src/cli/commands/backup.js";
import { exportCmd } from "../src/cli/commands/export.js";
import { importCmd } from "../src/cli/commands/import.js";
import { COMMANDS } from "../src/cli/commands/index.js";
import { makeContext } from "../src/cli/context.js";
import { toCsv } from "../src/core/io/csv.js";
import { analyzeAccount } from "../src/core/analysis/index.js";
import { applyImport, planImport } from "../src/core/io/importer.js";
import { parseLcx, type PoolMapEntry } from "../src/core/io/lcx.js";
import { parseV1 } from "../src/core/io/v1.js";
import { ImportError, LIMITS } from "../src/core/io/validate.js";
import { GachaStore } from "../src/core/storage/store.js";
import { buildAccountKey, type AccountRow, type GachaRecord } from "../src/core/types.js";

const tempDirs: string[] = [];

function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beg-w2-test-"));
  tempDirs.push(dir);
  return dir;
}

function mkAccount(overrides: Partial<AccountRow> = {}): AccountRow {
  const region = overrides.region ?? "cn";
  const channelMasterId = overrides.channelMasterId ?? "2";
  const bindingUid = overrides.bindingUid ?? "fake_bind_101";
  const roleId = overrides.roleId ?? "fake_role_202";
  return {
    region,
    channelMasterId,
    bindingUid,
    roleId,
    accountKey: buildAccountKey({ region, channelMasterId, bindingUid, roleId }),
    nickname: "SyntheticUser",
    serverId: "1",
    serverName: "China",
    channelName: "bilibili服",
    source: "cache",
    updatedAt: 1_760_000_000_000,
    ...overrides,
  };
}

function mkRecord(overrides: Partial<GachaRecord> = {}): GachaRecord {
  return {
    type: "char",
    feed: "char:E_CharacterGachaPoolType_Special",
    poolType: "E_CharacterGachaPoolType_Special",
    poolId: "special_1_0_1",
    poolName: "测试特许池",
    itemId: "chr_test_1",
    itemName: "星辉测试员",
    itemSubType: "",
    rarity: 6,
    isFree: false,
    isNew: true,
    gachaTs: "1760000001000",
    seqId: "101",
    kind: "draw",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("W2 import / export / backup", () => {
  it("1. v1 往返：export 导出 JSON 后清空导入新库，记录逐条相等", async () => {
    const srcDir = mkTempDir();
    const dstDir = mkTempDir();
    const outJson = path.join(srcDir, "export-v1.json");
    const acc = mkAccount();
    const records: GachaRecord[] = [
      mkRecord({ seqId: "10", gachaTs: "1760000010000", rarity: 4, itemId: "chr_4_1", itemName: "四星甲", isNew: false }),
      mkRecord({
        seqId: "11",
        gachaTs: "1760000020000",
        rarity: 6,
        itemId: "chr_6_1",
        itemName: "六星甲",
        isFree: true,
        isNew: true,
      }),
      mkRecord({
        type: "weapon",
        feed: "weapon:weaponbox_1_0_1",
        poolType: "special",
        poolId: "weaponbox_1_0_1",
        poolName: "测试武器箱",
        itemId: "wpn_5_1",
        itemName: "五星剑",
        itemSubType: "sword",
        rarity: 5,
        seqId: "12",
        gachaTs: "1760000030000",
        isNew: false,
      }),
      mkRecord({
        seqId: "13",
        gachaTs: "1760000040000",
        rarity: 0,
        itemId: "",
        itemName: "寻访情报书",
        kind: "gift_intel_book",
        isNew: false,
      }),
    ];

    const srcStore = GachaStore.open(srcDir);
    srcStore.upsertAccount(acc);
    srcStore.insertRecords(acc.accountKey, records);
    srcStore.close();

    vi.spyOn(console, "log").mockImplementation(() => {});
    const exitExport = await exportCmd.run(makeContext(["export", "--data-dir", srcDir, "--out", outJson]));
    expect(exitExport).toBe(0);

    const parsed = parseV1(fs.readFileSync(outJson, "utf8"));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.account.source).toBe("import");
    expect(parsed[0]!.skipped).toEqual([]);

    const dstStore = GachaStore.open(dstDir);
    const plan = planImport(dstStore, parsed[0]!.account, parsed[0]!.records, parsed[0]!.skipped);
    expect(plan.newRecords).toHaveLength(records.length);
    const applied = applyImport(dstStore, dstDir, parsed[0]!.account, plan);
    expect(applied.added).toBe(records.length);

    expect(dstStore.getRecords(acc.accountKey)).toEqual(records);
    expect(dstStore.getAccount(acc.accountKey)?.source).toBe("import");
    dstStore.close();
  });

  it("2. 篡改 accountKey 或缺少维度字段被拒绝", () => {
    const acc = mkAccount();
    const tampered = JSON.stringify({
      format: "better-endfield-gacha/v1",
      accounts: [{ ...acc, accountKey: "cn_1_other_other", records: [] }],
    });
    expect(() => parseV1(tampered)).toThrowError(ImportError);

    const missingRole = JSON.stringify({
      format: "better-endfield-gacha/v1",
      accounts: [{ region: "cn", channelMasterId: "2", bindingUid: "fake_bind_101", roleId: "", records: [] }],
    });
    expect(() => parseV1(missingRole)).toThrowError(ImportError);
  });

  it("3. 官方优先：同 (feed, seqId) 内容不同记入 conflicts 且本地记录保持不变", () => {
    const dir = mkTempDir();
    const store = GachaStore.open(dir);
    const acc = mkAccount({ source: "cache" });
    const official = mkRecord({ seqId: "500", itemId: "chr_official_6", itemName: "官方角色", rarity: 6 });
    store.upsertAccount(acc);
    store.insertRecords(acc.accountKey, [official]);

    const incoming = mkRecord({ seqId: "500", itemId: "chr_fake_4", itemName: "冲突角色", rarity: 4 });
    const plan = planImport(store, { ...acc, source: "import" }, [incoming], []);
    expect(plan.conflicts).toEqual([{ feed: official.feed, seqId: "500" }]);
    expect(plan.newRecords).toHaveLength(0);

    applyImport(store, dir, { ...acc, source: "import" }, plan);
    const stored = store.getRecords(acc.accountKey);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(official);
    expect(store.getAccount(acc.accountKey)?.source).toBe("cache");
    store.close();
  });

  it("4. 重复导入：同一文件第二次 planImport 时 newRecords.length === 0", () => {
    const dir = mkTempDir();
    const store = GachaStore.open(dir);
    const acc = mkAccount();
    const rec = mkRecord({ seqId: "77" });
    const text = JSON.stringify({
      format: "better-endfield-gacha/v1",
      accounts: [{ ...acc, records: [rec] }],
    });

    const p1 = parseV1(text)[0]!;
    const plan1 = planImport(store, p1.account, p1.records, p1.skipped);
    expect(plan1.newRecords).toHaveLength(1);
    applyImport(store, dir, p1.account, plan1);

    const p2 = parseV1(text)[0]!;
    const plan2 = planImport(store, p2.account, p2.records, p2.skipped);
    expect(plan2.newRecords).toHaveLength(0);
    expect(plan2.duplicates).toBe(1);
    expect(plan2.conflicts).toHaveLength(0);
    store.close();
  });

  it("5. 非法记录被跳过：rarity=9/0(draw)、空itemId(draw)、seqId=abc、feed=x、type/feed 不一致进 skipped，gift_intel_book(rarity=0,itemId='') 正常导入", () => {
    const acc = mkAccount();
    const valid = mkRecord({ seqId: "888" });
    const validGift = mkRecord({ seqId: "887", rarity: 0, itemId: "", itemName: "寻访情报书", kind: "gift_intel_book" });
    const badRarity = mkRecord({ seqId: "889", rarity: 9 });
    const badDrawZeroRarity = mkRecord({ seqId: "886", rarity: 0, kind: "draw" });
    const badDrawEmptyItem = mkRecord({ seqId: "885", itemId: "", kind: "draw" });
    const badSeq = mkRecord({ seqId: "abc" });
    const badFeed = mkRecord({ seqId: "890", feed: "x" });
    const mismatch = mkRecord({ seqId: "891", type: "weapon", feed: "char:E_CharacterGachaPoolType_Special" });

    const text = JSON.stringify({
      format: "better-endfield-gacha/v1",
      accounts: [{ ...acc, records: [valid, validGift, badRarity, badDrawZeroRarity, badDrawEmptyItem, badSeq, badFeed, mismatch] }],
    });

    const parsed = parseV1(text)[0]!;
    expect(parsed.records).toEqual([valid, validGift]);
    expect(parsed.skipped).toHaveLength(6);
    expect(parsed.skipped.map((s) => s.index)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("6. 超限校验：超过 maxRecordsPerAccount 时抛 ImportError", () => {
    const acc = mkAccount();
    const oversized = JSON.stringify({
      format: "better-endfield-gacha/v1",
      accounts: [{ ...acc, records: new Array(LIMITS.maxRecordsPerAccount + 1).fill({}) }],
    });
    expect(() => parseV1(oversized)).toThrowError(ImportError);
  });

  it("7. 备份校验：applyImport 后 backups/*.sqlite 存在且包含导入前行数（同秒连续备份不撞车）", async () => {
    const dir = mkTempDir();
    const store = GachaStore.open(dir);
    const acc = mkAccount();
    const existing = mkRecord({ seqId: "1" });
    store.upsertAccount(acc);
    store.insertRecords(acc.accountKey, [existing]);

    const incoming = mkRecord({ seqId: "2" });
    const plan = planImport(store, acc, [incoming], []);
    const res1 = applyImport(store, dir, acc, plan);
    expect(fs.existsSync(res1.backup)).toBe(true);
    expect(path.dirname(res1.backup)).toBe(path.join(dir, "backups"));

    const backupDb = new DatabaseSync(res1.backup, { readOnly: true });
    const row = backupDb.prepare("SELECT COUNT(*) AS cnt FROM records").get() as { cnt: number };
    expect(row.cnt).toBe(1);
    backupDb.close();
    expect(store.getRecords(acc.accountKey)).toHaveLength(2);

    // 同秒再次触发备份与 CLI backup，均应产生不冲突的新备份文件
    const incoming2 = mkRecord({ seqId: "3" });
    const plan2 = planImport(store, acc, [incoming2], []);
    const res2 = applyImport(store, dir, acc, plan2);
    expect(res2.backup).not.toBe(res1.backup);
    expect(fs.existsSync(res2.backup)).toBe(true);
    store.close();

    vi.spyOn(console, "log").mockImplementation(() => {});
    const exitBackup = await backup.run(makeContext(["backup", "--data-dir", dir]));
    expect(exitBackup).toBe(0);
    const files = fs.readdirSync(path.join(dir, "backups")).filter((f) => f.endsWith(".sqlite"));
    expect(files.length).toBe(3);
  });

  it("8. 离愁轩（lcx）救援导入：total 校验、3/4/5 启发式、poolMap/本地映射、10位时间戳、占位、改名与非数字 seqId", () => {
    const fixturePath = path.resolve("tests/fixtures/io/lcx-sample.json");
    const fixtureText = fs.readFileSync(fixturePath, "utf8");
    const fixtureDoc = JSON.parse(fixtureText);

    // 8a. total 与 list.length 不符 → 拒绝
    const badTotalDoc = {
      ...fixtureDoc,
      data: { ...fixtureDoc.data, total: fixtureDoc.data.list.length + 5 },
    };
    expect(() => parseLcx(JSON.stringify(badTotalDoc), { localRecords: [], poolMap: {} })).toThrowError(ImportError);

    // 8b. 无 poolMap 且本地仅知“测试特许池” → “测试武器箱”“未登记旧池”进 unresolvedPools；含 rarity=3 且无 6 → 整体 +1
    const localCharRec = mkRecord({
      poolId: "special_1_0_1",
      poolName: "测试特许池",
      itemId: "chr_real_star",
      itemName: "星辉测试员",
      seqId: "99",
    });
    const partialRes = parseLcx(fixtureText, { localRecords: [localCharRec], poolMap: {} });
    expect(partialRes.unresolvedPools).toEqual(["测试武器箱", "未登记旧池"]);
    expect(partialRes.records).toHaveLength(3);
    expect(partialRes.warnings.some((w) => w.includes("3/4/5"))).toBe(true);
    expect(partialRes.warnings.some((w) => w.includes("四星占位"))).toBe(true);

    // 验证 10 位时间戳转毫秒、本地唯一 itemId 命中、整体 +1 (5→6, 4→5)、占位转 lcx:unknown4 & rarity=4
    const r0 = partialRes.records.find((r) => r.seqId === "1001")!;
    expect(r0.gachaTs).toBe("1760000100000");
    expect(r0.itemId).toBe("chr_real_star");
    expect(r0.rarity).toBe(6);

    const r1 = partialRes.records.find((r) => r.seqId === "1002")!;
    expect(r1.gachaTs).toBe("1760000101000");
    expect(r1.itemId).toBe("lcx:unknown4");
    expect(r1.itemName).toBe("未知四星（离愁轩）");
    expect(r1.rarity).toBe(4);

    const r2 = partialRes.records.find((r) => r.seqId === "1003")!;
    expect(r2.rarity).toBe(5);
    expect(r2.itemId).toBe("lcx:夜航测试员");
    expect(r2.isFree).toBe(true);

    // 8c. 提供 poolMap 与本地“显锋”唯一映射，验证 RENAMES（应急手段→显锋）与武器占位
    const poolMap: Record<string, PoolMapEntry> = {
      测试武器箱: {
        feed: "weapon:weaponbox_1_0_1",
        poolId: "weaponbox_1_0_1",
        poolType: "special",
      },
      未登记旧池: {
        feed: "char:E_CharacterGachaPoolType_Rerun",
        poolId: "rerun_1_0_1",
        poolType: "E_CharacterGachaPoolType_Rerun",
      },
    };
    const localWeaponRec = mkRecord({
      type: "weapon",
      feed: "weapon:weaponbox_1_0_1",
      poolType: "special",
      poolId: "weaponbox_1_0_1",
      poolName: "测试武器箱",
      itemId: "wpn_real_xianfeng",
      itemName: "显锋",
      itemSubType: "sword",
      rarity: 5,
      seqId: "98",
    });
    const fullRes = parseLcx(fixtureText, { localRecords: [localCharRec, localWeaponRec], poolMap });
    expect(fullRes.unresolvedPools).toEqual([]);
    expect(fullRes.records).toHaveLength(6);

    const w0 = fullRes.records.find((r) => r.seqId === "2001")!;
    expect(w0.type).toBe("weapon");
    expect(w0.itemName).toBe("显锋");
    expect(w0.itemId).toBe("wpn_real_xianfeng");
    expect(w0.rarity).toBe(5);

    const w1 = fullRes.records.find((r) => r.seqId === "2002")!;
    expect(w1.itemId).toBe("lcx:unknown4");
    expect(w1.rarity).toBe(4);

    // 8d. 含 rarity=6 时不偏移；seqId 非纯数字拒绝并写 warnings；本地同名多池记 ambiguous
    const has6AndBadSeq = {
      code: 0,
      data: {
        uid: "synth_uid_990022",
        serverId: "1",
        server: "bilibili",
        total: 3,
        list: [
          { poolName: "同名歧义池", seqId: "4001", gachaTs: "1760000400", rarity: 6, charName: "六星乙" },
          { poolName: "测试特许池", seqId: "4002", gachaTs: "1760000401", rarity: 3, charName: "三星丙" },
          { poolName: "测试特许池", seqId: "bad-seq", gachaTs: "1760000402", rarity: 4, charName: "坏流水" },
        ],
      },
    };
    const ambigLocalA = mkRecord({ poolId: "p_a", poolName: "同名歧义池", seqId: "1" });
    const ambigLocalB = mkRecord({ poolId: "p_b", poolName: "同名歧义池", seqId: "2" });
    const resHas6 = parseLcx(JSON.stringify(has6AndBadSeq), {
      localRecords: [localCharRec, ambigLocalA, ambigLocalB],
      poolMap: {},
    });
    expect(resHas6.warnings.some((w) => w.includes("3/4/5"))).toBe(false);
    expect(resHas6.warnings.some((w) => w.includes("seqId"))).toBe(true);
    expect(resHas6.ambiguous).toEqual(["同名歧义池"]);
    expect(resHas6.records).toHaveLength(1);
    expect(resHas6.records[0]!.rarity).toBe(3); // 含 6 时保持原样不偏移
  });

  it("9. CSV 导出：BOM、CRLF、RFC4180 转义、防公式注入与 gift 过滤（CLI 强制 --out）", async () => {
    const drawRec = mkRecord({
      seqId: "1",
      poolName: '池名,带"引号"\n换行',
      itemName: "=SUM(1)",
      gachaTs: "1760000000000",
    });
    const plusRec = mkRecord({
      seqId: "2",
      itemName: "+CMD|calc",
      gachaTs: "1760000005",
    });
    const giftRec = mkRecord({
      seqId: "3",
      itemName: "寻访情报书",
      kind: "gift_10",
    });

    const csvNoGift = toCsv([drawRec, plusRec, giftRec]);
    expect(csvNoGift.startsWith("\uFEFF")).toBe(true);
    expect(csvNoGift).toContain("\r\n");
    expect(csvNoGift).toContain('"池名,带""引号""\n换行"');
    expect(csvNoGift).toContain("'=SUM(1)");
    expect(csvNoGift).toContain("'+CMD|calc");
    expect(csvNoGift).toContain("2025-10-09T"); // 10 位秒级时间戳转 ISO
    expect(csvNoGift).not.toContain("gift_10");

    const csvWithGift = toCsv([drawRec, giftRec], { includeGifts: true });
    expect(csvWithGift).toContain("gift_10");

    // CLI export csv 缺 --out 报错；带 --out 成功
    const dir = mkTempDir();
    const store = GachaStore.open(dir);
    const acc = mkAccount();
    store.upsertAccount(acc);
    store.insertRecords(acc.accountKey, [drawRec, giftRec]);
    store.close();

    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const noOutCode = await exportCmd.run(makeContext(["export", "--data-dir", dir, "--format", "csv"]));
    expect(noOutCode).toBe(1);

    const outCsv = path.join(dir, "out.csv");
    const okCode = await exportCmd.run(makeContext(["export", "--data-dir", dir, "--format", "csv", "--out", outCsv]));
    expect(okCode).toBe(0);
    const written = fs.readFileSync(outCsv, "utf8");
    expect(written.startsWith("\uFEFF")).toBe(true);
    expect(written).not.toContain("gift_10");
  });

  it("10. CLI 干跑与脱敏：import 无 --apply 不写库；--apply 落库并生成备份；lcx 缺 --account 报错", async () => {
    const dir = mkTempDir();
    const acc = mkAccount({ bindingUid: "secret_uid_999", roleId: "secret_role_888" });
    const rec = mkRecord({ seqId: "101" });
    const inFile = path.join(dir, "in.json");
    fs.writeFileSync(
      inFile,
      JSON.stringify({
        format: "better-endfield-gacha/v1",
        accounts: [{ ...acc, records: [rec] }],
      }),
      "utf8",
    );

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    const errs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errs.push(args.join(" "));
    });

    // 干跑：store 保持空
    const dryCode = await importCmd.run(makeContext(["import", "--data-dir", dir, "--in", inFile]));
    expect(dryCode).toBe(0);
    expect(logs.join("\n")).not.toContain("secret_uid_999");
    expect(logs.join("\n")).not.toContain("secret_role_888");
    expect(logs.join("\n")).toContain("干跑");

    const storeAfterDry = GachaStore.open(dir);
    expect(storeAfterDry.listAccounts()).toHaveLength(0);
    storeAfterDry.close();

    // --apply：写入并生成备份
    const applyCode = await importCmd.run(makeContext(["import", "--data-dir", dir, "--in", inFile, "--apply"]));
    expect(applyCode).toBe(0);
    const storeAfterApply = GachaStore.open(dir);
    expect(storeAfterApply.countRecords(acc.accountKey).total).toBe(1);
    storeAfterApply.close();
    expect(fs.readdirSync(path.join(dir, "backups")).some((f) => f.endsWith(".sqlite"))).toBe(true);

    // lcx 缺 --account 时报错退出 1，且列出的本地账号经脱敏
    const lcxPath = path.resolve("tests/fixtures/io/lcx-sample.json");
    const lcxNoAcc = await importCmd.run(makeContext(["import", "--data-dir", dir, "--in", lcxPath]));
    expect(lcxNoAcc).toBe(1);
    expect(errs.join("\n")).not.toContain("secret_uid_999");
    expect(errs.join("\n")).not.toContain("secret_role_888");

    // COMMANDS 已注册 import 与 backup；CLI 支持 lcx + --pool-map + --account + --apply
    expect(COMMANDS.map((c) => c.name)).toEqual(expect.arrayContaining(["import", "backup"]));
    const poolMapFile = path.join(dir, "pool-map.json");
    fs.writeFileSync(
      poolMapFile,
      JSON.stringify({
        测试武器箱: { feed: "weapon:weaponbox_1_0_1", poolId: "weaponbox_1_0_1", poolType: "special" },
      }),
      "utf8",
    );
    const lcxApply = await importCmd.run(
      makeContext([
        "import",
        "--data-dir",
        dir,
        "--in",
        lcxPath,
        "--account",
        acc.accountKey,
        "--pool-map",
        poolMapFile,
        "--apply",
      ]),
    );
    expect(lcxApply).toBe(0);
    expect(logs.join("\n")).toContain("未登记旧池");
    const storeAfterLcx = GachaStore.open(dir);
    // 原有 1 条(seq=101, 测试特许池) + 测试特许池(3条, 从本地记录解析) + 测试武器箱(2条, 从 pool-map 解析)；未登记旧池跳过
    expect(storeAfterLcx.countRecords(acc.accountKey).total).toBe(6);
    storeAfterLcx.close();
  });

  it("11. 安全清洗与额外边界：未知字段丢弃、所有公式注入前缀、v1 多账号 --account 过滤", async () => {
    const accA = mkAccount({ bindingUid: "bind_a", roleId: "role_a" });
    const accB = mkAccount({ bindingUid: "bind_b", roleId: "role_b" });
    const dir = mkTempDir();
    const inFile = path.join(dir, "multi.json");
    fs.writeFileSync(
      inFile,
      JSON.stringify({
        format: "better-endfield-gacha/v1",
        accounts: [
          { ...accA, records: [{ ...mkRecord({ seqId: "1" }), extraEvil: "<script>" }] },
          { ...accB, records: [mkRecord({ seqId: "2" })] },
        ],
      }),
      "utf8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await importCmd.run(
      makeContext(["import", "--data-dir", dir, "--in", inFile, "--account", accB.accountKey, "--apply"]),
    );
    expect(code).toBe(0);

    const store = GachaStore.open(dir);
    expect(store.listAccounts().map((a) => a.accountKey)).toEqual([accB.accountKey]);
    store.close();

    // 验证 validateRecord via parseV1 丢弃未知字段
    const parsedA = parseV1(fs.readFileSync(inFile, "utf8"))[0]!;
    expect("extraEvil" in parsedA.records[0]!).toBe(false);

    // 验证 @, -, \t, \r 公式前缀均加单引号
    const csv = toCsv([
      mkRecord({ seqId: "1", itemName: "@at" }),
      mkRecord({ seqId: "2", itemName: "-minus" }),
      mkRecord({ seqId: "3", itemName: "\ttab" }),
      mkRecord({ seqId: "4", itemName: "\rcr" }),
    ]);
    expect(csv).toContain("'@at");
    expect(csv).toContain("'-minus");
    expect(csv).toContain("'\ttab");
    expect(csv).toContain("\"'\rcr\"");
  });

  it("12. 离愁轩实机形态边界夹具：4/5/6混用rarity=3未知角色、13位string exportTs、内部数字charId/weaponId不误采、毫秒截断冲突保护", () => {
    const fixtureText = fs.readFileSync(path.resolve("tests/fixtures/io/lcx-real-shape.json"), "utf8");
    const acc = mkAccount({ bindingUid: "990011223", roleId: "9900112233" });

    // 本地官方记录含真实毫秒（...932）与一条同 seqId 的非抽卡 gift 记录
    const officialDraw = mkRecord({
      poolId: "special_1_0_1",
      poolName: "测试特许池",
      itemId: "chr_real_star",
      itemName: "星辉测试员",
      rarity: 6,
      gachaTs: "1760000500932",
      seqId: "501",
    });
    const officialGift = mkRecord({
      poolId: "special_1_0_1",
      poolName: "测试特许池",
      itemId: "",
      itemName: "寻访情报书",
      rarity: 0,
      gachaTs: "1760000501932",
      seqId: "502",
      kind: "gift_intel_book",
    });
    const officialWeapon = mkRecord({
      type: "weapon",
      feed: "weapon:weaponbox_1_0_1",
      poolType: "special",
      poolId: "weaponbox_1_0_1",
      poolName: "测试武器箱",
      itemId: "wpn_real_xianfeng",
      itemName: "显锋",
      itemSubType: "sword",
      rarity: 5,
      gachaTs: "1760000400123",
      seqId: "599",
    });

    const parsed = parseLcx(fixtureText, { localRecords: [officialDraw, officialGift, officialWeapon], poolMap: {} });
    expect(parsed.meta.exportTs).toBe(1760000900000);
    expect(parsed.unresolvedPools).toEqual([]);
    expect(parsed.warnings.some((w) => w.includes("3/4/5"))).toBe(false);
    expect(parsed.records).toHaveLength(4);

    // 内部数字 charId/weaponId 不应误采，仍按名称反查本地官方 ID 或降级 lcx:<name>
    const c6 = parsed.records.find((r) => r.seqId === "501")!;
    expect(c6.itemId).toBe("chr_real_star");
    expect(c6.rarity).toBe(6);

    const unk = parsed.records.find((r) => r.seqId === "502")!;
    expect(unk.itemId).toBe("lcx:unknown4");
    expect(unk.rarity).toBe(4);

    const w5 = parsed.records.find((r) => r.seqId === "601")!;
    expect(w5.itemId).toBe("wpn_real_xianfeng");
    expect(w5.itemSubType).toBe("");

    // 重叠官方记录（毫秒截断差异 501 / gift vs 未知角色 502）：
    // 默认严格模式均进 conflicts；开启 allowTruncatedMs（离愁轩导入）时 501 归为同秒重复并保留本地精确记录，502 仍进 conflicts
    const dir = mkTempDir();
    const store = GachaStore.open(dir);
    store.upsertAccount(acc);
    store.insertRecords(acc.accountKey, [officialDraw, officialGift, officialWeapon]);
    const strictPlan = planImport(store, acc, parsed.records, []);
    expect(strictPlan.newRecords.map((r) => r.seqId)).toEqual(["503", "601"]);
    expect(strictPlan.truncatedMsDuplicates).toBe(0);
    expect(strictPlan.conflicts.map((c) => c.seqId)).toEqual(["501", "502"]);

    const lcxPlan = planImport(store, acc, parsed.records, [], { allowTruncatedMs: true });
    expect(lcxPlan.newRecords.map((r) => r.seqId)).toEqual(["503", "601"]);
    expect(lcxPlan.duplicates).toBe(1);
    expect(lcxPlan.truncatedMsDuplicates).toBe(1);
    expect(lcxPlan.conflicts.map((c) => c.seqId)).toEqual(["502"]);
    store.close();
  });

  it("13. 离愁轩内置卡池/物品表：空库无需 --pool-map 即可导入 1.0~1.4 旧池与常驻池并衔接 UP 分析，遵循映射优先级", () => {
    const dir = mkTempDir();
    const store = GachaStore.open(dir);
    try {
      const acc = mkAccount();
      store.upsertAccount(acc);

      const raw = JSON.stringify({
        code: 0,
        data: {
          uid: "synth_uid_13",
          export_timestamp: 1775000900,
          total: 7,
          list: [
            { seqId: "1", gachaTs: 1770000100, rarity: 5, poolName: "熔火灼痕", isFree: false, charName: "莱万汀", charId: "999" },
            { seqId: "2", gachaTs: 1770000200, rarity: 5, poolName: "熔火灼痕", isFree: false, charName: "余烬", charId: "998" },
            { seqId: "3", gachaTs: 1770000300, rarity: 4, poolName: "基础寻访", isFree: false, charName: "佩丽卡" },
            { seqId: "4", gachaTs: 1770000400, rarity: 5, poolName: "辉光庆典", isFree: false, charName: "艾尔黛拉" },
            { seqId: "5", gachaTs: 1770000500, rarity: 3, poolName: "未收录测试新池", isFree: false, charName: "荧光棒测试角色" },
            { seqId: "101", gachaTs: 1770000600, rarity: 5, poolName: "熔铸申领", isFree: false, weaponName: "熔铸火焰", weaponId: "888" },
            { seqId: "102", gachaTs: 1770000700, rarity: 5, poolName: "星声申领", isFree: false, weaponName: "沧溟星梦" },
          ],
        },
      });

      // 空库、空 poolMap：除“未收录测试新池”外全部自动识别，并映射官方 ID
      const parsed = parseLcx(raw, { localRecords: [], poolMap: {} });
      expect(parsed.unresolvedPools).toEqual(["未收录测试新池"]);
      expect(parsed.ambiguous).toEqual([]);
      expect(parsed.records).toHaveLength(6);

      const r1 = parsed.records.find((r) => r.seqId === "1")!;
      expect(r1.poolId).toBe("special_1_0_1");
      expect(r1.itemId).toBe("chr_0016_laevat");
      const r2 = parsed.records.find((r) => r.seqId === "2")!;
      expect(r2.itemId).toBe("chr_0009_azrila");
      const r4 = parsed.records.find((r) => r.seqId === "4")!;
      expect(r4.poolId).toBe("joint_1_2_2");
      expect(r4.itemId).toBe("chr_0025_ardelia");
      const w1 = parsed.records.find((r) => r.seqId === "101")!;
      expect(w1.poolId).toBe("weponbox_1_0_1");
      expect(w1.itemId).toBe("wpn_sword_0006");
      const w2 = parsed.records.find((r) => r.seqId === "102")!;
      expect(w2.poolId).toBe("weaponbox_constant_2");
      expect(w2.itemId).toBe("wpn_funnel_0013");

      // 入库并分析：1.0 旧池可正确判定 UP/歪
      const plan = planImport(store, acc, parsed.records, [], { allowTruncatedMs: true });
      applyImport(store, dir, acc, plan);
      const analysis = analyzeAccount({
        accountKey: acc.accountKey,
        records: store.getRecords(acc.accountKey),
        pools: store.getAllPools(),
        rerunChar: [],
        rerunWeapon: [],
      });
      const allHits6 = analysis.groups.flatMap((g) => g.hits);
      const laevatHit = allHits6.find((h) => h.seqId === "1")!;
      const offHit = allHits6.find((h) => h.seqId === "2")!;
      const jointHit = allHits6.find((h) => h.seqId === "4")!;
      const wpnHit = allHits6.find((h) => h.seqId === "101")!;
      expect(laevatHit.isUp).toBe(true);
      expect(offHit.isUp).toBe(false);
      expect(jointHit.isUp).toBe(true);
      expect(wpnHit.isUp).toBe(true);

      // 优先级：--pool-map > 本地 DB > 内置表；本地同名歧义不会被内置表静默掩盖
      const localRecA = mkRecord({
        seqId: "1",
        poolId: "local_override_1",
        poolName: "熔火灼痕",
        poolType: "E_CharacterGachaPoolType_Special",
        feed: "char:E_CharacterGachaPoolType_Special",
        itemId: "chr_0016_laevat",
        itemName: "莱万汀",
      });
      const overByLocal = parseLcx(raw, { localRecords: [localRecA], poolMap: {} });
      expect(overByLocal.records.find((r) => r.seqId === "1")?.poolId).toBe("local_override_1");

      const overByFlag = parseLcx(raw, {
        localRecords: [localRecA],
        poolMap: { 熔火灼痕: { feed: "char:E_CharacterGachaPoolType_Special", poolId: "flag_override", poolType: "E_CharacterGachaPoolType_Special" } },
      });
      expect(overByFlag.records.find((r) => r.seqId === "1")?.poolId).toBe("flag_override");

      const localRecB = mkRecord({
        seqId: "2",
        poolId: "local_override_2",
        poolName: "熔火灼痕",
        poolType: "E_CharacterGachaPoolType_Special",
        feed: "char:E_CharacterGachaPoolType_Special",
        itemId: "chr_0016_laevat",
        itemName: "莱万汀",
      });
      const amb = parseLcx(raw, { localRecords: [localRecA, localRecB], poolMap: {} });
      expect(amb.ambiguous).toContain("熔火灼痕");
    } finally {
      store.close();
    }
  });
});
