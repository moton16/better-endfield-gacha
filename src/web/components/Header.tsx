import type { AccountGlobalSummary, AccountSummary } from "../api/types.js";
import { maskName } from "../lib/bar.js";

export function Header({
  accounts,
  accountKey,
  onAccountChange,
  privacy,
  onTogglePrivacy,
  onOpenSync,
  onOpenData,
  mock,
  globalSummary,
  onToast,
}: {
  accounts: AccountSummary[];
  accountKey: string;
  onAccountChange: (key: string) => void;
  privacy: boolean;
  onTogglePrivacy: () => void;
  onOpenSync: () => void;
  onOpenData: () => void;
  mock: boolean;
  globalSummary?: AccountGlobalSummary | null;
  onToast?: (msg: string) => void;
}) {
  const current = accounts.find((a) => a.accountKey === accountKey);
  const totalDraws = globalSummary?.totalDraws ?? current?.counts.draws ?? 0;
  const total6 = globalSummary?.total6 ?? 0;
  const totalFree = globalSummary?.totalFree ?? 0;

  async function handleCopyId() {
    if (!current) return;
    if (privacy) {
      onToast?.("隐私遮罩已开启，请先切换为显示明文后再复制");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(current.accountKey);
        onToast?.("已复制账号标识");
        return;
      }
    } catch {
      // 忽略权限错误
    }
    onToast?.("当前环境不支持一键复制，请在账号栏查看");
  }

  return (
    <header class="topbar">
      <div class="topbar-row">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
              <path
                d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <h1>终末地寻访分析</h1>
          {mock && <span class="mock-pill">MOCK</span>}
        </div>
        <div class="actions">
          <button
            type="button"
            class="btn"
            aria-pressed={!privacy}
            aria-label="切换隐私遮罩"
            onClick={onTogglePrivacy}
          >
            {privacy ? "👁 已遮罩" : "👁 显示明文"}
          </button>
          <button type="button" class="btn primary" onClick={onOpenSync}>
            同步
          </button>
          <button type="button" class="btn" onClick={onOpenData}>
            导入/导出
          </button>
        </div>
      </div>

      {accounts.length > 0 && current && (
        <div class="player-card">
          <div class="player-top">
            <div class="header-avatar" aria-hidden="true">
              <span class="header-avatar-inner">
                {privacy ? "终" : ([...current.nickname][0] ?? "终")}
              </span>
            </div>

            <div class="player-info">
              <div class="player-name-row">
                <span class="player-name" data-testid="account-nickname">
                  {maskName(current.nickname, !privacy)}
                </span>
                <span class="channel-badge">{current.channelName || "未知渠道"}</span>
              </div>
              <div class="account-switch-row">
                <select
                  class="account-select"
                  aria-label="切换账号"
                  value={accountKey}
                  onChange={(e) => onAccountChange((e.target as HTMLSelectElement).value)}
                >
                  {accounts.map((acc) => (
                    <option key={acc.accountKey} value={acc.accountKey}>
                      {acc.channelName || "未知渠道"} ·{" "}
                      {privacy ? acc.maskedKey : acc.accountKey.slice(-6)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div class="player-right">
              <button
                type="button"
                class="uid-copy-btn"
                onClick={() => void handleCopyId()}
                title={privacy ? "隐私遮罩状态不可复制明文" : "复制账号标识"}
              >
                <span>ID: {privacy ? current.maskedKey : current.accountKey.slice(-8)}</span>
                <svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden="true">
                  <rect
                    x="5.5"
                    y="5.5"
                    width="8"
                    height="8"
                    rx="1.5"
                    stroke="currentColor"
                    stroke-width="1.4"
                  />
                  <path
                    d="M3.5 10.5H3a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div class="player-summary-strip" aria-label="全账号抽卡汇总">
            <div class="strip-block">
              <span class="strip-label">总抽取</span>
              <span class="strip-val">{totalDraws}</span>
            </div>
            <div class="strip-block">
              <span class="strip-label">累计</span>
              <span class="strip-item">
                <svg class="strip-icon star" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <path
                    d="M8 1l2.1 4.4 4.9.7-3.5 3.4.8 4.9L8 12.1 3.7 14.4l.8-4.9L1 6.1l4.9-.7L8 1z"
                    fill="#f59e0b"
                  />
                </svg>
                <span class="strip-val">{total6}</span>
              </span>
              <span class="strip-item">
                <svg class="strip-icon ticket" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <rect x="2" y="4" width="12" height="8" rx="1.5" fill="#27e29b" />
                  <circle cx="8" cy="8" r="2" fill="#0b3d2c" />
                </svg>
                <span class="strip-label-sm">免费</span>
                <span class="strip-val">{totalFree}</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
