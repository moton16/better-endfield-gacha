import { PassportError, parseHyTokenInput, type Provider } from "../../core/auth/passport.js";
import { Vault } from "../../core/auth/vault.js";
import { fingerprint } from "../../core/redact.js";
import { inspectPassport } from "../../core/route-b.js";
import { HttpError, type Router } from "../http.js";
import type { AppDeps } from "../index.js";

interface InspectBody {
  input?: unknown;
  provider?: unknown;
  save?: unknown;
}

export function register(router: Router, deps: AppDeps): void {
  router.post("/api/passport/inspect", async (c) => {
    const body = await c.json<InspectBody>();
    if (typeof body.input !== "string" || !body.input.trim()) {
      throw new HttpError(400, "请提供通行证 token 或 JSON 内容", "bad_request");
    }
    let provider: Provider = "hypergryph";
    if (body.provider !== undefined && body.provider !== "") {
      if (body.provider !== "hypergryph" && body.provider !== "gryphline") {
        throw new HttpError(400, "provider 仅支持 hypergryph 或 gryphline", "bad_request");
      }
      provider = body.provider;
    }

    const token = parseHyTokenInput(body.input);
    if (!token) {
      throw new HttpError(400, "无法识别通行证 token（请粘贴 hytoken 或 /account/info/hg 的 JSON）", "bad_token");
    }

    let rawBindings;
    try {
      rawBindings = await inspectPassport(token, provider, deps.fetch);
    } catch (err) {
      if (err instanceof PassportError) {
        const status = err.status === undefined ? 502 : 400;
        throw new HttpError(status, err.message, "passport_error");
      }
      throw err;
    }

    const bindings = rawBindings
      .filter((b) => !b.isDeleted)
      .map((b) => ({
        channelName: b.channelName,
        channelMasterId: b.channelMasterId,
        roleCount: b.roles.length,
        isDefault: b.isDefault,
        uidFingerprint: fingerprint(b.uid),
      }));

    if (body.save === true) {
      if (deps.dataDir === ":memory:") {
        throw new HttpError(400, "内存模式不支持保存通行证保险库", "bad_request");
      }
      const vaultId = fingerprint(token);
      new Vault(deps.dataDir).save(vaultId, provider, token);
      return { bindings, vaultId };
    }

    return { bindings };
  });

  router.get("/api/passport/vault", () => {
    if (deps.dataDir === ":memory:") return [];
    return new Vault(deps.dataDir).list().map(({ id, provider, createdAt }) => ({
      id,
      provider,
      createdAt,
    }));
  });

  router.delete("/api/passport/vault", () => {
    if (deps.dataDir === ":memory:") return { cleared: 0 };
    const cleared = new Vault(deps.dataDir).clear();
    return { cleared };
  });
}
