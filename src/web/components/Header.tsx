import type { AccountSummary } from "../api/types.js";
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
}: {
  accounts: AccountSummary[];
  accountKey: string;
  onAccountChange: (key: string) => void;
  privacy: boolean;
  onTogglePrivacy: () => void;
  onOpenSync: () => void;
  onOpenData: () => void;
  mock: boolean;
}) {
  const current = accounts.find((a) => a.accountKey === accountKey);

  return (
    <header class="topbar">
      <div class="topbar-row">
        <div class="brand">
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

      {accounts.length > 0 && (
        <div class="account-bar">
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
          {current && (
            <span class="account-nick" data-testid="account-nickname">
              {maskName(current.nickname, !privacy)}
            </span>
          )}
        </div>
      )}
    </header>
  );
}
