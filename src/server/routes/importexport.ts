import fs from "node:fs";
import path from "node:path";
import { toCsv } from "../../core/io/csv.js";
import { applyImport, createBackup, planImport } from "../../core/io/importer.js";
import { looksLikeLcx, parseLcx, readLcxMeta, resolveLcxAccount, type PoolMapEntry } from "../../core/io/lcx.js";
import { applyRestore, backupsDir, listBackups, planRestore, resolveBackupFile } from "../../core/io/restore.js";
import { parseV1 } from "../../core/io/v1.js";
import { ImportError } from "../../core/io/validate.js";
import { maskKey } from "../../core/mask.js";
import type { AccountRow } from "../../core/types.js";
import { HttpError, type Router } from "../http.js";
import type { AppDeps } from "../index.js";
import { openFolder } from "../open-window.js";

const IMPORT_BODY_LIMIT = 60 * 1024 * 1024;

interface ImportBody {
  text?: unknown;
  format?: unknown;
  account?: unknown;
  poolMap?: unknown;
  apply?: unknown;
  /** 离愁轩：未指定 account 时，按文件 UID 匹配已有账号，找不到则新建 */
  createAccount?: unknown;
}

function validatePoolMap(raw: unknown): Record<string, PoolMapEntry> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "poolMap 必须是对象映射", "bad_pool_map");
  }
  const out: Record<string, PoolMapEntry> = {};
  for (const [poolName, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      throw new HttpError(400, `poolMap["${poolName}"] 必须是对象`, "bad_pool_map");
    }
    const entry = v as Record<string, unknown>;
    if (typeof entry.feed !== "string" || typeof entry.poolId !== "string" || typeof entry.poolType !== "string") {
      throw new HttpError(400, `poolMap["${poolName}"] 必须包含字符串字段 feed/poolId/poolType`, "bad_pool_map");
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
  throw new ImportError("无法识别导入格式（支持 better-endfield-gacha/v1 与离愁轩 JSON）");
}

interface ExportOpts {
  format: "json" | "csv";
  account?: string;
  /** csv 默认不含赠品；json 默认含 */
  includeGifts: boolean;
}

function buildExport(deps: AppDeps, o: ExportOpts): { text: string; mime: string; records: number; accounts: number } {
  const list = o.account
    ? (() => {
        const acc = deps.store.getAccount(o.account);
        if (!acc) throw new HttpError(404, "账号不存在", "not_found");
        return [acc];
      })()
    : deps.store.listAccounts();

  if (o.format === "csv") {
    const records = list.flatMap((a) => deps.store.getRecords(a.accountKey));
    const csv = toCsv(records, { includeGifts: o.includeGifts });
    const n = records.filter((r) => o.includeGifts || r.kind === "draw").length;
    return { text: csv, mime: "text/csv; charset=utf-8", records: n, accounts: list.length };
  }

  let n = 0;
  const doc = {
    format: "better-endfield-gacha/v1",
    exportedAt: new Date().toISOString(),
    accounts: list.map((a) => {
      const recs = deps.store.getRecords(a.accountKey);
      const kept = o.includeGifts ? recs : recs.filter((r) => r.kind === "draw");
      n += kept.length;
      return { ...a, records: kept };
    }),
  };
  return { text: JSON.stringify(doc, null, 2), mime: "application/json; charset=utf-8", records: n, accounts: list.length };
}

function stamp(now = new Date()): string {
  const raw = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${raw.slice(0, 8)}-${raw.slice(8, 14)}`;
}

function writeUnique(dir: string, base: string, ext: string, text: string): string {
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 10_000; i++) {
    const name = i === 0 ? `${base}.${ext}` : `${base}-${i}.${ext}`;
    const full = path.join(dir, name);
    try {
      fs.writeFileSync(full, text, { encoding: "utf8", flag: "wx" });
      return full;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new HttpError(500, "无法生成导出文件名", "export_failed");
}

function requireDiskDataDir(deps: AppDeps, what: string): string {
  if (deps.dataDir === ":memory:") {
    throw new HttpError(400, `内存数据库不支持${what}，请使用磁盘数据目录`, "bad_request");
  }
  return path.resolve(deps.dataDir);
}

export function register(router: Router, deps: AppDeps): void {
  router.get("/api/export", (c) => {
    const sp = c.url.searchParams;
    const format = sp.get("format") ?? "json";
    if (format !== "json" && format !== "csv") {
      throw new HttpError(400, "不支持的导出格式（可选 json|csv）", "bad_request");
    }

    const rawGifts = sp.get("includeGifts");
    const includeGifts = format === "csv" ? rawGifts === "1" || rawGifts === "true" : rawGifts !== "0" && rawGifts !== "false";
    const out = buildExport(deps, { format, account: sp.get("account") || undefined, includeGifts });
    c.res.writeHead(200, {
      "Content-Type": out.mime,
      "Content-Disposition": `attachment; filename="beg-export.${format}"`,
      "Content-Length": Buffer.byteLength(out.text, "utf8"),
    });
    c.res.end(out.text);
    return undefined;
  });

  /** 直接保存到 <数据目录>/exports/，并返回位置（桌面壳里的浏览器下载常无任何可见反馈） */
  router.post("/api/export/save", async (c) => {
    const body = await c.json<{ format?: unknown; account?: unknown; includeGifts?: unknown }>();
    const root = requireDiskDataDir(deps, "文件导出");
    if (body.format !== "json" && body.format !== "csv") {
      throw new HttpError(400, "不支持的导出格式（可选 json|csv）", "bad_request");
    }
    if (body.account !== undefined && body.account !== "" && typeof body.account !== "string") {
      throw new HttpError(400, "account 必须是字符串", "bad_request");
    }
    const includeGifts = body.format === "csv" ? body.includeGifts === true : body.includeGifts !== false;
    const out = buildExport(deps, {
      format: body.format,
      account: typeof body.account === "string" && body.account ? body.account : undefined,
      includeGifts,
    });
    const dir = path.join(root, "exports");
    const full = writeUnique(dir, `beg-export-${stamp()}`, body.format, out.text);
    return {
      file: path.basename(full),
      dir,
      bytes: Buffer.byteLength(out.text, "utf8"),
      accounts: out.accounts,
      records: out.records,
    };
  });

  router.post("/api/open-folder", async (c) => {
    const body = await c.json<{ target?: unknown }>();
    const root = requireDiskDataDir(deps, "打开文件夹");
    if (body.target !== "exports" && body.target !== "backups") {
      throw new HttpError(400, "target 仅支持 exports|backups", "bad_request");
    }
    const dir = path.join(root, body.target);
    fs.mkdirSync(dir, { recursive: true });
    (deps.openFolder ?? openFolder)(dir);
    return { dir };
  });

  router.post("/api/import", async (c) => {
    const body = await c.json<ImportBody>(IMPORT_BODY_LIMIT);
    if (typeof body.text !== "string" || !body.text.trim()) {
      throw new HttpError(400, "缺少导入内容 text", "bad_request");
    }

    const rawFormat = body.format ?? "auto";
    if (rawFormat !== "auto" && rawFormat !== "v1" && rawFormat !== "lcx") {
      throw new HttpError(400, "format 仅支持 auto|v1|lcx", "bad_request");
    }

    let targetAccount: string | undefined;
    if (body.account !== undefined && body.account !== "") {
      if (typeof body.account !== "string") {
        throw new HttpError(400, "account 必须是字符串", "bad_request");
      }
      targetAccount = body.account;
    }

    const poolMap = validatePoolMap(body.poolMap);
    const apply = body.apply === true;
    if (apply && deps.dataDir === ":memory:") {
      throw new HttpError(400, "内存数据库不支持落库备份，请使用磁盘数据目录", "bad_request");
    }

    let format: "v1" | "lcx";
    try {
      format = rawFormat === "auto" ? detectFormat(body.text) : rawFormat;
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err), "bad_import");
    }

    if (format === "v1") {
      let parsed;
      try {
        parsed = parseV1(body.text);
      } catch (err) {
        if (err instanceof ImportError) throw new HttpError(400, err.message, "bad_import");
        throw err;
      }

      const selected = targetAccount ? parsed.filter((p) => p.account.accountKey === targetAccount) : parsed;
      if (targetAccount && selected.length === 0) {
        throw new HttpError(404, "导入文件中不包含指定账号", "not_found");
      }

      const plans = selected.map((p) => ({
        parsed: p,
        plan: planImport(deps.store, p.account, p.records, p.skipped),
      }));

      let backupFile: string | undefined;
      if (apply) {
        for (const { parsed: p, plan } of plans) {
          const res = applyImport(deps.store, deps.dataDir, p.account, plan);
          backupFile = path.basename(res.backup);
        }
      }

      return {
        plans: plans.map(({ plan }) => ({
          maskedKey: maskKey(plan.accountKey, false),
          total: plan.total,
          added: plan.newRecords.length,
          duplicates: plan.duplicates,
          conflicts: plan.conflicts.length,
          skipped: plan.skipped.length,
        })),
        warnings: [],
        unresolvedPools: [],
        applied: apply,
        ...(backupFile ? { backup: backupFile } : {}),
      };
    }

    // format === "lcx"
    let account: AccountRow;
    let createdAccount = false;
    if (targetAccount) {
      const found = deps.store.getAccount(targetAccount);
      if (!found) {
        throw new HttpError(404, "本地不存在指定账号", "not_found");
      }
      account = found;
    } else if (body.createAccount === true) {
      // 空库/无对应账号：按文件内 UID 匹配已有账号或新建（落库时才真正写入 accounts）
      try {
        const r = resolveLcxAccount(readLcxMeta(body.text), deps.store.listAccounts());
        account = r.account;
        createdAccount = !r.matched;
      } catch (err) {
        if (err instanceof ImportError) throw new HttpError(400, err.message, "bad_import");
        throw err;
      }
    } else {
      throw new HttpError(400, "离愁轩导入必须指定目标账号 account（或传 createAccount: true 按文件 UID 自动匹配/新建）", "bad_request");
    }

    let lcxRes;
    try {
      lcxRes = parseLcx(body.text, {
        localRecords: deps.store.getRecords(account.accountKey),
        poolMap,
      });
    } catch (err) {
      if (err instanceof ImportError) throw new HttpError(400, err.message, "bad_import");
      throw err;
    }

    const plan = planImport(deps.store, account, lcxRes.records, [], { allowTruncatedMs: true });
    let backupFile: string | undefined;
    if (apply) {
      const res = applyImport(deps.store, deps.dataDir, account, plan);
      backupFile = path.basename(res.backup);
    }

    const warnings = [...lcxRes.warnings];
    if (createdAccount) {
      warnings.unshift(
        "本地没有对应账号，将按离愁轩文件内的 UID 新建独立账号；之后用官方方式同步的账号会是另一个账号。如要合并到官方账号，请先同步一次官方账号，再把离愁轩文件导入到该账号。",
      );
    }
    if (plan.truncatedMsDuplicates > 0) {
      warnings.push(`其中 ${plan.truncatedMsDuplicates} 条重复记录仅毫秒位因离愁轩导出截断为 000，已按同一秒归入重复并保留本地精确记录`);
    }

    return {
      plans: [
        {
          maskedKey: maskKey(plan.accountKey, false),
          total: plan.total,
          added: plan.newRecords.length,
          duplicates: plan.duplicates,
          conflicts: plan.conflicts.length,
          skipped: plan.skipped.length,
        },
      ],
      warnings,
      unresolvedPools: lcxRes.unresolvedPools,
      applied: apply,
      createdAccount,
      ...(backupFile ? { backup: backupFile } : {}),
    };
  });

  router.post("/api/backup", async (c) => {
    await c.json();
    if (deps.dataDir === ":memory:") {
      throw new HttpError(400, "内存数据库不支持文件备份", "bad_request");
    }
    const file = createBackup(deps.store, deps.dataDir);
    return { file: path.basename(file) };
  });

  router.get("/api/backups", () => {
    const root = requireDiskDataDir(deps, "文件备份");
    return { dir: backupsDir(root), files: listBackups(root) };
  });

  /** 从 backups/ 下的备份合并恢复（先干跑预览，apply:true 才写入；写入前自动再备份一次） */
  router.post("/api/backup/restore", async (c) => {
    const body = await c.json<{ file?: unknown; apply?: unknown }>();
    const root = requireDiskDataDir(deps, "文件备份");
    if (typeof body.file !== "string" || !body.file) {
      throw new HttpError(400, "缺少备份文件名 file", "bad_request");
    }
    const apply = body.apply === true;

    let plan;
    try {
      plan = planRestore(deps.store, root, resolveBackupFile(root, body.file));
    } catch (err) {
      if (err instanceof ImportError) throw new HttpError(400, err.message, "bad_backup");
      throw err;
    }

    let backupFile: string | undefined;
    if (apply) backupFile = path.basename(applyRestore(deps.store, root, plan).backup);

    return {
      plans: plan.accounts.map(({ plan: p }) => ({
        maskedKey: maskKey(p.accountKey, false),
        total: p.total,
        added: p.newRecords.length,
        duplicates: p.duplicates,
        conflicts: p.conflicts.length,
        skipped: p.skipped.length,
      })),
      warnings: plan.accounts.length === 0 ? ["该备份中没有任何账号"] : [],
      unresolvedPools: [],
      applied: apply,
      ...(backupFile ? { backup: backupFile } : {}),
    };
  });
}
