import { spawnSync } from "node:child_process";
import { buildGachaLink, pickBestCredential } from "../../core/cache/extract.js";
import { redact } from "../../core/redact.js";
import { NoCredentialError, scanCaches } from "../../core/route-a.js";
import { HttpError, type Router } from "../http.js";
import type { AppDeps } from "../index.js";

interface LinkBody {
  page?: unknown;
  channel?: unknown;
  copy?: unknown;
  reveal?: unknown;
}

export function register(router: Router, deps: AppDeps): void {
  router.post("/api/link", async (c) => {
    const body = await c.json<LinkBody>();
    let page: "gacha_char" | "gacha_weapon" = "gacha_char";
    if (body.page !== undefined) {
      if (body.page !== "char" && body.page !== "weapon") {
        throw new HttpError(400, "page 仅支持 char 或 weapon", "bad_request");
      }
      page = body.page === "weapon" ? "gacha_weapon" : "gacha_char";
    }

    let channel: string | undefined;
    if (body.channel !== undefined && body.channel !== "") {
      if (body.channel !== "1" && body.channel !== "2") {
        throw new HttpError(400, "channel 仅支持 1 或 2", "bad_request");
      }
      channel = body.channel;
    }

    const scanRes = scanCaches(deps.cacheDiscover);
    const cred = pickBestCredential(scanRes.credentials, channel ? { channel } : {});
    if (!cred) {
      throw new HttpError(404, new NoCredentialError(scanRes).message, "no_credential");
    }

    const gachaLink = buildGachaLink(cred, page);
    const masked = gachaLink.replace(/(u8_token=)[^&]+/, `$1${redact(cred.token)}`);

    let copied: boolean | undefined;
    if (body.copy === true) {
      const r = spawnSync("clip", { input: gachaLink, encoding: "utf8" });
      copied = r.status === 0;
    }

    return {
      masked,
      ...(copied !== undefined ? { copied } : {}),
      ...(body.reveal === true ? { link: gachaLink } : {}),
    };
  });
}
