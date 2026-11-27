import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { encodeQr } from "../../core/qr.js";
import { ApiError, api } from "../api/client.js";
import { isMock } from "../api/mock.js";
import type {
  CacheScanResponse,
  LinkResponse,
  PassportInspectResponse,
  PassportQrCreateResponse,
  PassportQrStatusResponse,
  SyncJob,
  VaultSession,
} from "../api/types.js";
import { fmtRelativeTime, fmtTs } from "../lib/bar.js";

function channelLabel(ch?: string): string {
  if (ch === "1") return "官服";
  if (ch === "2") return "bilibili服";
  return "未知渠道";
}

function feedStatusMark(status: "ok" | "skipped" | "error"): string {
  if (status === "ok") return "✓";
  if (status === "skipped") return "–";
  return "✗";
}

const QR_QUIET_ZONE = 2;

function qrModulesToPath(modules: boolean[][]): string {
  const parts: string[] = [];
  for (let y = 0; y < modules.length; y++) {
    const row = modules[y];
    if (!row) continue;
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) {
        x++;
      }
      parts.push(`M${start + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h${x - start}v1h-${x - start}z`);
    }
  }
  return parts.join("");
}

export function SyncDialog({
  onClose,
  onSynced,
  onToast,
  onAuthError,
}: {
  onClose: () => void;
  onSynced: () => Promise<void> | void;
  onToast: (msg: string) => void;
  onAuthError: (err: unknown) => boolean;
}) {
  const [subTab, setSubTab] = useState<"cache" | "passport">("cache");

  // Route A state
  const [scan, setScan] = useState<CacheScanResponse | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [channel, setChannel] = useState<"" | "1" | "2">("");
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [revealedLink, setRevealedLink] = useState<string | null>(null);
  const [maskedLink, setMaskedLink] = useState<string | null>(null);

  // Route B state
  const [provider, setProvider] = useState<"hypergryph" | "gryphline">("hypergryph");
  const [tokenInput, setTokenInput] = useState("");
  const [saveVault, setSaveVault] = useState(true);
  const [inspecting, setInspecting] = useState(false);
  const [inspectRes, setInspectRes] = useState<PassportInspectResponse | null>(null);
  const [vaultSessions, setVaultSessions] = useState<VaultSession[]>([]);
  const [selectedVaultId, setSelectedVaultId] = useState("");
  const [confirmClearVault, setConfirmClearVault] = useState(false);
  const [passportNote, setPassportNote] = useState<string | null>(null);

  // Route B QR login state
  const [qrStatus, setQrStatus] = useState<"idle" | "creating" | "polling" | "error">("idle");
  const [qrSession, setQrSession] = useState<PassportQrCreateResponse | null>(null);
  const [qrHint, setQrHint] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const qrTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrRunId = useRef(0);

  // Job polling state
  const [job, setJob] = useState<SyncJob | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  function clearQrTimer() {
    qrRunId.current += 1;
    if (qrTimer.current) {
      clearTimeout(qrTimer.current);
      qrTimer.current = null;
    }
  }

  function cancelQr() {
    clearQrTimer();
    setQrStatus("idle");
    setQrSession(null);
    setQrHint(null);
    setQrError(null);
  }

  useEffect(() => {
    unmounted.current = false;
    void loadScan();
    void loadVault();
    return () => {
      unmounted.current = true;
      qrRunId.current += 1;
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (qrTimer.current) clearTimeout(qrTimer.current);
      setTokenInput("");
      setRevealedLink(null);
    };
  }, []);

  async function loadScan() {
    setScanLoading(true);
    setScanError(null);
    try {
      const res = await api<CacheScanResponse>("/api/cache/scan");
      if (!unmounted.current) setScan(res);
    } catch (err) {
      if (onAuthError(err)) return;
      if (!unmounted.current) {
        setScanError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!unmounted.current) setScanLoading(false);
    }
  }

  async function loadVault(preferredId?: string) {
    try {
      const list = await api<VaultSession[]>("/api/passport/vault");
      if (unmounted.current) return;
      setVaultSessions(list);
      setSelectedVaultId((prev) => {
        if (preferredId && list.some((v) => v.id === preferredId)) return preferredId;
        return prev && list.some((v) => v.id === prev) ? prev : (list[0]?.id ?? "");
      });
    } catch (err) {
      onAuthError(err);
    }
  }

  async function pollJob(jobId: string) {
    if (unmounted.current) return;
    try {
      const current = await api<SyncJob>(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (unmounted.current) return;
      setJob(current);
      if (current.state === "running") {
        pollTimer.current = setTimeout(() => {
          void pollJob(jobId);
        }, isMock() ? 100 : 1000);
        return;
      }
      setSyncing(false);
      if (current.state === "done") {
        await onSynced();
        onToast("同步完成");
      } else if (current.state === "error") {
        setActionError(current.error ?? "同步失败");
      }
    } catch (err) {
      if (onAuthError(err)) return;
      if (!unmounted.current) {
        setSyncing(false);
        setActionError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  async function startSync(mode: "cache" | "passport", vaultIdOverride?: string) {
    setActionError(null);
    setJob(null);
    setSyncing(true);
    try {
      const effectiveVaultId = vaultIdOverride ?? selectedVaultId;
      const body =
        mode === "cache"
          ? { mode: "cache", ...(channel ? { channel } : {}) }
          : {
              mode: "passport",
              vaultId: effectiveVaultId,
              ...(channel ? { channel } : {}),
            };
      const res = await api<{ jobId: string }>("/api/sync", {
        method: "POST",
        body,
      });
      await pollJob(res.jobId);
    } catch (err) {
      if (onAuthError(err)) return;
      if (!unmounted.current) {
        setSyncing(false);
        setActionError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  async function pollQr(scanId: string, runId: number) {
    if (unmounted.current || qrRunId.current !== runId) return;
    try {
      const res = await api<PassportQrStatusResponse>(
        `/api/passport/qr/${encodeURIComponent(scanId)}`,
      );
      if (unmounted.current || qrRunId.current !== runId) return;

      if (res.status === "pending") {
        if (res.transientError) {
          setQrHint(
            `网络波动，正在重试（第 ${res.consecutiveErrors ?? 1} 次）：${res.transientError}`,
          );
        } else if (res.hint) {
          setQrHint(res.hint);
        } else {
          setQrHint(null);
        }
        qrTimer.current = setTimeout(() => {
          void pollQr(scanId, runId);
        }, isMock() ? 100 : 2000);
        return;
      }

      if (res.status === "error") {
        clearQrTimer();
        setQrStatus("error");
        setQrError(res.error || "扫码登录失败，请重新生成二维码");
        setQrHint(null);
        return;
      }

      clearQrTimer();
      setQrStatus("idle");
      setQrSession(null);
      setQrHint(null);
      setQrError(null);
      setInspectRes({
        bindings: res.bindings,
        ...(res.vaultId ? { vaultId: res.vaultId } : {}),
      });
      if (res.vaultId) {
        await loadVault(res.vaultId);
        if (unmounted.current) return;
        setSelectedVaultId(res.vaultId);
        onToast(`扫码登录成功（${res.label}），已加密保存并开始同步`);
        void startSync("passport", res.vaultId);
      } else {
        setPassportNote(`已完成扫码校验（${res.label}；未勾选加密保存，无法经本地服务同步）。`);
        onToast("扫码登录校验完成");
      }
    } catch (err) {
      if (onAuthError(err)) {
        clearQrTimer();
        return;
      }
      if (unmounted.current || qrRunId.current !== runId) return;
      clearQrTimer();
      setQrStatus("error");
      const expired =
        (err instanceof ApiError && (err.status === 404 || err.code === "qr_expired")) ||
        (err instanceof Error && err.message.includes("过期"));
      setQrError(
        expired
          ? err instanceof Error && err.message
            ? err.message
            : "二维码已过期，请重新生成"
          : err instanceof Error
            ? err.message
            : String(err),
      );
      setQrHint(null);
    }
  }

  async function startQrLogin() {
    clearQrTimer();
    const runId = qrRunId.current;
    setActionError(null);
    setPassportNote(null);
    setQrError(null);
    setQrHint(null);
    setQrSession(null);
    setQrStatus("creating");
    try {
      const res = await api<PassportQrCreateResponse>("/api/passport/qr", {
        method: "POST",
        body: { provider: "hypergryph", save: saveVault },
      });
      if (unmounted.current || qrRunId.current !== runId) return;
      if (!res.scanId || !res.scanUrl) {
        throw new Error("未获取到有效的扫码会话");
      }
      setQrSession(res);
      setQrStatus("polling");
      qrTimer.current = setTimeout(() => {
        void pollQr(res.scanId, runId);
      }, isMock() ? 100 : 2000);
    } catch (err) {
      if (onAuthError(err)) {
        clearQrTimer();
        return;
      }
      if (unmounted.current || qrRunId.current !== runId) return;
      clearQrTimer();
      setQrStatus("error");
      setQrError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCopyLink() {
    setActionError(null);
    try {
      const res = await api<LinkResponse>("/api/link", {
        method: "POST",
        body: { copy: true, ...(channel ? { channel } : {}) },
      });
      if (!unmounted.current) {
        setMaskedLink(res.masked);
      }
      onToast(
        res.copied !== false
          ? "已复制（含凭据，勿分享）"
          : "已生成脱敏链接，但写入剪贴板失败",
      );
    } catch (err) {
      if (onAuthError(err)) return;
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRevealLink() {
    setActionError(null);
    setConfirmReveal(false);
    try {
      const res = await api<LinkResponse>("/api/link", {
        method: "POST",
        body: { reveal: true, ...(channel ? { channel } : {}) },
      });
      if (!unmounted.current) {
        setMaskedLink(res.masked);
        setRevealedLink(res.link ?? res.masked);
      }
    } catch (err) {
      if (onAuthError(err)) return;
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleInspect(e: Event) {
    e.preventDefault();
    const raw = tokenInput;
    setTokenInput("");
    if (!raw.trim()) return;

    setInspecting(true);
    setActionError(null);
    setPassportNote(null);
    try {
      const res = await api<PassportInspectResponse>("/api/passport/inspect", {
        method: "POST",
        body: { input: raw, provider, save: saveVault },
      });
      if (unmounted.current) return;
      setInspectRes(res);
      if (res.vaultId) {
        await loadVault(res.vaultId);
        setSelectedVaultId(res.vaultId);
        onToast("通行证校验成功并已加密保存");
      } else {
        setPassportNote("已完成校验（未勾选加密保存，无法经本地服务同步）。");
      }
    } catch (err) {
      if (onAuthError(err)) return;
      if (!unmounted.current) {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!unmounted.current) setInspecting(false);
    }
  }

  async function handleClearVault() {
    setConfirmClearVault(false);
    setActionError(null);
    try {
      await api<{ cleared: number }>("/api/passport/vault", {
        method: "DELETE",
        body: {},
      });
      if (unmounted.current) return;
      setVaultSessions([]);
      setSelectedVaultId("");
      setPassportNote(
        "已清除全部本地加密会话；如需彻底撤回登录态，请前往 user.hypergryph.com 手动踢出对应设备。",
      );
      onToast("已清除本地通行证会话");
    } catch (err) {
      if (onAuthError(err)) return;
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleClose() {
    cancelQr();
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    onClose();
  }

  function switchTab(next: "cache" | "passport") {
    if (next === subTab) return;
    if (next !== "passport") {
      cancelQr();
    }
    setActionError(null);
    setSubTab(next);
  }

  const qrGraphic = useMemo(() => {
    if (!qrSession?.scanUrl) return null;
    const { size, modules } = encodeQr(qrSession.scanUrl);
    return {
      viewSize: size + QR_QUIET_ZONE * 2,
      path: qrModulesToPath(modules),
    };
  }, [qrSession?.scanUrl]);

  const latestCred = scan?.credentials
    ? [...scan.credentials].sort((a, b) => b.sortTime - a.sortTime)[0]
    : undefined;
  const missingBilibili =
    provider === "hypergryph" &&
    inspectRes !== null &&
    !inspectRes.bindings.some((b) => b.channelMasterId === "2");
  const showPassportFallback =
    subTab === "cache" &&
    actionError !== null &&
    (actionError.includes("40100") || actionError.includes("过期"));

  return (
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="sync-dialog-title">
        <div class="modal-head">
          <h2 id="sync-dialog-title">同步抽卡记录</h2>
          <button type="button" class="btn" onClick={handleClose} aria-label="关闭同步弹窗">
            关闭
          </button>
        </div>

        <div class="tabs" role="tablist" aria-label="同步方式">
          <button
            type="button"
            role="tab"
            aria-selected={subTab === "cache"}
            onClick={() => switchTab("cache")}
          >
            游戏缓存（零绑定）
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === "passport"}
            onClick={() => switchTab("passport")}
          >
            鹰角通行证
          </button>
        </div>

        {subTab === "cache" && (
          <div>
            <div class="info-box">
              {scanLoading && <span>正在扫描本机缓存…</span>}
              {!scanLoading && scanError && <span class="warn-text">{scanError}</span>}
              {!scanLoading && !scanError && scan && (
                <>
                  {latestCred ? (
                    <div>
                      找到 {scan.credentials.length} 个凭据，最新：
                      {channelLabel(latestCred.channel)} · {fmtRelativeTime(latestCred.sortTime)}
                      （指纹 {latestCred.fingerprint}）
                    </div>
                  ) : (
                    <div>
                      未找到凭据。请在游戏内打开一次「寻访详情 → 寻访记录」再回来刷新。
                    </div>
                  )}
                </>
              )}
            </div>

            <div class="field">
              <label htmlFor="sync-channel-select">目标渠道</label>
              <select
                id="sync-channel-select"
                class="select"
                value={channel}
                onChange={(e) => setChannel((e.target as HTMLSelectElement).value as "" | "1" | "2")}
              >
                <option value="">自动（最新凭据）</option>
                <option value="2">bilibili服</option>
                <option value="1">官服</option>
              </select>
            </div>

            <div class="row-inline" style={{ marginBottom: "10px" }}>
              <button
                type="button"
                class="btn primary"
                disabled={syncing}
                onClick={() => void startSync("cache")}
              >
                {syncing ? "同步中…" : "开始同步"}
              </button>
              <button type="button" class="btn" disabled={scanLoading} onClick={() => void loadScan()}>
                重新扫描
              </button>
              <button type="button" class="btn" onClick={() => void handleCopyLink()}>
                复制抽卡链接
              </button>
              {!confirmReveal && (
                <button
                  type="button"
                  class="btn"
                  onClick={() => setConfirmReveal(true)}
                >
                  显示链接
                </button>
              )}
            </div>

            {confirmReveal && (
              <div class="info-box">
                <div class="warn-text">抽卡链接包含账号凭据，确定要在屏幕明文显示吗？</div>
                <div class="row-inline">
                  <button type="button" class="btn danger" onClick={() => void handleRevealLink()}>
                    确认显示链接
                  </button>
                  <button type="button" class="btn" onClick={() => setConfirmReveal(false)}>
                    取消
                  </button>
                </div>
              </div>
            )}

            {revealedLink && (
              <div class="info-box">
                <div>明文抽卡链接（勿分享）：</div>
                <div>{revealedLink}</div>
                <button
                  type="button"
                  class="btn"
                  style={{ marginTop: "6px" }}
                  onClick={() => setRevealedLink(null)}
                >
                  隐藏链接
                </button>
              </div>
            )}

            {!revealedLink && maskedLink && (
              <div class="info-box">脱敏链接：{maskedLink}</div>
            )}
          </div>
        )}

        {subTab === "passport" && (
          <div>
            <p class="muted" style={{ marginTop: 0 }}>
              B 服玩家需要先在 user.hypergryph.com 绑定 B 服角色；token 权限较高；勾选「加密保存」会使用 Windows DPAPI 保存在本机。
            </p>

            <div class="field">
              <label htmlFor="passport-provider">服务区</label>
              <select
                id="passport-provider"
                class="select"
                value={provider}
                onChange={(e) => {
                  const next = (e.target as HTMLSelectElement).value as "hypergryph" | "gryphline";
                  if (next !== "hypergryph") {
                    cancelQr();
                  }
                  setProvider(next);
                }}
              >
                <option value="hypergryph">国服（hypergryph）</option>
                <option value="gryphline">国际服（gryphline）</option>
              </select>
            </div>

            {provider === "hypergryph" && (
              <div class="info-box qr-panel">
                <div class="qr-panel-head">
                  <span class="qr-title">森空岛扫码登录（推荐）</span>
                  {qrStatus === "idle" && (
                    <button
                      type="button"
                      class="btn primary"
                      disabled={syncing}
                      onClick={() => void startQrLogin()}
                    >
                      扫码登录
                    </button>
                  )}
                  {(qrStatus === "creating" || qrStatus === "polling") && (
                    <button type="button" class="btn" onClick={cancelQr}>
                      取消扫码
                    </button>
                  )}
                </div>

                {qrStatus === "creating" && (
                  <div class="qr-hint">正在生成扫码会话…</div>
                )}

                {qrStatus === "polling" && qrGraphic && (
                  <div class="qr-box">
                    <div class="qr-frame">
                      <svg
                        class="qr-svg"
                        viewBox={`0 0 ${qrGraphic.viewSize} ${qrGraphic.viewSize}`}
                        role="img"
                        aria-label="扫码登录二维码"
                        shape-rendering="crispEdges"
                      >
                        <rect
                          width={qrGraphic.viewSize}
                          height={qrGraphic.viewSize}
                          fill="#ffffff"
                        />
                        <path d={qrGraphic.path} fill="#000000" />
                      </svg>
                    </div>
                    <div class="qr-hint">
                      {qrHint ?? "请使用森空岛 App 扫描二维码并在手机上确认登录"}
                    </div>
                  </div>
                )}

                {qrStatus === "error" && (
                  <div>
                    <div class="warn-text">{qrError ?? "扫码登录失败，请重试"}</div>
                    <div class="row-inline" style={{ marginTop: "6px" }}>
                      <button
                        type="button"
                        class="btn primary"
                        disabled={syncing}
                        onClick={() => void startQrLogin()}
                      >
                        重新生成二维码
                      </button>
                      <button type="button" class="btn" onClick={cancelQr}>
                        取消扫码
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={(e) => void handleInspect(e)}>
              <div class="field">
                <label htmlFor="passport-token">通行证 token 或 /account/info/hg JSON</label>
                <input
                  id="passport-token"
                  class="input"
                  type="password"
                  autocomplete="off"
                  placeholder="粘贴 hytoken 或 JSON"
                  value={tokenInput}
                  onInput={(e) => setTokenInput((e.target as HTMLInputElement).value)}
                />
              </div>

              <div class="row-inline" style={{ marginBottom: "10px" }}>
                <label class="row-inline">
                  <input
                    type="checkbox"
                    checked={saveVault}
                    onChange={(e) => setSaveVault((e.target as HTMLInputElement).checked)}
                  />
                  <span>加密保存到本机保险库</span>
                </label>
                <button
                  type="submit"
                  class="btn"
                  disabled={!tokenInput.trim() || inspecting}
                >
                  {inspecting ? "校验中…" : "校验"}
                </button>
              </div>
            </form>

            {inspectRes && (
              <div class="info-box">
                <div>绑定列表（共 {inspectRes.bindings.length} 项）：</div>
                <ul class="list-plain">
                  {inspectRes.bindings.map((b) => (
                    <li key={`${b.channelMasterId}-${b.uidFingerprint}`}>
                      {b.channelName} · 角色数 {b.roleCount}
                      {b.isDefault ? " · 默认" : ""} · 指纹 {b.uidFingerprint}
                    </li>
                  ))}
                </ul>
                {missingBilibili && (
                  <div class="warn-text">
                    未检测到 B 服绑定（如游玩 B 服，请先前往 user.hypergryph.com 绑定 B 服角色）。
                  </div>
                )}
              </div>
            )}

            {passportNote && <div class="info-box">{passportNote}</div>}

            <div class="field">
              <label htmlFor="vault-select">已保存的会话</label>
              <select
                id="vault-select"
                class="select"
                value={selectedVaultId}
                onChange={(e) => setSelectedVaultId((e.target as HTMLSelectElement).value)}
              >
                {vaultSessions.length === 0 && <option value="">暂无已保存会话</option>}
                {vaultSessions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label
                      ? `${v.label} · ${v.id} · ${fmtTs(v.createdAt)}`
                      : `${v.id} · ${v.provider} · ${fmtTs(v.createdAt)}`}
                  </option>
                ))}
              </select>
            </div>

            <div class="row-inline" style={{ marginBottom: "10px" }}>
              <button
                type="button"
                class="btn primary"
                disabled={syncing || !selectedVaultId}
                onClick={() => void startSync("passport")}
              >
                {syncing ? "同步中…" : "使用所选会话同步"}
              </button>
              {!confirmClearVault ? (
                <button
                  type="button"
                  class="btn"
                  disabled={vaultSessions.length === 0}
                  onClick={() => setConfirmClearVault(true)}
                >
                  清除全部
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    class="btn danger"
                    onClick={() => void handleClearVault()}
                  >
                    确认清除全部会话
                  </button>
                  <button
                    type="button"
                    class="btn"
                    onClick={() => setConfirmClearVault(false)}
                  >
                    取消
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {actionError && (
          <div class="warn-text">
            <div>{actionError}</div>
            {showPassportFallback && (
              <div style={{ marginTop: "6px" }}>
                <button
                  type="button"
                  class="btn"
                  onClick={() => {
                    setActionError(null);
                    setProvider("hypergryph");
                    setSubTab("passport");
                  }}
                >
                  改用鹰角通行证扫码
                </button>
              </div>
            )}
          </div>
        )}

        {job && (
          <div style={{ marginTop: "8px" }}>
            <div class="log-box" aria-label="同步进度">
              {job.progress.slice(-8).map((line, i) => (
                <div key={`${i}-${line}`}>{line}</div>
              ))}
            </div>
            {job.result && (
              <div class="info-box">
                {job.result.items.map((item, idx) => (
                  <div key={`${idx}-${item.maskedKey}`} style={{ marginBottom: "6px" }}>
                    <strong>
                      {item.channelName} · {item.maskedKey}
                    </strong>
                    {item.error && <div class="warn-text">{item.error}</div>}
                    <ul class="list-plain">
                      {item.feeds.map((f) => (
                        <li key={f.label}>
                          {feedStatusMark(f.status)} {f.label}：拉取 {f.fetched}，新增 {f.added}
                          {f.error ? `（${f.error}）` : ""}
                        </li>
                      ))}
                    </ul>
                    {item.warnings.map((w, idx) => (
                      <div key={idx} class="warn-text">
                        {w}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
