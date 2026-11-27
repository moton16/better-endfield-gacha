/**
 * 数据对话框三件套：离愁轩空库建档导入、导出落盘到 exports/、备份列表与合并恢复。
 * 全部使用 os.tmpdir() 临时目录与合成夹具。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listBackups, planRestore, resolveBackupFile } from "../src/core/io/restore.js";
import { readLcxMeta, resolveLcxAccount } from "../src/core/io/lcx.js";
import { GachaStore } from "../src/core/storage/store.js";
import { buildAccountKey, type AccountRow, type GachaRecord } from "../src/core/types.js";
import { createApp } from "../src/server/index.js";
import lcxSample from "./fixtures/io/lcx-sample.json" with { type: "json" };

const dirs: string[] = [];
const closers: Array<() => Promise<void> | void> = [];

function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function acc(): AccountRow {
  return {
    region: "cn",
    channelMasterId: "2",
    bindingUid: "SYNTH_UID_1",
    roleId: "SYNTH_ROLE_1",
    accountKey: buildAccountKey({ region: "cn", channelMasterId: "2", bindingUid: "SYNTH_UID_1", roleId: "SYNTH_ROLE_1" }),
    nickname: "T",
    serverId: "1",
    serverName: "",
    channelName: "bilibili服",
    source: "cache",
    updatedAt: 1,
  };
}

function rec(seq: number): GachaRecord {
  return {
    type: "char",
    feed: "char:E_CharacterGachaPoolType_Special",
    poolType: "E_CharacterGachaPoolType_Special",
    poolId: "p1",
    poolName: "合成池",
    itemId: `c${seq}`,
    itemName: `角色${seq}`,
    itemSubType: "",
    rarity: 4,
    isFree: false,
    isNew: false,
    gachaTs: String(1_760_000_000_000 + seq * 1000),
    seqId: String(seq),
    kind: "draw",
  };
}

async function start(dataDir: string, store: GachaStore, openFolder?: (d: string) => void) {
  const app = createApp({ dataDir, webDir: tmp("beg-di-web-"), deps: { store, openFolder } });
  closers.push(() => app.close());
  closers.push(() => store.close());
  const base = (await app.listen()).split("#")[0]!.replace(/\/$/, "");
  const call = async (method: string, p: string, body?: unknown) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { "X-BEG-Key": app.key, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { call };
}

afterEach(async () => {
  while (closers.length) await closers.pop()!();
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("数据对话框：导入 / 导出 / 备份恢复", () => {
  it("1. 空库导入离愁轩：createAccount 按文件 UID 建档；已有同 UID 账号则复用；无 account 且无 createAccount 仍 400", async () => {
    const dataDir = tmp("beg-di-lcx-");
    const store = GachaStore.open(dataDir);
    const { call } = await start(dataDir, store);
    const text = JSON.stringify(lcxSample);
    const spec = { feed: "char:E_CharacterGachaPoolType_Special", poolType: "E_CharacterGachaPoolType_Special" };
    // 合成夹具的卡池名不在内置表里，用 poolMap 显式映射（真实离愁轩文件的 1.0~1.4 池走内置表）
    const poolMap = {
      测试特许池: { ...spec, poolId: "sp_t" },
      未登记旧池: { ...spec, poolId: "sp_u" },
      测试武器箱: { feed: "weapon:wp_t", poolType: "special", poolId: "wp_t" },
    };

    expect((await call("POST", "/api/import", { text, format: "lcx" })).status).toBe(400);

    const dry = await call("POST", "/api/import", { text, format: "lcx", createAccount: true, poolMap, apply: false });
    expect(dry.status).toBe(200);
    expect(dry.json.createdAccount).toBe(true);
    expect(dry.json.plans[0].added).toBeGreaterThan(0);
    expect(store.listAccounts()).toHaveLength(0); // 干跑不建档

    const applied = await call("POST", "/api/import", { text, format: "lcx", createAccount: true, poolMap, apply: true });
    expect(applied.status).toBe(200);
    const accounts = store.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.source).toBe("import");
    expect(accounts[0]!.channelName).toBe("bilibili服");
    expect(store.getRecords(accounts[0]!.accountKey).length).toBe(applied.json.plans[0].added);

    // 再导入同一文件：匹配到刚建的账号，不新建
    const again = await call("POST", "/api/import", { text, format: "lcx", createAccount: true, poolMap, apply: true });
    expect(again.json.createdAccount).toBe(false);
    expect(again.json.plans[0].added).toBe(0);
    expect(store.listAccounts()).toHaveLength(1);
  });

  it("2. resolveLcxAccount 优先匹配 roleId/bindingUid 等于文件 UID 的已有账号", () => {
    const meta = readLcxMeta(JSON.stringify(lcxSample));
    const existing = { ...acc(), roleId: meta.uid };
    const r = resolveLcxAccount(meta, [existing]);
    expect(r.matched).toBe(true);
    expect(r.account.accountKey).toBe(existing.accountKey);
  });

  it("3. /api/export/save 写入 exports/ 并返回位置；/api/open-folder 只接受固定目录名", async () => {
    const dataDir = tmp("beg-di-exp-");
    const store = GachaStore.open(dataDir);
    const a = acc();
    store.upsertAccount(a);
    store.insertRecords(a.accountKey, [rec(1), rec(2)]);
    const opened: string[] = [];
    const { call } = await start(dataDir, store, (d) => opened.push(d));

    const j = await call("POST", "/api/export/save", { format: "json" });
    expect(j.status).toBe(200);
    expect(j.json.records).toBe(2);
    const file = path.join(dataDir, "exports", j.json.file);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).format).toBe("better-endfield-gacha/v1");

    const c = await call("POST", "/api/export/save", { format: "csv", account: a.accountKey });
    expect(c.status).toBe(200);
    expect(fs.existsSync(path.join(dataDir, "exports", c.json.file))).toBe(true);
    expect(c.json.file.endsWith(".csv")).toBe(true);

    expect((await call("POST", "/api/export/save", { format: "xml" })).status).toBe(400);
    expect((await call("POST", "/api/export/save", { format: "json", account: "nope" })).status).toBe(404);

    expect((await call("POST", "/api/open-folder", { target: "exports" })).status).toBe(200);
    expect(opened).toEqual([path.join(path.resolve(dataDir), "exports")]);
    expect((await call("POST", "/api/open-folder", { target: "..\\..\\Windows" })).status).toBe(400);
  });

  it("4. 备份列表与合并恢复：干跑不写入，apply 补回缺失记录并生成恢复前备份；拒绝路径穿越", async () => {
    const dataDir = tmp("beg-di-bak-");
    const store = GachaStore.open(dataDir);
    const a = acc();
    store.upsertAccount(a);
    store.insertRecords(a.accountKey, [rec(1), rec(2), rec(3)]);
    store.setAccountAvatar(a.accountKey, "media/avatars/x.webp");
    const { call } = await start(dataDir, store);

    const bak = await call("POST", "/api/backup", {});
    expect(bak.status).toBe(200);
    const list = await call("GET", "/api/backups");
    expect(list.json.files.map((f: { file: string }) => f.file)).toEqual([bak.json.file]);

    // 模拟「丢数据」：换成一个空库后再恢复
    const dir2 = tmp("beg-di-bak2-");
    fs.mkdirSync(path.join(dir2, "backups"), { recursive: true });
    fs.copyFileSync(path.join(dataDir, "backups", bak.json.file), path.join(dir2, "backups", bak.json.file));
    const store2 = GachaStore.open(dir2);
    const { call: call2 } = await start(dir2, store2);

    const dry = await call2("POST", "/api/backup/restore", { file: bak.json.file, apply: false });
    expect(dry.status).toBe(200);
    expect(dry.json.applied).toBe(false);
    expect(dry.json.plans[0].added).toBe(3);
    expect(store2.listAccounts()).toHaveLength(0);
    expect(fs.readdirSync(path.join(dir2, "backups")).filter((n) => n.startsWith(".restore-"))).toHaveLength(0);

    const done = await call2("POST", "/api/backup/restore", { file: bak.json.file, apply: true });
    expect(done.status).toBe(200);
    expect(done.json.applied).toBe(true);
    expect(store2.getRecords(a.accountKey)).toHaveLength(3);
    expect(store2.getAccountAvatar(a.accountKey)).toBe("media/avatars/x.webp");
    expect(listBackups(dir2).length).toBe(2); // 原备份 + 恢复前安全备份

    // 再次恢复：全部重复，不新增
    const again = await call2("POST", "/api/backup/restore", { file: bak.json.file, apply: true });
    expect(again.json.plans[0].added).toBe(0);

    expect((await call2("POST", "/api/backup/restore", { file: "../gacha.sqlite" })).status).toBe(400);
    expect((await call2("POST", "/api/backup/restore", { file: "gacha-nope.sqlite" })).status).toBe(400);
  });

  it("5. 非 SQLite 文件放进 backups/ 时恢复报 400（bad_backup），不污染本地库", async () => {
    const dataDir = tmp("beg-di-bad-");
    const store = GachaStore.open(dataDir);
    fs.mkdirSync(path.join(dataDir, "backups"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "backups", "gacha-garbage.sqlite"), "this is not a database");
    expect(() => planRestore(store, dataDir, resolveBackupFile(dataDir, "gacha-garbage.sqlite"))).toThrow();
    const { call } = await start(dataDir, store);
    const r = await call("POST", "/api/backup/restore", { file: "gacha-garbage.sqlite" });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("bad_backup");
    expect(store.listAccounts()).toHaveLength(0);
  });
});
