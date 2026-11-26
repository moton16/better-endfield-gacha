import { maskKey } from "../../core/mask.js";
import type { Router } from "../http.js";
import type { AppDeps } from "../index.js";

export function register(router: Router, deps: AppDeps): void {
  router.get("/api/accounts", () => {
    return deps.store.listAccounts().map((a) => {
      const c = deps.store.countRecords(a.accountKey);
      return {
        accountKey: a.accountKey,
        maskedKey: maskKey(a.accountKey, false),
        region: a.region,
        channelName: a.channelName,
        nickname: a.nickname,
        source: a.source,
        updatedAt: a.updatedAt,
        counts: { total: c.total, draws: c.draws },
      };
    });
  });
}
