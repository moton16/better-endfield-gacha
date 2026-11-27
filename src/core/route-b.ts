/** 路线 B 编排：hytoken → 全部绑定 → 逐绑定换 u8_token → 反查角色 → 全池同步。 */
import { EfClient } from "./api/ef-client.js";
import { grantOAuth, listBindings, PROVIDERS, u8TokenByUid, type Binding, type Provider } from "./auth/passport.js";
import { queryRoleList, RoleQueryError } from "./auth/role.js";
import { CHANNEL_NAMES } from "./route-a.js";
import type { GachaStore } from "./storage/store.js";
import { syncAccount, type SyncReport } from "./sync/sync.js";
import { buildAccountKey, type AccountRow } from "./types.js";

export interface RouteBOptions {
  store: GachaStore;
  hytoken: string;
  provider?: Provider;
  /** 只同步指定渠道（"1" 官服 / "2" B 服） */
  channel?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (msg: string) => void;
}

export interface RouteBItem {
  binding: Pick<Binding, "channelMasterId" | "channelName" | "isDefault"> & { roleCount: number };
  account?: AccountRow;
  report?: SyncReport;
  warnings: string[];
  error?: string;
}

/** 仅登录校验：返回绑定摘要，不拉取记录 */
export async function inspectPassport(hytoken: string, provider: Provider = "hypergryph", f: typeof fetch = fetch): Promise<Binding[]> {
  const oauth = await grantOAuth(hytoken, provider, f);
  return listBindings(oauth, provider, f);
}

export async function syncFromPassport(o: RouteBOptions): Promise<RouteBItem[]> {
  const provider = o.provider ?? "hypergryph";
  const cfg = PROVIDERS[provider];
  const say = o.onProgress ?? (() => {});
  const oauth = await grantOAuth(o.hytoken, provider, o.fetch);
  const bindings = (await listBindings(oauth, provider, o.fetch)).filter(
    (b) => !b.isDeleted && (!o.channel || b.channelMasterId === o.channel),
  );
  if (bindings.length === 0) {
    throw new Error("通行证下没有可用的终末地绑定（B 服玩家请先在 user.hypergryph.com 绑定 B 服角色）");
  }

  const items: RouteBItem[] = [];
  let initialOauthUsed = false;
  // 遍历同账户下全部绑定（官服 + 多个 B 服绑定），每个绑定各自换票
  for (const b of bindings) {
    const item: RouteBItem = {
      binding: { channelMasterId: b.channelMasterId, channelName: b.channelName, isDefault: b.isDefault, roleCount: b.roles.length },
      warnings: [],
    };
    items.push(item);
    try {
      if (b.roles.length === 0) {
        const ch = b.channelName || b.channelMasterId || "未知渠道";
        say(`绑定 ${ch}：无角色，跳过`);
        item.warnings.push("该渠道下没有角色，已跳过");
        continue;
      }
      say(`绑定 ${b.channelName || b.channelMasterId}：换取 u8_token`);
      // 每次换票都重新 grant 一次，避免 oauth token 被复用导致的短时失效
      const freshOauth = !initialOauthUsed ? oauth : await grantOAuth(o.hytoken, provider, o.fetch);
      initialOauthUsed = true;
      const u8 = await u8TokenByUid(freshOauth, b.uid, provider, o.fetch); // 外层 binding.uid，绝不是 roleId

      const serverId = cfg.region === "cn" ? "1" : (b.roles[0]?.serverId ?? "");
      let roleId = "";
      let nickname = "";
      let serverName = "";
      try {
        const role = await queryRoleList(u8, cfg.region, serverId, o.fetch);
        roleId = role.roleId;
        nickname = role.nickname;
        serverName = role.serverName;
        if (role.uid !== b.uid) {
          item.warnings.push("query_role_list.uid 与 binding.uid 不一致（路线 A/B 对同一角色会产生两个账号键）");
        }
      } catch (err) {
        const fallback = b.roles.find((r) => r.serverId === serverId) ?? b.roles[0];
        if (!fallback) {
          if (err instanceof RoleQueryError && err.isNoRole) {
            item.warnings.push("该渠道下没有角色，已跳过");
            continue;
          }
          throw err;
        }
        roleId = fallback.roleId;
        nickname = fallback.nickname;
        serverName = fallback.serverName;
        item.warnings.push("反查角色失败，回退使用绑定列表中的首个角色");
      }
      if (b.roles.length > 1) {
        item.warnings.push(`该绑定下有 ${b.roles.length} 个角色；u8_token 只对应当前默认角色（${roleId ? "已按反查结果归属" : "?"}）`);
      }

      const channelMasterId = b.channelMasterId || (cfg.region === "global" ? "0" : "unknown");
      const account: AccountRow = {
        region: cfg.region,
        channelMasterId,
        bindingUid: b.uid,
        roleId,
        accountKey: buildAccountKey({ region: cfg.region, channelMasterId, bindingUid: b.uid, roleId }),
        nickname,
        serverId: serverId || "1",
        serverName,
        channelName: b.channelName || CHANNEL_NAMES[channelMasterId] || "",
        source: "passport",
        updatedAt: Date.now(),
      };
      o.store.upsertAccount(account);
      item.account = account;

      const client = new EfClient({ token: u8, region: cfg.region, serverId: account.serverId, fetch: o.fetch, sleep: o.sleep });
      item.report = await syncAccount(client, o.store, account.accountKey, { onProgress: o.onProgress });
    } catch (err) {
      item.error = err instanceof Error ? err.message : String(err);
    }
  }
  return items;
}
