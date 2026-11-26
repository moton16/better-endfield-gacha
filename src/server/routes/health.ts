import { VERSION } from "../../version.js";
import type { Router } from "../http.js";
import type { AppDeps } from "../index.js";

export function register(router: Router, deps: AppDeps): void {
  router.get("/api/health", () => ({
    ok: true,
    version: deps.version || VERSION,
  }));
}
