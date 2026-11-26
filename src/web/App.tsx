import { useCallback, useEffect, useState } from "preact/hooks";
import { ApiError, api, bootstrapKey, clearKey } from "./api/client.js";
import { isMock } from "./api/mock.js";
import type { AccountAnalysis, AccountSummary, Tab } from "./api/types.js";
import { BadgeRow } from "./components/BadgeRow.js";
import { DataDialog } from "./components/DataDialog.js";
import { Header } from "./components/Header.js";
import { KeyPrompt } from "./components/KeyPrompt.js";
import { PoolSection } from "./components/PoolSection.js";
import { PoolTabs } from "./components/PoolTabs.js";
import { SummaryCards } from "./components/SummaryCards.js";
import { SyncDialog } from "./components/SyncDialog.js";
import { Toast } from "./components/Toast.js";

export function App() {
  const mock = isMock();
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [accountKey, setAccountKey] = useState("");
  const [analysis, setAnalysis] = useState<AccountAnalysis | null>(null);
  const [tab, setTab] = useState<Tab>("limited");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyReason, setKeyReason] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"sync" | "data" | null>(null);
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

  const tabGroups = analysis ? analysis.groups.filter((g) => g.tab === tab) : [];
  const activeOverview = analysis?.overview[tab];

  return (
    <div>
      <Header
        accounts={accounts}
        accountKey={accountKey}
        onAccountChange={setAccountKey}
        privacy={privacy}
        onTogglePrivacy={() => setPrivacy((p) => !p)}
        onOpenSync={() => setDialog("sync")}
        onOpenData={() => setDialog("data")}
        mock={mock}
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

      {analysis && (
        <main>
          <SummaryCards
            overview={analysis.overview}
            activeTab={tab}
            onSelectTab={setTab}
          />

          {activeOverview && <BadgeRow overview={activeOverview} />}

          <PoolTabs active={tab} onChange={setTab} />

          {tabGroups.filter((g) => g.total > 0).length === 0 ? (
            <div class="card empty-card muted">当前分类下暂无抽卡记录。</div>
          ) : (
            tabGroups.map((group) => <PoolSection key={group.key} group={group} />)
          )}

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

      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
