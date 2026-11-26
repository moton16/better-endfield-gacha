/**
 * 路线 B：鹰角通行证链路
 *   hytoken → POST https://as.<host>/user/oauth2/v2/grant (type=1)
 *           → GET  https://binding-api-account-prod.<host>/account/binding/v1/binding_list
 *           → POST https://binding-api-account-prod.<host>/account/binding/v1/u8_token_by_uid
 *             （必须传外层 bindingList[].uid；传 roles[].roleId 会返回 109）
 *
 * 响应的业务状态字段是 `status`（0=成功），不是 `code`。
 * 扫码登录（gen_scan/login → scan_status → token_by_scan_code）来自社区实现的协议描述，【未实测】。
 */
import { scrubUrl } from "../redact.js";

export type Provider = "hypergryph" | "gryphline";

export interface ProviderConfig {
  appCode: string;
  asHost: string;
  bindingHost: string;
  u8Host: string;
  region: "cn" | "global";
  loginUrl: string;
  /** 浏览器登录后访问该地址可看到 hytoken（`data.content`） */
  tokenUrl: string;
}

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  hypergryph: {
    appCode: "be36d44aa36bfb5b",
    asHost: "as.hypergryph.com",
    bindingHost: "binding-api-account-prod.hypergryph.com",
    u8Host: "u8.hypergryph.com",
    region: "cn",
    loginUrl: "https://user.hypergryph.com/",
    tokenUrl: "https://web-api.hypergryph.com/account/info/hg",
  },
  gryphline: {
    appCode: "3dacefa138426cfe",
    asHost: "as.gryphline.com",
    bindingHost: "binding-api-account-prod.gryphline.com",
    u8Host: "u8.gryphline.com",
    region: "global",
    loginUrl: "https://user.gryphline.com/",
    tokenUrl: "https://web-api.gryphline.com/cookie_store/account_token",
  },
};

export class PassportError extends Error {
  constructor(
    readonly stage: string,
    message: string,
    readonly status?: number | string,
  ) {
    super(scrubUrl(`[${stage}] ${message}`));
    this.name = "PassportError";
  }
}

export interface BindingRole {
  roleId: string;
  nickname: string;
  serverId: string;
  serverName: string;
  level: number;
  isDefault: boolean;
  isBanned: boolean;
}

