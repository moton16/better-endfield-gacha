import fs from "node:fs";
import { applyImport, planImport, type ImportPlan } from "../../core/io/importer.js";
import { looksLikeLcx, parseLcx, type PoolMapEntry } from "../../core/io/lcx.js";
import { parseV1 } from "../../core/io/v1.js";
import { ImportError, LIMITS } from "../../core/io/validate.js";
import { GachaStore } from "../../core/storage/store.js";
import type { AccountRow } from "../../core/types.js";
import type { Command } from "../types.js";
import { maskKey } from "../util.js";

function loadPoolMap(filePath: string): Record<string, PoolMapEntry> {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new ImportError("pool-map 不是普通文件");
  if (stat.size > LIMITS.maxFileBytes) throw new ImportError("pool-map 文件过大");
  const raw = fs.readFileSync(filePath, "utf8");
  const clean = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new ImportError("pool-map 不是合法 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ImportError("pool-map 必须是对象映射");
  }
  const out: Record<string, PoolMapEntry> = {};
  for (const [poolName, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      throw new ImportError(`pool-map["${poolName}"] 必须是对象`);
    }
    const entry = v as Record<string, unknown>;
    if (typeof entry.feed !== "string" || typeof entry.poolId !== "string" || typeof entry.poolType !== "string") {
      throw new ImportError(`pool-map["${poolName}"] 必须包含字符串字段 feed/poolId/poolType`);
    }
    out[poolName] = { feed: entry.feed, poolId: entry.poolId, poolType: entry.poolType };
  }
  return out;
}

function detectFormat(text: string): "v1" | "lcx" {
  const clean = text.startsWith("\uFEFF") ? text.slice(1) : text;
  let doc: unknown;
  try {
    doc = JSON.parse(clean);
  } catch {
    throw new ImportError("导入文件不是合法 JSON");
  }
  if (doc && typeof doc === "object" && !Array.isArray(doc) && (doc as Record<string, unknown>).format === "better-endfield-gacha/v1") {
    return "v1";
  }
  if (looksLikeLcx(doc)) return "lcx";
  throw new ImportError("无法识别导入格式（支持 better-endfield-gacha/v1 与离愁轩 JSON，或用 --format 显式指定）");
}

function printLocalAccounts(accounts: AccountRow[], show: boolean): void {
  if (accounts.length === 0) {
    console.error("本地暂无账号，请先执行 sync 建档。");
    return;
  }
  console.error("本地已有账号：");
  for (const a of accounts) {
    console.error(`  ${maskKey(a.accountKey, show)}  ${a.channelName || a.region}`);
  }
}

function printPlanSummary(plan: ImportPlan, show: boolean): void {
  const newDraws = plan.newRecords.filter((r) => r.kind === "draw").length;
  const newGifts = plan.newRecords.length - newDraws;
  const newDetail = newGifts > 0 ? `${plan.newRecords.length}（抽卡 ${newDraws} + 非抽卡 ${newGifts}）` : `${plan.newRecords.length}`;
  console.log(
    `账号 ${maskKey(plan.accountKey, show)}：解析 ${plan.total} 条 | 新增 ${newDetail} | 重复 ${plan.duplicates} | 冲突 ${plan.conflicts.length} | 跳过 ${plan.skipped.length}`,
  );
  if (plan.conflicts.length > 0) {
    console.log(`  ! 冲突 ${plan.conflicts.length} 条（本地官方记录优先，不覆盖）`);
  }
  if (plan.skipped.length > 0) {
    console.log(`  ! 跳过非法记录 ${plan.skipped.length} 条`);
  }
}

