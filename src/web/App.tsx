import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { ApiError, api, bootstrapKey, clearKey } from "./api/client.js";
import { isMock } from "./api/mock.js";
import type { AccountAnalysis, AccountAvatarResponse, AccountSummary } from "./api/types.js";
import { AvatarPickerDialog } from "./components/AvatarPickerDialog.js";
import { DataDialog } from "./components/DataDialog.js";
import { Header, readStoredAvatar, writeStoredAvatar } from "./components/Header.js";
import { KeyPrompt } from "./components/KeyPrompt.js";
import { PoolSection } from "./components/PoolSection.js";
import { PoolTabs } from "./components/PoolTabs.js";
import { SummaryCards } from "./components/SummaryCards.js";
import { SyncDialog } from "./components/SyncDialog.js";
import { Toast } from "./components/Toast.js";
import {
  deriveGlobalSummary,
  deriveUiCards,
  groupMatchesUiTab,
  type UiTab,
} from "./lib/bar.js";

const SHOW_FIVE_KEY = "beg.show5";

function readShowFivePref(): boolean {
  try {
    return localStorage.getItem(SHOW_FIVE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveShowFivePref(val: boolean): void {
  try {
    localStorage.setItem(SHOW_FIVE_KEY, val ? "1" : "0");
  } catch {
    // 忽略受限环境
  }
}

export function App() {
  const mock = isMock();
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [accountKey, setAccountKey] = useState("");
  const [analysis, setAnalysis] = useState<AccountAnalysis | null>(null);
  const [tab, setTab] = useState<UiTab>("special");
  const [showFiveStar, setShowFiveStar] = useState<boolean>(() => readShowFivePref());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyReason, setKeyReason] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"sync" | "data" | "avatar" | null>(null);
  const [privacy, setPrivacy] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const handleToggleFiveStar = useCallback(() => {
    setShowFiveStar((prev) => {
      const next = !prev;
      saveShowFivePref(next);
      return next;
    });
  }, []);

  const handleAuthError = useCallback((err: unknown): boolean => {
    if (err instanceof ApiError && err.status === 401) {
      clearKey();
      setDialog(null);
      setKeyReason("密钥失效或未提供。请重新运行 `beg serve`，或粘贴启动时打印的密钥。");
      return true;
    }
    return false;
  }, []);

  const loadAnalysis = useCallback(
    async (key: string) => {
      if (!key) {
        setAnalysis(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await api<AccountAnalysis>(
          `/api/accounts/${encodeURIComponent(key)}/analysis`,
        );
        setAnalysis(res);
      } catch (err) {
        if (handleAuthError(err)) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [handleAuthError],
  );

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api<AccountSummary[]>("/api/accounts");
      const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
      setAccounts(sorted);
      setAccountKey((prev) => {
        if (prev && sorted.some((a) => a.accountKey === prev)) return prev;
        return sorted[0]?.accountKey ?? "";
      });
      if (sorted.length === 0) {
        setAnalysis(null);
      }
    } catch (err) {
      if (handleAuthError(err)) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [handleAuthError]);

  useEffect(() => {
    const key = bootstrapKey();
    if (!key && !mock) {
      setKeyReason("请输入启动 `beg serve` 时打印的访问密钥（或通过带 #k= 的链接打开）。");
      return;
    }
    void loadAccounts();
  }, [mock, loadAccounts]);

  useEffect(() => {
    if (accountKey) {
      void loadAnalysis(accountKey);
    }
  }, [accountKey, loadAnalysis]);

  async function refreshAll() {
    await loadAccounts();
    if (accountKey) {
      await loadAnalysis(accountKey);
    }
  }

  const handleSelectAvatar = useCallback(
    async (nextAvatar: string) => {
      if (!accountKey) return;
      try {
        const res = await api<AccountAvatarResponse>(
          `/api/accounts/${encodeURIComponent(accountKey)}/avatar`,
          { method: "PUT", body: { avatar: nextAvatar } },
        );
        const savedAvatar = res.avatar ?? nextAvatar;
        writeStoredAvatar(accountKey, savedAvatar);
        setAccounts((prev) =>
          prev.map((a) => (a.accountKey === accountKey ? { ...a, avatar: savedAvatar } : a)),
        );
        showToast(savedAvatar ? "已更新头像" : "已恢复默认头像");
      } catch (err) {
        if (handleAuthError(err)) return;
        throw err;
      }
    },
    [accountKey, handleAuthError, showToast],
  );

  const currentAccount = useMemo(
    () => accounts.find((a) => a.accountKey === accountKey) ?? null,
    [accounts, accountKey],
  );
  const globalSummary = useMemo(
    () => (analysis ? deriveGlobalSummary(analysis) : null),
    [analysis],
  );
  const uiCards = useMemo(
    () => (analysis ? deriveUiCards(analysis) : []),
    [analysis],
  );
  const tabGroups = analysis
    ? analysis.groups.filter((g) => groupMatchesUiTab(g, tab) && g.total > 0)
    : [];

  return (
    <div class="app-shell">
      <Header
        accounts={accounts}
        accountKey={accountKey}
        onAccountChange={setAccountKey}
        privacy={privacy}
        onTogglePrivacy={() => setPrivacy((p) => !p)}
        onOpenSync={() => setDialog("sync")}
        onOpenData={() => setDialog("data")}
        onOpenAvatarPicker={() => setDialog("avatar")}
        mock={mock}
        globalSummary={globalSummary}
        onToast={showToast}
      />

      {error && (
        <div class="card empty-card">
          <div class="warn-text">{error}</div>
          <button type="button" class="btn primary" onClick={() => void refreshAll()}>
            重试
          </button>
        </div>
      )}

      {!error && loading && !analysis && (
        <div class="skeleton-list" aria-label="加载中">
          <div class="skeleton" />
          <div class="skeleton" />
          <div class="skeleton" />
        </div>
      )}

      {!error && !loading && accounts.length === 0 && !keyReason && (
        <div class="card empty-card">
          <div>还没有抽卡数据，点击同步获取记录或导入备份。</div>
          <div class="row-inline">
            <button type="button" class="btn primary" onClick={() => setDialog("sync")}>
              同步数据
            </button>
            <button type="button" class="btn" onClick={() => setDialog("data")}>
              导入备份
            </button>
          </div>
        </div>
      )}

      {analysis && globalSummary && (
        <main>
          <SummaryCards
            cards={uiCards}
            globalSummary={globalSummary}
            activeTab={tab}
            onSelectTab={setTab}
          />

          <section class="view-record-area" aria-label="抽卡记录明细">
            <PoolTabs
              active={tab}
              onChange={setTab}
              showFiveStar={showFiveStar}
              onToggleFiveStar={handleToggleFiveStar}
            />

            {tabGroups.length === 0 ? (
              <div class="record-area-empty">当前分类下暂无抽卡记录</div>
            ) : (
              <div class="pool-list">
                {tabGroups.map((group) => (
                  <PoolSection key={group.key} group={group} showFiveStar={showFiveStar} />
                ))}
              </div>
            )}
          </section>

          <div class="footer-actions">
            <button
              type="button"
              class="footer-data-btn"
              onClick={() => setDialog("data")}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
                <path
                  d="M8 2.5v7.5M5 5.5L8 2.5l3 3M3 10.5v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2"
                  stroke="currentColor"
                  stroke-width="1.3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span>数据导入导出</span>
            </button>
          </div>

          {analysis.notes.length > 0 && (
            <div class="notes">
              {analysis.notes.map((n, i) => (
                <p key={i}>※ {n}</p>
              ))}
            </div>
          )}
        </main>
      )}

      {keyReason && (
        <KeyPrompt
          reason={keyReason}
          onSubmit={() => {
            setKeyReason(null);
            void loadAccounts();
          }}
        />
      )}

      {dialog === "sync" && (
        <SyncDialog
          onClose={() => setDialog(null)}
          onSynced={refreshAll}
          onToast={showToast}
          onAuthError={handleAuthError}
        />
      )}

      {dialog === "data" && (
        <DataDialog
          accounts={accounts}
          currentAccountKey={accountKey}
          privacy={privacy}
          onClose={() => setDialog(null)}
          onDataChanged={refreshAll}
          onToast={showToast}
          onAuthError={handleAuthError}
        />
      )}

      {dialog === "avatar" && currentAccount && (
        <AvatarPickerDialog
          accountKey={currentAccount.accountKey}
          currentAvatar={currentAccount.avatar || readStoredAvatar(currentAccount.accountKey)}
          nickname={currentAccount.nickname}
          privacy={privacy}
          onSelectAvatar={handleSelectAvatar}
          onClose={() => setDialog(null)}
        />
      )}

      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
