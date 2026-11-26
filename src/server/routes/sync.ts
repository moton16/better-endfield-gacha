import { Vault } from "../../core/auth/vault.js";
import { maskKey } from "../../core/mask.js";
import { scrubUrl } from "../../core/redact.js";
import { CHANNEL_NAMES, syncFromCache } from "../../core/route-a.js";
import { syncFromPassport } from "../../core/route-b.js";
import type { Router } from "../http.js";
import { HttpError } from "../http.js";
import type { AppDeps } from "../index.js";

export interface SyncSummaryItem {
  channelName: string;
  maskedKey: string;
  ok: boolean;
  feeds: Array<{
    label: string;
    fetched: number;
    added: number;
    status: "ok" | "skipped" | "error";
    error?: string;
  }>;
  warnings: string[];
  error?: string;
}

export interface SyncSummary {
  items: SyncSummaryItem[];
}

interface SyncBody {
  mode?: unknown;
  channel?: unknown;
  vaultId?: unknown;
}

export function register(router: Router, deps: AppDeps): void {
  router.post("/api/sync", async (c) => {
    const body = await c.json<SyncBody>();
    if (body.mode !== "cache" && body.mode !== "passport") {
      throw new HttpError(400, "mode 必须是 cache 或 passport", "bad_request");
    }
    let channel: string | undefined;
    if (body.channel !== undefined && body.channel !== "") {
      if (body.channel !== "1" && body.channel !== "2") {
        throw new HttpError(400, "channel 仅支持 1（官服）或 2（B服）", "bad_request");
      }
      channel = body.channel;
    }
    let vaultId: string | undefined;
    if (body.vaultId !== undefined && body.vaultId !== "") {
      if (typeof body.vaultId !== "string") {
        throw new HttpError(400, "vaultId 必须是字符串", "bad_request");
      }
      vaultId = body.vaultId;
    }

    if (deps.jobs.hasRunning("sync")) {
      throw new HttpError(409, "已有同步任务正在运行", "conflict");
    }

    const mode = body.mode;
    if (mode === "passport") {
      const metas = new Vault(deps.dataDir).list();
      if (vaultId) {
        if (!metas.some((m) => m.id === vaultId)) {
          throw new HttpError(404, `未找到 vaultId=${vaultId} 的通行证会话`, "not_found");
        }
      } else if (metas.length === 0) {
        throw new HttpError(400, "本地尚未保存通行证会话，请先登录并保存", "no_vault");
      }
    }

    const job = deps.jobs.start("sync", async (log): Promise<SyncSummary> => {
      if (mode === "cache") {
        const res = await syncFromCache({
          store: deps.store,
          ...deps.cacheDiscover,
          filter: channel ? { channel } : {},
          fetch: deps.fetch,
          sleep: deps.sleep,
          onProgress: log,
        });
        return {
          items: [
            {
              channelName: res.account.channelName || CHANNEL_NAMES[res.account.channelMasterId] || "",
              maskedKey: maskKey(res.account.accountKey, false),
              ok: res.report.ok,
              feeds: res.report.feeds.map((f) => ({
                label: f.label,
                fetched: f.fetched,
                added: f.added,
                status: f.status,
                ...(f.error ? { error: scrubUrl(f.error) } : {}),
              })),
              warnings: res.report.warnings.map((w) => scrubUrl(w)),
            },
          ],
        };
      }

      const vault = new Vault(deps.dataDir);
      const metas = vault.list().filter((m) => !vaultId || m.id === vaultId);
      const summaryItems: SyncSummaryItem[] = [];
      for (const m of metas) {
        const entry = vault.load(m.id);
        if (!entry) continue;
        const items = await syncFromPassport({
          store: deps.store,
          hytoken: entry.token,
          provider: entry.provider,
          channel,
          fetch: deps.fetch,
          sleep: deps.sleep,
          onProgress: log,
        });
        for (const it of items) {
          summaryItems.push({
            channelName: it.account?.channelName || it.binding.channelName || CHANNEL_NAMES[it.binding.channelMasterId] || "",
            maskedKey: it.account ? maskKey(it.account.accountKey, false) : `cn_${it.binding.channelMasterId || "?"}_#unknown`,
            ok: Boolean(!it.error && it.report?.ok),
            feeds: (it.report?.feeds ?? []).map((f) => ({
              label: f.label,
              fetched: f.fetched,
              added: f.added,
              status: f.status,
              ...(f.error ? { error: scrubUrl(f.error) } : {}),
            })),
            warnings: [...it.warnings, ...(it.report?.warnings ?? [])].map((w) => scrubUrl(w)),
            ...(it.error ? { error: scrubUrl(it.error) } : {}),
          });
        }
      }
      return { items: summaryItems };
    });

    return { jobId: job.id };
  });
}
