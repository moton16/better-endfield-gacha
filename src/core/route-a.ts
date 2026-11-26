/** 路线 A 编排：缓存 → 凭据 → 反查账号 → 全池同步。 */
import { EfClient } from "./api/ef-client.js";
import { queryRoleList } from "./auth/role.js";
import { discoverCacheLocations, type DiscoverOptions } from "./cache/locations.js";
import { pickBestCredential, scanLocations, type CachedCredential, type PickFilter, type ScanResult } from "./cache/extract.js";
import { syncAccount, type SyncReport } from "./sync/sync.js";
import type { GachaStore } from "./storage/store.js";
import { buildAccountKey, type AccountRow } from "./types.js";

export const CHANNEL_NAMES: Record<string, string> = { "1": "官服", "2": "bilibili服" };

export function scanCaches(opts: DiscoverOptions = {}): ScanResult {
  return scanLocations(discoverCacheLocations(opts));
}

export interface RouteAOptions extends DiscoverOptions {
  store: GachaStore;
  filter?: PickFilter;
  fetch?: typeof fetch;
  onProgress?: (msg: string) => void;
  /** 注入 sleep 便于测试 */
  sleep?: (ms: number) => Promise<void>;
}

export interface RouteAResult {
  account: AccountRow;
  credential: Omit<CachedCredential, "token">;
  report: SyncReport;
}

export class NoCredentialError extends Error {
  constructor(readonly scan: ScanResult) {
    super(
      "未在缓存中找到抽卡凭据。请在游戏内打开一次「寻访详情 → 寻访记录」（角色/武器页均可），再重试；也可使用路线 B（鹰角通行证）。",
    );
    this.name = "NoCredentialError";
  }
}

export async function syncFromCache(o: RouteAOptions): Promise<RouteAResult> {
  const scan = scanCaches(o);
  const cred = pickBestCredential(scan.credentials, o.filter);
  if (!cred) throw new NoCredentialError(scan);

  o.onProgress?.(`使用缓存凭据 ${cred.tokenFingerprint}（${cred.source.origin}）`);
  const role = await queryRoleList(cred.token, cred.region, cred.serverId, o.fetch);
  const channelMasterId = cred.region === "cn" ? (cred.channel ?? "unknown") : "0";
  const account: AccountRow = {
    region: cred.region,
    channelMasterId,
    bindingUid: role.uid,
    roleId: role.roleId,
    accountKey: buildAccountKey({ region: cred.region, channelMasterId, bindingUid: role.uid, roleId: role.roleId }),
    nickname: role.nickname,
    serverId: role.serverId,
    serverName: role.serverName,
    channelName: cred.region === "cn" ? (CHANNEL_NAMES[channelMasterId] ?? "") : "国际服",
    source: "cache",
    updatedAt: Date.now(),
  };
  o.store.upsertAccount(account);

  const client = new EfClient({
    token: cred.token,
    region: cred.region,
    serverId: cred.serverId,
    lang: cred.lang,
    fetch: o.fetch,
    sleep: o.sleep,
  });
  const report = await syncAccount(client, o.store, account.accountKey, { onProgress: o.onProgress });
  const { token: _omit, ...safe } = cred;
  return { account, credential: safe, report };
}
