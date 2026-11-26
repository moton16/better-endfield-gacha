import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api/client.js";
import { isMock } from "../api/mock.js";
import type {
  CacheScanResponse,
  LinkResponse,
  PassportInspectResponse,
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

  // Job polling state
  const [job, setJob] = useState<SyncJob | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  useEffect(() => {
    unmounted.current = false;
    void loadScan();
    void loadVault();
    return () => {
      unmounted.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
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

  async function loadVault() {
    try {
      const list = await api<VaultSession[]>("/api/passport/vault");
      if (unmounted.current) return;
      setVaultSessions(list);
      setSelectedVaultId((prev) =>
        prev && list.some((v) => v.id === prev) ? prev : (list[0]?.id ?? ""),
      );
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

  async function startSync(mode: "cache" | "passport") {
    setActionError(null);
    setJob(null);
    setSyncing(true);
    try {
      const body =
        mode === "cache"
          ? { mode: "cache", ...(channel ? { channel } : {}) }
          : {
              mode: "passport",
              vaultId: selectedVaultId,
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
        await loadVault();
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

  const latestCred = scan?.credentials
    ? [...scan.credentials].sort((a, b) => b.sortTime - a.sortTime)[0]
    : undefined;
  const missingBilibili =
    provider === "hypergryph" &&
    inspectRes !== null &&
    !inspectRes.bindings.some((b) => b.channelMasterId === "2");

  return (
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="sync-dialog-title">
        <div class="modal-head">
          <h2 id="sync-dialog-title">同步抽卡记录</h2>
          <button type="button" class="btn" onClick={onClose} aria-label="关闭同步弹窗">
            关闭
          </button>
        </div>

        <div class="tabs" role="tablist" aria-label="同步方式">
          <button
            type="button"
            role="tab"
            aria-selected={subTab === "cache"}
            onClick={() => setSubTab("cache")}
          >
            游戏缓存（零绑定）
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === "passport"}
            onClick={() => setSubTab("passport")}
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

            <form onSubmit={(e) => void handleInspect(e)}>
              <div class="field">
                <label htmlFor="passport-provider">服务区</label>
                <select
                  id="passport-provider"
                  class="select"
                  value={provider}
                  onChange={(e) =>
                    setProvider((e.target as HTMLSelectElement).value as "hypergryph" | "gryphline")
                  }
                >
                  <option value="hypergryph">国服（hypergryph）</option>
                  <option value="gryphline">国际服（gryphline）</option>
                </select>
              </div>

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
                    {v.id} · {v.provider} · {fmtTs(v.createdAt)}
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

        {actionError && <div class="warn-text">{actionError}</div>}

        {job && (
          <div style={{ marginTop: "8px" }}>
            <div class="log-box" aria-label="同步进度">
              {job.progress.slice(-8).map((line, i) => (
                <div key={`${i}-${line}`}>{line}</div>
              ))}
            </div>
            {job.result && (
              <div class="info-box">
                {job.result.items.map((item) => (
                  <div key={item.maskedKey} style={{ marginBottom: "6px" }}>
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
