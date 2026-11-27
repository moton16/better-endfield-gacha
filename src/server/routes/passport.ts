import {
  formatBindingsLabel,
  grantOAuth,
  listBindings,
  parseHyTokenInput,
  PassportError,
  qrCreate,
  qrExchange,
  qrPollStatus,
  type Binding,
  type Provider,
} from "../../core/auth/passport.js";
import { Vault } from "../../core/auth/vault.js";
import { fingerprint, scrubUrl } from "../../core/redact.js";
import { inspectPassport } from "../../core/route-b.js";
import { HttpError, type Router } from "../http.js";
import type { AppDeps } from "../index.js";

const QR_SESSION_TTL_MS = 5 * 60 * 1000;
const QR_MAX_SESSIONS = 32;
const QR_MAX_CONSECUTIVE_ERRORS = 3;

interface InspectBody {
  input?: unknown;
  provider?: unknown;
  save?: unknown;
}

interface QrCreateBody {
  provider?: unknown;
  save?: unknown;
}

interface RedactedBinding {
  channelName: string;
  channelMasterId: string;
  roleCount: number;
  isDefault: boolean;
  uidFingerprint: string;
}

interface QrConfirmedResult {
  status: "confirmed";
  vaultId?: string;
  label: string;
  bindings: RedactedBinding[];
}

interface QrErrorResult {
  status: "error";
  error: string;
}

interface QrSession {
  provider: Provider;
  save: boolean;
  createdAt: number;
  consecutiveErrors: number;
  result?: QrConfirmedResult;
  errorResult?: QrErrorResult;
  /** 防止并发轮询同时消费一次性 scanCode */
  confirmPromise?: Promise<QrConfirmedResult | QrErrorResult>;
}

function parseProviderField(raw: unknown): Provider {
  if (raw === undefined || raw === "") return "hypergryph";
  if (raw !== "hypergryph" && raw !== "gryphline") {
    throw new HttpError(400, "provider 仅支持 hypergryph 或 gryphline", "bad_request");
  }
  return raw;
}

function toPassportHttpError(err: PassportError): HttpError {
  const status = err.status === undefined || (typeof err.status === "number" && err.status >= 500) ? 502 : 400;
  return new HttpError(status, err.message, "passport_error");
}

function redactBindings(rawBindings: Binding[]): RedactedBinding[] {
  return rawBindings
    .filter((b) => !b.isDeleted)
    .map((b) => ({
      channelName: b.channelName,
      channelMasterId: b.channelMasterId,
      roleCount: b.roles.length,
      isDefault: b.isDefault,
      uidFingerprint: fingerprint(b.uid),
    }));
}

