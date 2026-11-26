import type { Router } from "../http.js";
import type { AppDeps } from "../index.js";
import * as accounts from "./accounts.js";
import * as analysis from "./analysis.js";
import * as cache from "./cache.js";
import * as health from "./health.js";
import * as importexport from "./importexport.js";
import * as jobs from "./jobs.js";
import * as link from "./link.js";
import * as passport from "./passport.js";
import * as records from "./records.js";
import * as sync from "./sync.js";

export function registerRoutes(router: Router, deps: AppDeps): void {
  health.register(router, deps);
  accounts.register(router, deps);
  analysis.register(router, deps);
  records.register(router, deps);
  sync.register(router, deps);
  jobs.register(router, deps);
  cache.register(router, deps);
  link.register(router, deps);
  passport.register(router, deps);
  importexport.register(router, deps);
}
