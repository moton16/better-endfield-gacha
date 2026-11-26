import type { EfRegion } from "../cache/extract.js";
import { buildAccountKey, type AccountRow, type GachaRecord } from "../types.js";
import { ImportError, LIMITS, validateRecord } from "./validate.js";

export interface ParsedAccount {
  account: AccountRow;
  records: GachaRecord[];
  skipped: Array<{ index: number; reason: string }>;
}

function asIdField(v: unknown): string {
  if (typeof v === "string" || typeof v === "number") return String(v);
  return "";
}

export function parseV1(text: string): ParsedAccount[] {
  if (Buffer.byteLength(text, "utf8") > LIMITS.maxFileBytes) throw new ImportError("文件过大");
  const clean = text.startsWith("\uFEFF") ? text.slice(1) : text;
  let doc: unknown;
  try {
    doc = JSON.parse(clean);
  } catch {
    throw new ImportError("不是合法 JSON");
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new ImportError("JSON 根节点必须是对象");
  }
  const root = doc as Record<string, unknown>;
  if (root.format !== "better-endfield-gacha/v1") throw new ImportError("不是 better-endfield-gacha/v1 格式");
  if (!Array.isArray(root.accounts) || root.accounts.length > LIMITS.maxAccounts) {
    throw new ImportError("accounts 非法");
  }

  return root.accounts.map((rawAcc: unknown, ai: number): ParsedAccount => {
    const accPath = `accounts[${ai}]`;
    if (!rawAcc || typeof rawAcc !== "object" || Array.isArray(rawAcc)) {
      throw new ImportError("账号条目不是对象", accPath);
    }
    const a = rawAcc as Record<string, unknown>;
    if (a.region !== "cn" && a.region !== "global") {
      throw new ImportError("region 非法", accPath);
    }
    const id = {
      region: a.region as EfRegion,
      channelMasterId: asIdField(a.channelMasterId),
      bindingUid: asIdField(a.bindingUid),
      roleId: asIdField(a.roleId),
    };
    let key: string;
    try {
      key = buildAccountKey(id);
    } catch (e) {
      throw new ImportError((e as Error).message, accPath);
    }
    if (a.accountKey != null && a.accountKey !== "" && a.accountKey !== key) {
      throw new ImportError("accountKey 与身份字段不一致，已拒绝", accPath);
    }
    if (a.records !== undefined && !Array.isArray(a.records)) {
      throw new ImportError("records 必须是数组", accPath);
    }
    const recs: unknown[] = Array.isArray(a.records) ? a.records : [];
    if (recs.length > LIMITS.maxRecordsPerAccount) {
      throw new ImportError("记录条数超限", accPath);
    }

    const records: GachaRecord[] = [];
    const skipped: ParsedAccount["skipped"] = [];
    recs.forEach((r: unknown, i: number) => {
      try {
        records.push(validateRecord(r, `${accPath}.records[${i}]`));
      } catch (e) {
        skipped.push({ index: i, reason: (e as Error).message });
      }
    });

    const account: AccountRow = {
      ...id,
      accountKey: key,
      nickname: String(a.nickname ?? "").slice(0, 64),
      serverId: String(a.serverId ?? "1").slice(0, 32),
      serverName: String(a.serverName ?? "").slice(0, 64),
      channelName: String(a.channelName ?? "").slice(0, 64),
      source: "import",
      updatedAt: Date.now(),
    };
    return { account, records, skipped };
  });
}
