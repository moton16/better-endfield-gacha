import path from "node:path";
import { toCsv } from "../../core/io/csv.js";
import { applyImport, createBackup, planImport } from "../../core/io/importer.js";
import { looksLikeLcx, parseLcx, type PoolMapEntry } from "../../core/io/lcx.js";
import { parseV1 } from "../../core/io/v1.js";
import { ImportError } from "../../core/io/validate.js";
import { maskKey } from "../../core/mask.js";
import { HttpError, type Router } from "../http.js";
import type { AppDeps } from "../index.js";

const IMPORT_BODY_LIMIT = 60 * 1024 * 1024;

interface ImportBody {
  text?: unknown;
  format?: unknown;
  account?: unknown;
  poolMap?: unknown;
  apply?: unknown;
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

export function register(router: Router, deps: AppDeps): void {
  router.get("/api/export", (c) => {
    const sp = c.url.searchParams;
    const format = sp.get("format") ?? "json";
    if (format !== "json" && format !== "csv") {
      throw new HttpError(400, "不支持的导出格式（可选 json|csv）", "bad_request");
    }

    const targetAccount = sp.get("account") || undefined;
    const list = targetAccount
      ? (() => {
          const acc = deps.store.getAccount(targetAccount);
          if (!acc) throw new HttpError(404, "账号不存在", "not_found");
          return [acc];
        })()
      : deps.store.listAccounts();

    const rawGifts = sp.get("includeGifts");
    if (format === "csv") {
      const includeGifts = rawGifts === "1" || rawGifts === "true";
      const records = list.flatMap((a) => deps.store.getRecords(a.accountKey));
      const csv = toCsv(records, { includeGifts });
      c.res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="beg-export.csv"',
        "Content-Length": Buffer.byteLength(csv, "utf8"),
      });
      c.res.end(csv);
      return undefined;
    }

    const includeGiftsJson = rawGifts !== "0" && rawGifts !== "false";
    const doc = {
      format: "better-endfield-gacha/v1",
      exportedAt: new Date().toISOString(),
      accounts: list.map((a) => {
        const recs = deps.store.getRecords(a.accountKey);
        return {
          ...a,
          records: includeGiftsJson ? recs : recs.filter((r) => r.kind === "draw"),
        };
      }),
    };
    const text = JSON.stringify(doc, null, 2);
    c.res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="beg-export.json"',
      "Content-Length": Buffer.byteLength(text, "utf8"),
    });
    c.res.end(text);
    return undefined;
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
    if (!targetAccount) {
      throw new HttpError(400, "离愁轩导入必须指定目标账号 account", "bad_request");
    }
    const account = deps.store.getAccount(targetAccount);
    if (!account) {
      throw new HttpError(404, "本地不存在指定账号", "not_found");
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

    const plan = planImport(deps.store, account, lcxRes.records, []);
    let backupFile: string | undefined;
    if (apply) {
      const res = applyImport(deps.store, deps.dataDir, account, plan);
      backupFile = path.basename(res.backup);
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
      warnings: lcxRes.warnings,
      unresolvedPools: lcxRes.unresolvedPools,
      applied: apply,
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
}
