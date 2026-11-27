import { useState } from "preact/hooks";
import type { AccountGlobalSummary, AccountSummary } from "../api/types.js";
import { fmtCompactCost, maskName, type UiCostSummary } from "../lib/bar.js";
import { currencyIconFor, resolveAccountAvatarUrl, useMediaManifest } from "../lib/media.js";

const AVATAR_KEY_PREFIX = "beg.avatar.";

export function readStoredAvatar(accountKey: string): string {
  if (!accountKey) return "";
  try {
    return localStorage.getItem(`${AVATAR_KEY_PREFIX}${accountKey}`) ?? "";
  } catch {
    return "";
  }
}

export function writeStoredAvatar(accountKey: string, avatar: string): void {
  if (!accountKey) return;
  try {
    const key = `${AVATAR_KEY_PREFIX}${accountKey}`;
    if (avatar) {
      localStorage.setItem(key, avatar);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // 忽略受限环境下的 localStorage 异常
  }
}

export function Header({
  accounts,
  accountKey,
  onAccountChange,
  privacy,
  onTogglePrivacy,
  onOpenSync,
  onOpenData,
  onOpenAvatarPicker,
  mock,
  globalSummary,
  costSummary,
  onToast,
}: {
  accounts: AccountSummary[];
  accountKey: string;
  onAccountChange: (key: string) => void;
  privacy: boolean;
  onTogglePrivacy: () => void;
  onOpenSync: () => void;
  onOpenData: () => void;
  onOpenAvatarPicker: () => void;
  mock: boolean;
  globalSummary?: AccountGlobalSummary | null;
  costSummary?: UiCostSummary | null;
  onToast?: (msg: string) => void;
}) {
  useMediaManifest();
  const current = accounts.find((a) => a.accountKey === accountKey);
  const totalDraws = globalSummary?.totalDraws ?? current?.counts.draws ?? 0;
  const charCost = costSummary?.charCost ?? 0;
  const weaponCost = costSummary?.weaponCost ?? 0;
  const uidDisplay = current ? (privacy ? current.maskedKey : current.accountKey.slice(-10)) : "";
  const rawAvatar = current ? (current.avatar || readStoredAvatar(current.accountKey)) : "";
  const avatarUrl = !privacy && rawAvatar ? resolveAccountAvatarUrl(rawAvatar) : null;
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const effectiveAvatarUrl = avatarUrl && avatarUrl !== failedAvatarUrl ? avatarUrl : null;
  const rawDiamondUrl = currencyIconFor("item_diamond");
  const rawArsenalUrl = currencyIconFor("item_gachabyproducts_weapongold");
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const diamondUrl = rawDiamondUrl && !failedUrls.includes(rawDiamondUrl) ? rawDiamondUrl : null;
  const arsenalUrl = rawArsenalUrl && !failedUrls.includes(rawArsenalUrl) ? rawArsenalUrl : null;
  const markFailed = (url: string) =>
    setFailedUrls((prev) => (prev.includes(url) ? prev : [...prev, url]));

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
            <button
              type="button"
              class="header-avatar"
              aria-label="更换头像"
              title="点击更换头像"
              onClick={onOpenAvatarPicker}
            >
              <span class="header-avatar-inner">
                {privacy ? (
                  "终"
                ) : effectiveAvatarUrl ? (
                  <img
                    class="header-avatar-img"
                    src={effectiveAvatarUrl}
                    alt=""
                    onError={() => setFailedAvatarUrl(effectiveAvatarUrl)}
                  />
                ) : (
                  [...current.nickname][0] ?? "终"
                )}
              </span>
            </button>

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
            <div class="strip-block strip-cost-block">
              <span class="strip-label">总消耗</span>
              <span class="strip-item" title={`嵌晶玉消耗估算：${charCost}`}>
                {diamondUrl ? (
                  <img
                    class="strip-currency-icon"
                    src={diamondUrl}
                    alt="嵌晶玉"
                    onError={() => markFailed(diamondUrl)}
                  />
                ) : (
                  <span class="strip-label-sm">嵌晶玉</span>
                )}
                <span class="strip-val">{fmtCompactCost(charCost)}</span>
              </span>
              <span class="strip-item" title={`武库配额消耗估算：${weaponCost}`}>
                {arsenalUrl ? (
                  <img
                    class="strip-currency-icon"
                    src={arsenalUrl}
                    alt="武库配额"
                    onError={() => markFailed(arsenalUrl)}
                  />
                ) : (
                  <span class="strip-label-sm">武库配额</span>
                )}
                <span class="strip-val">{fmtCompactCost(weaponCost)}</span>
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
