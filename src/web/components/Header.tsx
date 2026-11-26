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
  const uidDisplay = current ? (privacy ? current.maskedKey : current.accountKey.slice(-10)) : "";

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
    <header class="view-player-info">
      <svg class="player-contour-bg" viewBox="0 0 480 120" preserveAspectRatio="none" aria-hidden="true">
        <path
          d="M-10 38 Q95 8 185 44 T365 26 T500 50 M-10 66 Q110 24 220 72 T410 46 T500 78 M290 -10 Q355 58 495 36"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
        />
      </svg>

      {accounts.length > 0 && current ? (
        <>
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
                {mock && <span class="mock-pill">MOCK</span>}
                <button
                  type="button"
                  class="icon-eye-btn"
                  aria-pressed={!privacy}
                  aria-label="切换隐私遮罩"
                  title={privacy ? "点击显示明文" : "点击隐藏隐私信息"}
                  onClick={onTogglePrivacy}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
                    <path
                      d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4Z"
                      stroke="currentColor"
                      stroke-width="1.3"
                    />
                    <circle cx="8" cy="8" r="1.8" stroke="currentColor" stroke-width="1.3" />
                    {privacy && (
                      <path
                        d="M2.5 13.5l11-11"
                        stroke="currentColor"
                        stroke-width="1.3"
                        stroke-linecap="round"
                      />
                    )}
                  </svg>
                </button>
              </div>

              <div class="player-channel-row">
                <select
                  class="account-select-clean"
                  aria-label="切换账号"
                  value={accountKey}
                  onChange={(e) => onAccountChange((e.target as HTMLSelectElement).value)}
                >
                  {accounts.map((acc) => (
                    <option key={acc.accountKey} value={acc.accountKey}>
                      {acc.channelName || "未知渠道"}
                      {accounts.length > 1
                        ? ` · ${privacy ? acc.maskedKey : acc.accountKey.slice(-6)}`
                        : ""}
                    </option>
                  ))}
                </select>
                {accounts.length > 1 && <span class="channel-caret" aria-hidden="true">▾</span>}
              </div>
            </div>

            <div class="player-right">
              <button
                type="button"
                class="uid-copy-btn"
                onClick={() => void handleCopyId()}
                title={privacy ? "隐私遮罩状态不可复制明文" : "复制账号标识"}
              >
                <span>ID:{uidDisplay}</span>
                <svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden="true">
                  <rect
                    x="5.5"
                    y="5.5"
                    width="8"
                    height="8"
                    rx="1.4"
                    stroke="currentColor"
                    stroke-width="1.3"
                  />
                  <path
                    d="M3.5 10.5H3a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                  />
                </svg>
              </button>

              <div class="header-micro-actions">
                <button type="button" class="micro-pill-btn primary-tint" onClick={onOpenSync}>
                  同步
                </button>
                <button type="button" class="micro-pill-btn" onClick={onOpenData}>
                  导入/导出
                </button>
              </div>
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
                <svg class="strip-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path
                    d="M8 1.2l2 4.2 4.6.7-3.3 3.2.8 4.6L8 11.7 3.9 13.9l.8-4.6L1.4 6.1 6 5.4 8 1.2z"
                    fill="#f59e0b"
                  />
                </svg>
                <span class="strip-val">{total6}</span>
              </span>
              <span class="strip-item">
                <svg class="strip-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <rect x="1.5" y="4" width="13" height="8" rx="1.5" fill="#27e29b" />
                  <circle cx="8" cy="8" r="1.9" fill="#14191e" />
                </svg>
                <span class="strip-label-sm">免费</span>
                <span class="strip-val">{totalFree}</span>
              </span>
            </div>
          </div>
        </>
      ) : (
        <div class="player-empty-bar">
          <div class="brand-compact">
            <span class="brand-name">终末地寻访分析</span>
            {mock && <span class="mock-pill">MOCK</span>}
          </div>
          <div class="header-micro-actions">
            <button
              type="button"
              class="micro-pill-btn"
              aria-pressed={!privacy}
              aria-label="切换隐私遮罩"
              onClick={onTogglePrivacy}
            >
              {privacy ? "已遮罩" : "明文"}
            </button>
            <button type="button" class="micro-pill-btn primary-tint" onClick={onOpenSync}>
              同步
            </button>
            <button type="button" class="micro-pill-btn" onClick={onOpenData}>
              导入/导出
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