function pruneQrSessions(sessions: Map<string, QrSession>, now: number): void {
  for (const [id, session] of sessions) {
    if (now - session.createdAt > QR_SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
  while (sessions.size >= QR_MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

export function register(router: Router, deps: AppDeps): void {
  const qrSessions = new Map<string, QrSession>();

  async function finalizeQrConfirm(session: QrSession, scanCode: string): Promise<QrConfirmedResult | QrErrorResult> {
    try {
      const hytoken = await qrExchange(scanCode, deps.fetch);
      const oauth = await grantOAuth(hytoken, session.provider, deps.fetch);
      const rawBindings = await listBindings(oauth, session.provider, deps.fetch);
      const bindings = redactBindings(rawBindings);
      const label = formatBindingsLabel(rawBindings);

      let vaultId: string | undefined;
      if (session.save) {
        if (deps.dataDir === ":memory:") {
          throw new HttpError(400, "内存模式不支持保存通行证保险库", "bad_request");
        }
        vaultId = fingerprint(hytoken);
        new Vault(deps.dataDir).save(vaultId, session.provider, hytoken, label);
      }

      const confirmed: QrConfirmedResult = {
        status: "confirmed",
        ...(vaultId ? { vaultId } : {}),
        label,
        bindings,
      };
      session.result = confirmed;
      return confirmed;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const errRes: QrErrorResult = {
        status: "error",
        error: scrubUrl(err instanceof Error ? err.message : String(err)),
      };
      session.errorResult = errRes;
      return errRes;
    } finally {
      session.confirmPromise = undefined;
    }
  }

  router.post("/api/passport/inspect", async (c) => {
    const body = await c.json<InspectBody>();
    if (typeof body.input !== "string" || !body.input.trim()) {
      throw new HttpError(400, "请提供通行证 token 或 JSON 内容", "bad_request");
    }
    const provider = parseProviderField(body.provider);

    const token = parseHyTokenInput(body.input);
    if (!token) {
      throw new HttpError(400, "无法识别通行证 token（请粘贴 hytoken 或 /account/info/hg 的 JSON）", "bad_token");
    }

    let rawBindings: Binding[];
    try {
      rawBindings = await inspectPassport(token, provider, deps.fetch);
    } catch (err) {
      if (err instanceof PassportError) throw toPassportHttpError(err);
      throw err;
    }

    const bindings = redactBindings(rawBindings);

    if (body.save === true) {
      if (deps.dataDir === ":memory:") {
        throw new HttpError(400, "内存模式不支持保存通行证保险库", "bad_request");
      }
      const vaultId = fingerprint(token);
      const label = formatBindingsLabel(rawBindings);
      new Vault(deps.dataDir).save(vaultId, provider, token, label);
      return { bindings, vaultId };
    }

    return { bindings };
  });

  router.post("/api/passport/qr", async (c) => {
    const body = await c.json<QrCreateBody>();
    const provider = parseProviderField(body.provider);
    if (provider === "gryphline") {
      throw new HttpError(400, "国际服暂不支持扫码登录，请使用通行证 token", "bad_request");
    }
    if (body.save !== undefined && typeof body.save !== "boolean") {
      throw new HttpError(400, "save 必须是布尔值", "bad_request");
    }
    const save = body.save ?? true;
    if (save && deps.dataDir === ":memory:") {
      throw new HttpError(400, "内存模式不支持保存通行证保险库", "bad_request");
    }

    let created;
    try {
      created = await qrCreate(deps.fetch);
    } catch (err) {
      if (err instanceof PassportError) throw toPassportHttpError(err);
      throw err;
    }

    const now = Date.now();
    pruneQrSessions(qrSessions, now);
    // 先删后插保证重复 scanId 刷新 Map 插入顺序并重置状态
    qrSessions.delete(created.scanId);
    qrSessions.set(created.scanId, {
      provider,
      save,
      createdAt: now,
      consecutiveErrors: 0,
    });

    return { scanId: created.scanId, scanUrl: created.scanUrl };
  });

  router.get("/api/passport/qr/:scanId", async (c) => {
    const scanId = c.params.scanId ?? "";
    const session = qrSessions.get(scanId);
    if (!session || Date.now() - session.createdAt > QR_SESSION_TTL_MS) {
      if (session) qrSessions.delete(scanId);
      throw new HttpError(404, "扫码会话不存在或已过期，请重新生成二维码", "qr_expired");
    }

    if (session.result) return session.result;
    if (session.errorResult) return session.errorResult;
    if (session.confirmPromise) return session.confirmPromise;

    const res = await qrPollStatus(scanId, deps.fetch);

    if (session.result) return session.result;
    if (session.errorResult) return session.errorResult;
    if (session.confirmPromise) return session.confirmPromise;

    if (!res.ok) {
      session.consecutiveErrors += 1;
      const errMsg = scrubUrl(res.error);
      if (session.consecutiveErrors >= QR_MAX_CONSECUTIVE_ERRORS) {
        const errRes: QrErrorResult = {
          status: "error",
          error: `连续 ${session.consecutiveErrors} 次轮询扫码状态失败：${errMsg}`,
        };
        session.errorResult = errRes;
        return errRes;
      }
      return {
        status: "pending" as const,
        consecutiveErrors: session.consecutiveErrors,
        transientError: errMsg,
      };
    }

    if (res.state === "pending") {
      session.consecutiveErrors = 0;
      return {
        status: "pending" as const,
        ...(res.status !== 100 && res.msg ? { hint: res.msg } : {}),
      };
    }

    session.consecutiveErrors = 0;
    session.confirmPromise = finalizeQrConfirm(session, res.scanCode);
    return session.confirmPromise;
  });

  router.get("/api/passport/vault", () => {
    if (deps.dataDir === ":memory:") return [];
    return new Vault(deps.dataDir).list().map(({ id, provider, label, createdAt }) => ({
      id,
      provider,
      label: label ?? "",
      createdAt,
    }));
  });

  router.delete("/api/passport/vault", () => {
    if (deps.dataDir === ":memory:") return { cleared: 0 };
    const cleared = new Vault(deps.dataDir).clear();
    return { cleared };
  });
}
