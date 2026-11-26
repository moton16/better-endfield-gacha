import type { EfRegion } from "./cache/extract.js";

export type RecordType = "char" | "weapon";

/** 角色寻访 5 类 pool_type（必须全部覆盖） */
export const CHAR_POOL_TYPES = [
  "E_CharacterGachaPoolType_Special",
  "E_CharacterGachaPoolType_Standard",
  "E_CharacterGachaPoolType_Beginner",
  "E_CharacterGachaPoolType_Joint",
  "E_CharacterGachaPoolType_Rerun",
] as const;
export type CharPoolType = (typeof CHAR_POOL_TYPES)[number];

export const CHAR_POOL_LABELS: Record<string, string> = {
  E_CharacterGachaPoolType_Special: "特许寻访",
  E_CharacterGachaPoolType_Standard: "基础寻访",
  E_CharacterGachaPoolType_Beginner: "启程寻访",
  E_CharacterGachaPoolType_Joint: "辉光庆典",
  E_CharacterGachaPoolType_Rerun: "重构寻访",
};

/** 武器池类别（由 pool_id 推断） */
export type WeaponPoolKind = "special" | "constant" | "rerun";

export interface GachaRecord {
  type: RecordType;
  /** 增量同步的分源键：`char:<pool_type>` 或 `weapon:<pool_id>` */
  feed: string;
  /** char: 官方 pool_type 枚举；weapon: special/constant/rerun */
  poolType: string;
  poolId: string;
  poolName: string;
  itemId: string;
  itemName: string;
  /** 武器类型（weaponType），角色为空串 */
  itemSubType: string;
  /** 1-based 稀有度：4/5/6 星直接对应 4/5/6 */
  rarity: number;
  isFree: boolean;
  isNew: boolean;
  /** 毫秒/秒时间戳原样字符串（服务端给什么存什么） */
  gachaTs: string;
  /** 字符串形式的游标，字符串存储避免精度丢失 */
  seqId: string;
  /** 记录类型：缺失视为 draw；`gift_*` 等非抽卡项不计入保底/抽数 */
  kind: string;
}

export interface PoolInfo {
  poolId: string;
  gachaType: string;
  poolName: string;
  poolType: string;
  up6Ids: string[];
  versionNum: string;
}

export interface RerunCount {
  poolId: string;
  poolName: string;
  totalPullCount: number;
}

/** 本地存储隔离键的各维度（严禁仅用 user_id+server_id） */
export interface AccountIdentity {
  region: EfRegion;
  /** 渠道：官服 "1"，B 服 "2"；国际服无此概念时用 "0" */
  channelMasterId: string;
  /** bindingList[].uid（路线 B）或 u8 uid（路线 A） */
  bindingUid: string;
  roleId: string;
}

export function buildAccountKey(i: AccountIdentity): string {
  const parts = [i.region, i.channelMasterId, i.bindingUid, i.roleId].map((p) => String(p ?? "").trim());
  if (parts.some((p) => !p)) throw new Error("账号键缺少维度（region/channelMasterId/bindingUid/roleId 均必填）");
  return parts.map((p) => p.replace(/[^A-Za-z0-9-]/g, "-")).join("_");
}

export interface AccountRow extends AccountIdentity {
  accountKey: string;
  nickname: string;
  serverId: string;
  serverName: string;
  channelName: string;
  /** 身份来源：cache（路线 A）/ passport（路线 B）/ import */
  source: string;
  updatedAt: number;
}

export function isDrawRecord(r: Pick<GachaRecord, "kind">): boolean {
  return r.kind === "draw";
}