export const importCmd: Command = {
  name: "import",
  summary: "导入抽卡记录（默认干跑，--apply 才落库并自动备份）",
  async run(ctx) {
    const inPath = ctx.str("in");
    if (!inPath) {
      console.error("缺少必填参数：--in <文件路径>");
      return 1;
    }
    const rawFormat = ctx.str("format") ?? "auto";
    if (rawFormat !== "auto" && rawFormat !== "v1" && rawFormat !== "lcx") {
      console.error(`不支持的格式：${rawFormat}（可选 auto|v1|lcx）`);
      return 1;
    }

    let text: string;
    try {
      const stat = fs.statSync(inPath);
      if (!stat.isFile()) {
        console.error(`导入路径不是文件：${inPath}`);
        return 1;
      }
      if (stat.size > LIMITS.maxFileBytes) {
        console.error(`导入文件过大（超过 ${LIMITS.maxFileBytes} 字节）`);
        return 1;
      }
      text = fs.readFileSync(inPath, "utf8");
    } catch (e) {
      console.error(`无法读取导入文件：${(e as Error).message}`);
      return 1;
    }

    const poolMapPath = ctx.str("pool-map");
    let poolMap: Record<string, PoolMapEntry> = {};
    if (poolMapPath) {
      try {
        poolMap = loadPoolMap(poolMapPath);
      } catch (e) {
        console.error(`读取 --pool-map 失败：${(e as Error).message}`);
        return 1;
      }
    }

    let format: "v1" | "lcx";
    try {
      format = rawFormat === "auto" ? detectFormat(text) : rawFormat;
    } catch (e) {
      console.error((e as Error).message);
      return 1;
    }

    const dataDir = ctx.dataDir();
    const show = ctx.bool("show-ids");
    const apply = ctx.bool("apply");
    const targetAccount = ctx.str("account");
    const store = GachaStore.open(dataDir);

    try {
      if (format === "v1") {
        let parsed;
        try {
          parsed = parseV1(text);
        } catch (e) {
          console.error(`导入校验失败：${(e as Error).message}`);
          return 1;
        }
        const selected = targetAccount ? parsed.filter((p) => p.account.accountKey === targetAccount) : parsed;
        if (targetAccount && selected.length === 0) {
          console.error(`导入文件中不包含指定账号：${maskKey(targetAccount, show)}`);
          return 1;
        }
        if (selected.length === 0) {
          console.log("导入文件中不包含任何账号。");
          return 0;
        }
        const plans = selected.map((p) => ({ parsed: p, plan: planImport(store, p.account, p.records, p.skipped) }));
        for (const { plan } of plans) printPlanSummary(plan, show);
        if (!apply) {
          console.log("干跑模式：未写入数据库（添加 --apply 执行导入）。");
          return 0;
        }
        for (const { parsed: p, plan } of plans) {
          const res = applyImport(store, dataDir, p.account, plan);
          console.log(`已写入 ${maskKey(plan.accountKey, show)}：新增 ${res.added} 条（备份：${res.backup}）`);
        }
        return 0;
      }

      // format === "lcx"
      const localAccounts = store.listAccounts();
      if (!targetAccount) {
        console.error("离愁轩导入必须通过 --account <accountKey> 指定目标账号。");
        printLocalAccounts(localAccounts, show);
        return 1;
      }
      const account = store.getAccount(targetAccount);
      if (!account) {
        console.error(`本地不存在指定账号：${maskKey(targetAccount, show)}`);
        printLocalAccounts(localAccounts, show);
        return 1;
      }

      let lcxRes;
      try {
        lcxRes = parseLcx(text, { localRecords: store.getRecords(account.accountKey), poolMap });
      } catch (e) {
        console.error(`离愁轩文件校验失败：${(e as Error).message}`);
        return 1;
      }

      const plan = planImport(store, account, lcxRes.records, []);
      printPlanSummary(plan, show);
      for (const w of lcxRes.warnings) console.log(`  ! ${w}`);
      if (lcxRes.ambiguous.length > 0) {
        console.log(`  ! 歧义卡池（同名对应多个本地池，已跳过）：${lcxRes.ambiguous.join("、")}`);
      }
      if (lcxRes.unresolvedPools.length > 0) {
        console.log(`  ! 未解析卡池（请补充 --pool-map 映射后重试）：${lcxRes.unresolvedPools.join("、")}`);
      }

      if (!apply) {
        console.log("干跑模式：未写入数据库（添加 --apply 执行导入）。");
        return 0;
      }

      const res = applyImport(store, dataDir, account, plan);
      console.log(`已写入 ${maskKey(account.accountKey, show)}：新增 ${res.added} 条（备份：${res.backup}）`);
      return 0;
    } finally {
      store.close();
    }
  },
};