export interface Binding {
  /** 外层绑定 uid：换 u8 token 只能用它 */
  uid: string;
  /** 官服 "1"，B 服 "2"（接口里可能是字符串或数字，统一成字符串） */
  channelMasterId: string;
  channelName: string;
  isOfficial: boolean;
  isDefault: boolean;
  isDeleted: boolean;
  isBanned: boolean;
  roles: BindingRole[];
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const s = (v: unknown) => (v == null ? "" : String(v).trim());

async function call(
  stage: string,
  f: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<any> {
  let res: Response;
  try {
    res = await f(url, {
      ...init,
      headers: { "User-Agent": UA, "Content-Type": "application/json", ...(init.headers as object) },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new PassportError(stage, `网络错误：${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new PassportError(stage, `HTTP ${res.status}`, res.status);
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new PassportError(stage, "响应不是 JSON");
  }
  const status = json?.status;
  if (status !== 0) throw new PassportError(stage, `status=${String(status)} msg=${s(json?.msg ?? json?.message)}`, status);
  return json.data;
}

/**
 * 接受三种输入：纯 hytoken；`/account/info/hg` 返回的 JSON（取 data.content）；带引号的字符串。
 * 返回 null 表示无法识别。
 */
export function parseHyTokenInput(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t);
      const c = s(j?.data?.content ?? j?.data?.token ?? j?.content);
      return c || null;
    } catch {
      return null;
    }
  }
  const bare = t.replace(/^["']|["']$/g, "").trim();
  if (!/^[A-Za-z0-9+/_\-=.%]{16,}$/.test(bare)) return null;
  try {
    return decodeURIComponent(bare);
  } catch {
    return null;
  }
}

export async function grantOAuth(hytoken: string, provider: Provider, f: typeof fetch = fetch): Promise<string> {
  const cfg = PROVIDERS[provider];
  const data = await call("grant", f, `https://${cfg.asHost}/user/oauth2/v2/grant`, {
    method: "POST",
    body: JSON.stringify({ type: 1, appCode: cfg.appCode, token: hytoken }),
  });
  const token = s(data?.token);
  if (!token) throw new PassportError("grant", "响应缺少 token");
  return token;
}

export function normalizeBindings(data: unknown): Binding[] {
  const list: any[] = Array.isArray((data as any)?.list) ? (data as any).list : [];
  const out: Binding[] = [];
  // 只取 appCode === "endfield" 的条目；不回退到 list[0]（可能是别的游戏）
  for (const app of list.filter((x) => s(x?.appCode) === "endfield")) {
    for (const b of Array.isArray(app?.bindingList) ? app.bindingList : []) {
      const uid = s(b?.uid);
      if (!uid) continue;
      const roles: BindingRole[] = (Array.isArray(b?.roles) ? b.roles : [])
        .map((r: any) => ({
          roleId: s(r?.roleId),
          nickname: s(r?.nickName ?? r?.nickname),
          serverId: s(r?.serverId),
          serverName: s(r?.serverName),
          level: Number(r?.level) || 0,
          isDefault: r?.isDefault === true,
          isBanned: r?.isBanned === true,
        }))
        .filter((r: BindingRole) => r.roleId);
      out.push({
        uid,
        channelMasterId: s(b?.channelMasterId),
        channelName: s(b?.channelName),
        isOfficial: b?.isOfficial === true,
        isDefault: b?.isDefault === true,
        isDeleted: b?.isDeleted === true,
        isBanned: b?.isBanned === true,
        roles,
      });
    }
  }
  return out;
}

export async function listBindings(oauthToken: string, provider: Provider, f: typeof fetch = fetch): Promise<Binding[]> {
  const cfg = PROVIDERS[provider];
  const q = new URLSearchParams({ token: oauthToken, appCode: "endfield" });
  const data = await call("binding_list", f, `https://${cfg.bindingHost}/account/binding/v1/binding_list?${q}`, { method: "GET" });
  return normalizeBindings(data);
}

/** 必须传外层 binding.uid（不是 roleId） */
export async function u8TokenByUid(oauthToken: string, bindingUid: string, provider: Provider, f: typeof fetch = fetch): Promise<string> {
  const cfg = PROVIDERS[provider];
  const data = await call("u8_token_by_uid", f, `https://${cfg.bindingHost}/account/binding/v1/u8_token_by_uid`, {
    method: "POST",
    body: JSON.stringify({ uid: bindingUid, token: oauthToken }),
  });
  const token = s(data?.token);
  if (!token) throw new PassportError("u8_token_by_uid", "响应缺少 token");
  return token;
}

// ---------------- 扫码登录（未实测） ----------------
const SCAN = {
  gen: "https://as.hypergryph.com/general/v1/gen_scan/login",
  status: "https://as.hypergryph.com/general/v1/scan_status",
  token: "https://as.hypergryph.com/user/auth/v1/token_by_scan_code",
};

export interface ScanSession {
  scanId: string;
  scanUrl: string;
}

export async function qrCreate(f: typeof fetch = fetch): Promise<ScanSession> {
  const data = await call("gen_scan", f, SCAN.gen, { method: "POST", body: "{}" });
  const scanId = s(data?.scanId);
  if (!scanId) throw new PassportError("gen_scan", "响应缺少 scanId");
  return { scanId, scanUrl: s(data?.scanUrl) };
}

/** 未扫码/未确认时服务端返回非 0 状态，属于正常轮询，返回 null */
export async function qrPoll(scanId: string, f: typeof fetch = fetch): Promise<string | null> {
  let res: Response;
  try {
    res = await f(`${SCAN.status}?scanId=${encodeURIComponent(scanId)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json: any = await res.json().catch(() => null);
  if (json?.status !== 0) return null;
  return s(json?.data?.scanCode) || null;
}

export async function qrExchange(scanCode: string, f: typeof fetch = fetch): Promise<string> {
  const data = await call("token_by_scan_code", f, SCAN.token, { method: "POST", body: JSON.stringify({ scanCode }) });
  const token = s(data?.token);
  if (!token) throw new PassportError("token_by_scan_code", "响应缺少 token");
  return token;
}

export async function qrWait(
  session: ScanSession,
  opts: { f?: typeof fetch; timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string> {
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const intervalMs = opts.intervalMs ?? 2000;
  const start = Date.now();
  let waited = 0;
  while (Math.max(Date.now() - start, waited) < timeoutMs) {
    const code = await qrPoll(session.scanId, opts.f);
    if (code) return qrExchange(code, opts.f);
    await sleep(intervalMs);
    waited += intervalMs;
  }
  throw new PassportError("scan_status", "扫码超时");
}
