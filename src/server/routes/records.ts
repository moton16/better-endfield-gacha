import type { RecordType } from "../../core/types.js";
import { HttpError, type Router } from "../http.js";
import type { AppDeps } from "../index.js";

export function register(router: Router, deps: AppDeps): void {
  router.get("/api/accounts/:key/records", (c) => {
    const key = c.params.key!;
    if (!deps.store.getAccount(key)) {
      throw new HttpError(404, "账号不存在", "not_found");
    }

    const sp = c.url.searchParams;
    const feed = sp.get("feed") || undefined;
    const rawType = sp.get("type") || undefined;
    let type: RecordType | undefined;
    if (rawType !== undefined) {
      if (rawType !== "char" && rawType !== "weapon") {
        throw new HttpError(400, "无效的 type 参数（仅支持 char|weapon）", "bad_request");
      }
      type = rawType;
    }

    let limit = 200;
    const rawLimit = sp.get("limit");
    if (rawLimit !== null && rawLimit !== "") {
      const n = Number(rawLimit);
      if (!Number.isInteger(n) || n <= 0) {
        throw new HttpError(400, "limit 必须是正整数", "bad_request");
      }
      limit = Math.min(1000, n);
    }

    let offset = 0;
    const rawOffset = sp.get("offset");
    if (rawOffset !== null && rawOffset !== "") {
      const n = Number(rawOffset);
      if (!Number.isInteger(n) || n < 0) {
        throw new HttpError(400, "offset 必须是非负整数", "bad_request");
      }
      offset = n;
    }

    const rawOrder = sp.get("order");
    let order: "asc" | "desc" = "asc";
    if (rawOrder !== null && rawOrder !== "") {
      if (rawOrder !== "asc" && rawOrder !== "desc") {
        throw new HttpError(400, "order 仅支持 asc|desc", "bad_request");
      }
      order = rawOrder;
    }

    const total = deps.store.countRecordsFiltered(key, { type, feed });
    const items = deps.store.getRecordsPaged(key, { type, feed, limit, offset, order });
    return { total, items };
  });
}
