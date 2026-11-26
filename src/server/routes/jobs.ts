import { HttpError, type Router } from "../http.js";
import type { AppDeps } from "../index.js";

export function register(router: Router, deps: AppDeps): void {
  router.get("/api/jobs/:id", (c) => {
    const job = deps.jobs.get(c.params.id!);
    if (!job) {
      throw new HttpError(404, "任务不存在", "not_found");
    }
    return job;
  });
}
