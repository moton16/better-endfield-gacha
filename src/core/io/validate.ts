import type { GachaRecord } from "../types.js";

export const LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxRecordsPerAccount: 200_000,
  maxAccounts: 50,
  maxStr: 256,
} as const;

export class ImportError extends Error {
  constructor(message: string, readonly path = "") {
    super(path ? `${message}（${path}）` : message);
    this.name = "ImportError";
  }
}

const FEED_RE = /^(?:char:E_CharacterGachaPoolType_[A-Za-z0-9]+|weapon:[A-Za-z0-9_\-]+)$/;
const DIGITS = /^\d{1,24}$/;

function str(v: unknown, path: string, opts: { allowEmpty?: boolean } = {}): string {
  if (typeof v !== "string") throw new ImportError("应为字符串", path);
  if (v.length > LIMITS.maxStr) throw new ImportError("字符串过长", path);
  if (!opts.allowEmpty && v === "") throw new ImportError("不能为空", path);
  return v;
}

/** 返回清洗后的记录；任何字段不合规就抛 ImportError（调用方决定是整文件失败还是跳过该条） */
export function validateRecord(raw: unknown, path: string): GachaRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ImportError("记录不是对象", path);
  }
  const r = raw as Record<string, unknown>;
  const type = r.type;
  if (type !== "char" && type !== "weapon") throw new ImportError("type 只能是 char|weapon", path);
  const feed = str(r.feed, `${path}.feed`);
  if (!FEED_RE.test(feed)) throw new ImportError("feed 格式非法", path);
  if ((type === "char") !== feed.startsWith("char:")) throw new ImportError("type 与 feed 不一致", path);
  const seqId = str(r.seqId, `${path}.seqId`);
  if (!DIGITS.test(seqId)) throw new ImportError("seqId 必须是数字串", path);
  const gachaTs = str(r.gachaTs, `${path}.gachaTs`);
  if (!DIGITS.test(gachaTs)) throw new ImportError("gachaTs 必须是数字串", path);
  const kind = str(r.kind ?? "draw", `${path}.kind`);
  const isDraw = kind === "draw";
  const rarity = r.rarity;
  if (
    typeof rarity !== "number" ||
    !Number.isInteger(rarity) ||
    (isDraw ? rarity < 1 || rarity > 6 : rarity < 0 || rarity > 6)
  ) {
    throw new ImportError(isDraw ? "rarity 必须是 1..6 整数" : "非抽卡记录 rarity 必须是 0..6 整数", path);
  }
  return {
    type,
    feed,
    seqId,
    gachaTs,
    kind,
    poolType: str(r.poolType, `${path}.poolType`),
    poolId: str(r.poolId, `${path}.poolId`, { allowEmpty: true }),
    poolName: str(r.poolName ?? "", `${path}.poolName`, { allowEmpty: true }),
    itemId: str(r.itemId, `${path}.itemId`, { allowEmpty: !isDraw }),
    itemName: str(r.itemName ?? "", `${path}.itemName`, { allowEmpty: true }),
    itemSubType: str(r.itemSubType ?? "", `${path}.itemSubType`, { allowEmpty: true }),
    rarity,
    isFree: r.isFree === true,
    isNew: r.isNew === true,
  };
}
