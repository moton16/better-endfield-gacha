import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { analyzeAccount } from "../core/analysis/index.js";
import type { DiscoverOptions } from "../core/cache/locations.js";
import { GachaStore } from "../core/storage/store.js";
import { VERSION } from "../version.js";
import { HttpError, readBody, Router, sendJson, type Ctx } from "./http.js";
import { JobManager } from "./jobs.js";
import { registerRoutes } from "./routes/index.js";
import { applySecurityHeaders, checkApi, checkHost, newKey } from "./security.js";
import { serveStatic } from "./static.js";
import { resolveWebDir } from "./web-dir.js";

export interface AppDeps {
  store: GachaStore;
  dataDir: string;
  jobs: JobManager;
  /** 注入以便测试：默认指向 core/analysis 的 analyzeAccount */
  analysis: (accountKey: string) => unknown;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  cacheDiscover?: DiscoverOptions;
  /** 注入以便测试：默认在系统文件管理器中打开目录 */
  openFolder?: (dir: string) => void;
  version: string;
}

export interface AppOptions {
  dataDir: string;
  port?: number;
  webDir?: string;
  deps?: Partial<AppDeps>;
  key?: string;
}

export function createApp(o: AppOptions) {
  const key = o.key ?? newKey();
  const store = o.deps?.store ?? GachaStore.open(o.dataDir);
  const deps: AppDeps = {
    store,
    dataDir: o.dataDir,
    jobs: o.deps?.jobs ?? new JobManager(),
    fetch: o.deps?.fetch,
    sleep: o.deps?.sleep,
    cacheDiscover: o.deps?.cacheDiscover,
    openFolder: o.deps?.openFolder,
    version: o.deps?.version ?? VERSION,
    analysis:
      o.deps?.analysis ??
      ((accountKey: string) =>
        analyzeAccount({
          accountKey,
          records: store.getRecords(accountKey),
          pools: store.getAllPools(),
          rerunChar: store.getRerunCounts(accountKey, "char"),
          rerunWeapon: store.getRerunCounts(accountKey, "weapon"),
          dataDir: o.dataDir,
        })),
  };

  const router = new Router();
  registerRoutes(router, deps);
  const webDir = o.webDir ? path.resolve(o.webDir) : resolveWebDir();
  let port = 0;

  const server = http.createServer(async (req, res) => {
    try {
      const actualPort = port || (server.address() as AddressInfo | null)?.port || 0;
      checkHost(req, actualPort);
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${actualPort}`);
      const isApi = url.pathname.startsWith("/api/");
      applySecurityHeaders(res, isApi);

      if (!isApi) {
        if (req.method !== "GET" && req.method !== "HEAD") {
          throw new HttpError(405, "Method Not Allowed", "method_not_allowed");
        }
        if (!serveStatic(webDir, url.pathname, res, req.method)) {
          throw new HttpError(404, "Not Found", "not_found");
        }
        return;
      }

      checkApi(req, key, actualPort);
      const m = router.match(req.method ?? "GET", url.pathname);
      if (!m) throw new HttpError(404, "未知接口", "not_found");

      const ctx: Ctx = {
        req,
        res,
        url,
        params: m.params,
        async json<T>(limit = 64 * 1024): Promise<T> {
          const buf = await readBody(req, limit);
          if (buf.length === 0) return {} as T;
          let parsed: unknown;
          try {
            parsed = JSON.parse(buf.toString("utf8"));
          } catch {
            throw new HttpError(400, "JSON 解析失败", "bad_json");
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new HttpError(400, "请求体必须是 JSON 对象", "bad_json");
          }
          return parsed as T;
        },
      };

      const out = await m.handler(ctx);
      if (!res.writableEnded && out !== undefined) {
        sendJson(res, 200, out);
      }
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (e instanceof HttpError) {
        sendJson(res, e.status, { error: e.code, message: e.message });
      } else {
        sendJson(res, 500, { error: "internal", message: "服务器内部错误" });
      }
    }
  });

  server.headersTimeout = 10_000;
  server.requestTimeout = 120_000;

  return {
    key,
    server,
    async listen(): Promise<string> {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(o.port ?? 0, "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      port = (server.address() as AddressInfo).port;
      return `http://127.0.0.1:${port}/#k=${key}`;
    },
    get port() {
      return port;
    },
    async close(): Promise<void> {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (!o.deps?.store) store.close();
    },
  };
}
