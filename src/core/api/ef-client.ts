import type { EfRegion } from "../cache/extract.js";
import { scrubUrl } from "../redact.js";
import { normalizePoolContent, normalizeRerunCounts } from "./normalize.js";
import type { PoolInfo, RecordType, RerunCount } from "../types.js";

export const EF_HOSTS: Record<EfRegion, string> = {
  cn: "ef-webview.hypergryph.com",
  global: "ef-webview.gryphline.com",
};

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export class EfApiError extends Error {
  constructor(
    message: string,
    readonly endpoint: string,
    readonly code?: number | string,
    readonly httpStatus?: number,
  ) {
    super(scrubUrl(message));
    this.name = "EfApiError";
  }
}

export interface EfClientOptions {
  /** 已 URL 解码的 u8_token */
  token: string;
  region: EfRegion;
  /** 国服（官服+B 服）恒为 "1"，传入值会被忽略；国际服必填（"2"/"3"） */
  serverId?: string;
  lang?: string;
  fetch?: typeof fetch;
  userAgent?: string;
  maxRetries?: number;
  /** 注入以便测试；默认真实 sleep */
  sleep?: (ms: number) => Promise<void>;
  /** 分页之间的随机延迟范围 */
  pageDelayMs?: readonly [number, number];
}

export interface RawPage {
  list: Array<Record<string, unknown>>;
  hasMore: boolean;
}

export interface WeaponPoolItem {
  poolId: string;
  poolName: string;
  poolType: string;
  online?: boolean;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class EfClient {
  readonly region: EfRegion;
  readonly serverId: string;
  private readonly token: string;
  private readonly lang: string;
  private readonly doFetch: typeof fetch;
  private readonly ua: string;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly delay: readonly [number, number];

  constructor(o: EfClientOptions) {
    this.region = o.region;
    if (o.region === "cn") {
      // 官服与 B 服的 role.serverId 都是 "1"，webview 的 server_id 亦恒为 "1"
      this.serverId = "1";
    } else {
      if (!o.serverId) throw new Error("国际服必须提供 serverId（\"2\"/\"3\"）");
      this.serverId = o.serverId;
    }
    this.token = o.token;
    this.lang = o.lang ?? "zh-cn";
    this.doFetch = o.fetch ?? fetch;
    this.ua = o.userAgent ?? DEFAULT_UA;
    this.retries = o.maxRetries ?? 3;
    this.sleep = o.sleep ?? realSleep;
    this.delay = o.pageDelayMs ?? [250, 500];
  }

  get host(): string {
    return EF_HOSTS[this.region];
  }

  async pageDelay(): Promise<void> {
    const [lo, hi] = this.delay;
    if (hi <= 0) return;
    await this.sleep(lo + Math.random() * (hi - lo));
  }

  private async getJson(endpoint: string, params: Record<string, string> = {}, withToken = true): Promise<any> {
    const q = new URLSearchParams({ lang: this.lang, server_id: this.serverId });
    if (withToken) q.set("token", this.token);
    for (const [k, v] of Object.entries(params)) q.set(k, v);
    const url = `https://${this.host}${endpoint}?${q.toString()}`;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const res = await this.doFetch(url, { method: "GET", headers: { "User-Agent": this.ua, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new EfApiError(`HTTP ${res.status}`, endpoint, undefined, res.status);
        const json: any = await res.json();
        if (json?.code !== 0) {
          throw new EfApiError(`接口返回 code=${String(json?.code)} msg=${String(json?.msg ?? "")}`, endpoint, json?.code);
        }
        return json.data;
      } catch (err) {
        lastErr = err;
        // 鉴权类错误无需重试
        if (err instanceof EfApiError && err.code !== undefined) break;
        if (attempt < this.retries) await this.sleep(500 * attempt);
      }
    }
    if (lastErr instanceof EfApiError) throw lastErr;
    throw new EfApiError(lastErr instanceof Error ? lastErr.message : String(lastErr), endpoint);
  }

  /** /api/record/char/meta → tabs[].poolType（去重保序） */
  async charPoolTypes(): Promise<string[]> {
    const data = await this.getJson("/api/record/char/meta");
    const tabs = Array.isArray(data?.tabs) ? data.tabs : [];
    const out: string[] = [];
    for (const t of tabs) {
      const pt = typeof t?.poolType === "string" ? t.poolType.trim() : "";
      if (pt && !out.includes(pt)) out.push(pt);
    }
    return out;
  }

  async charPage(poolType: string, seqId?: string): Promise<RawPage> {
    const params: Record<string, string> = { pool_type: poolType };
    if (seqId) params.seq_id = seqId;
    return this.page("/api/record/char", params);
  }

  async weaponPools(): Promise<WeaponPoolItem[]> {
    const data = await this.getJson("/api/record/weapon/pool");
    if (!Array.isArray(data)) throw new EfApiError("武器池列表格式异常", "/api/record/weapon/pool");
    return data
      .map((p: any) => ({
        poolId: String(p?.poolId ?? "").trim(),
        poolName: String(p?.poolName ?? "").trim(),
        poolType: String(p?.poolType ?? "").trim(),
        online: typeof p?.online === "boolean" ? p.online : undefined,
      }))
      .filter((p) => p.poolId);
  }

  async weaponPage(sel: { poolId?: string; poolIds?: string[] }, seqId?: string): Promise<RawPage> {
    const params: Record<string, string> = {};
    if (sel.poolIds?.length) params.pool_ids = sel.poolIds.join(",");
    else if (sel.poolId) params.pool_id = sel.poolId;
    if (seqId) params.seq_id = seqId;
    return this.page("/api/record/weapon", params);
  }

  private async page(endpoint: string, params: Record<string, string>): Promise<RawPage> {
    const data = await this.getJson(endpoint, params);
    if (!data || !Array.isArray(data.list)) throw new EfApiError("分页响应缺少 list", endpoint);
    return { list: data.list, hasMore: !!data.hasMore };
  }

  async rerunCounts(type: RecordType): Promise<RerunCount[]> {
    const data = await this.getJson(`/api/record/${type}/rerun-counts`);
    return normalizeRerunCounts(data);
  }

  /** /api/content：卡池静态信息（UP 角色、版本号）；失败返回 null，由上层回退到内置 UP 映射表 */
  async poolContent(poolId: string): Promise<PoolInfo | null> {
    try {
      const data = await this.getJson("/api/content", { pool_id: poolId });
      return normalizePoolContent(poolId, data);
    } catch {
      return null;
    }
  }
}
