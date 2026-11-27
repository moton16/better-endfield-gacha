import type { EfRegion } from "../cache/extract.js";
import { scrubUrl } from "../redact.js";

export interface RoleInfo {
  uid: string;
  roleId: string;
  nickname: string;
  serverId: string;
  serverName: string;
}

export const U8_HOSTS: Record<EfRegion, string> = {
  cn: "u8.hypergryph.com",
  global: "u8.gryphline.com",
};

export class RoleQueryError extends Error {
  readonly status?: number | string;

  constructor(message: string, status?: number | string) {
    super(message);
    this.name = "RoleQueryError";
    this.status = status;
  }

  /** 是否表示该渠道下尚无角色（U8 query_role_list status=101）。 */
  get isNoRole(): boolean {
    return this.status === 101 || String(this.status) === "101";
  }
}

/**
 * 用 u8_token 反查 uid + 角色（路线 A 用来确定账号隔离键）。
 * 社区实现已使用该接口（POST /game/role/v1/query_role_list）。
 * ⚠️ 其返回的 `uid` 是否与路线 B `bindingList[].uid` 同值：【未实测】，见 docs/DEVELOPER.md。
 */
export async function queryRoleList(
  token: string,
  region: EfRegion,
  serverId: string,
  doFetch: typeof fetch = fetch,
): Promise<RoleInfo> {
  const url = `https://${U8_HOSTS[region]}/game/role/v1/query_role_list`;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({ token, serverId }),
    });
  } catch (err) {
    throw new RoleQueryError(scrubUrl(`query_role_list 网络错误：${err instanceof Error ? err.message : String(err)}`));
  }
  if (!res.ok) throw new RoleQueryError(`query_role_list HTTP ${res.status}`);
  const json: any = await res.json();
  if (json?.status !== 0) {
    const status = json?.status;
    const msg = String(json?.msg ?? "");
    if (status === 101 || String(status) === "101") {
      throw new RoleQueryError(`该渠道下暂无角色（status=101${msg ? ` ${msg}` : ""}）`, status);
    }
    throw new RoleQueryError(`query_role_list 返回异常 status=${String(status)} msg=${msg}`, status);
  }
  const uid = String(json?.data?.uid ?? "").trim();
  const roles: any[] = Array.isArray(json?.data?.roles) ? json.data.roles : [];
  const role = roles.find((r) => String(r?.serverId ?? "") === serverId) ?? roles[0];
  const roleId = String(role?.roleId ?? "").trim();
  if (!uid) throw new RoleQueryError("query_role_list 解析失败：缺少 uid");
  if (!roleId) throw new RoleQueryError("query_role_list 解析失败：缺少 roleId");
  return {
    uid,
    roleId,
    nickname: String(role?.nickname ?? role?.nickName ?? "").trim(),
    serverId: String(role?.serverId ?? serverId),
    serverName: String(role?.serverName ?? "").trim(),
  };
}
