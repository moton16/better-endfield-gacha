/** 路线 A 编排：持久化 u8_token 优先复用 → 缓存扫描 → 反查账号 → 全池同步。 */
import { EfApiError, EfClient } from "./api/ef-client.js";
import type { SecretCrypto } from "./auth/dpapi.js";
import { queryRoleList, RoleQueryError } from "./auth/role.js";
import { U8Store } from "./auth/u8-store.js";
import { discoverCacheLocations, type DiscoverOptions } from "./cache/locations.js";
import { pickBestCredential, scanLocations, type CachedCredential, type PickFilter, type ScanResult } from "./cache/extract.js";
import { redact, scrubUrl } from "./redact.js";
import { syncAccount, type SyncReport } from "./sync/sync.js";
import type { GachaStore } from "./storage/store.js";
import { buildAccountKey, type AccountRow } from "./types.js";

export const CHANNEL_NAMES: Record<string, string> = { "1": "官服", "2": "bilibili服" };

export function scanCaches(opts: DiscoverOptions = {}): ScanResult {
  return scanLocations(discoverCacheLocations(opts));
}

export interface RouteAOptions extends DiscoverOptions {
  store: GachaStore;
  dataDir?: string;
  crypto?: SecretCrypto;
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

export class CredentialExpiredError extends Error {
  readonly code = 40100;
  readonly scan?: ScanResult;

  constructor(scan?: ScanResult, message?: string) {
    super(
      message ??
        "抽卡凭据已过期（40100），且游戏缓存中暂无更新的有效凭据。请在游戏内重新打开一次「寻访详情 → 寻访记录」（角色/武器页均可）刷新缓存后重试；也可改用「路线 B（鹰角通行证扫码）」同步。",
    );
    this.name = "CredentialExpiredError";
    this.scan = scan;
  }
}

function isAuthExpiredError(err: unknown): boolean {
  if (err instanceof EfApiError) {
    return err.code === 40100 || err.code === "40100";
  }
  if (err instanceof RoleQueryError) {
    return err.status !== undefined && !err.isNoRole;
  }
  return false;
}

async function executeRouteASync(cred: CachedCredential, o: RouteAOptions): Promise<RouteAResult> {
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

export async function syncFromCache(o: RouteAOptions): Promise<RouteAResult> {
  const u8Store = o.dataDir ? new U8Store(o.dataDir, o.crypto) : null;
  let expiredToken: string | undefined;
  let cameFromExpired = false;

  if (u8Store?.isAvailable) {
    const persisted = u8Store.pick(o.filter);
    if (persisted) {
      o.onProgress?.(`复用本地保存的抽卡凭据 ${persisted.tokenFingerprint}`);
      const persistedCred: CachedCredential = {
        ...persisted,
        source: { dir: u8Store.filePath, backend: "blockfile", origin: "custom" },
        warnings: [],
      };
      try {
        const res = await executeRouteASync(persistedCred, o);
        try {
          u8Store.touch(persisted.id);
        } catch {
          // 刷新验证时间失败不影响本次同步
        }
        return res;
      } catch (err) {
        if (!isAuthExpiredError(err)) throw err;
        expiredToken = persisted.token;
        cameFromExpired = true;
        try {
          u8Store.remove(persisted.id);
        } catch {
          // ignore
        }
        o.onProgress?.("本地保存凭据已过期（40100），正在回源重扫游戏缓存…");
      }
    }
  }

  const scan = scanCaches(o);
  const candidates = expiredToken ? scan.credentials.filter((c) => c.token !== expiredToken) : scan.credentials;
  const cred = pickBestCredential(candidates, o.filter);
  if (!cred) {
    if (cameFromExpired) throw new CredentialExpiredError(scan);
    throw new NoCredentialError(scan);
  }

  o.onProgress?.(`使用缓存凭据 ${cred.tokenFingerprint}（${cred.source.origin}）`);
  try {
    const res = await executeRouteASync(cred, o);
    if (u8Store?.isAvailable) {
      try {
        u8Store.save(cred);
      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        const safeMsg = scrubUrl(rawMsg).split(cred.token).join(redact(cred.token));
        o.onProgress?.(`保存本地抽卡凭据失败（不影响同步结果）：${safeMsg}`);
      }
    }
    return res;
  } catch (err) {
    if (isAuthExpiredError(err)) {
      throw new CredentialExpiredError(scan);
    }
    throw err;
  }
}
