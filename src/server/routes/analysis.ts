import { HttpError, type Router } from "../http.js";
import type { AppDeps } from "../index.js";

export function register(router: Router, deps: AppDeps): void {
  router.get("/api/accounts/:key/analysis", (c) => {
    const key = c.params.key!;
    if (!deps.store.getAccount(key)) {
      throw new HttpError(404, "账号不存在", "not_found");
    }
    return deps.analysis(key);
  });
}
