import { scrubUrl } from "../../core/redact.js";
import { scanCaches } from "../../core/route-a.js";
import type { Router } from "../http.js";
import type { AppDeps } from "../index.js";

export function register(router: Router, deps: AppDeps): void {
  router.get("/api/cache/scan", () => {
    const res = scanCaches(deps.cacheDiscover);
    return {
      locations: res.locations.map((l) => ({
        dir: l.dir,
        backend: l.backend,
        origin: l.origin,
      })),
      credentials: res.credentials.map((c) => ({
        fingerprint: c.tokenFingerprint,
        host: c.host,
        ...(c.channel !== undefined ? { channel: c.channel } : {}),
        ...(c.subChannel !== undefined ? { subChannel: c.subChannel } : {}),
        serverId: c.serverId,
        sortTime: c.sortTimeMs,
        paths: c.paths,
      })),
      errors: res.errors.map((e) => ({
        dir: e.dir,
        message: scrubUrl(e.message),
      })),
    };
  });
}
