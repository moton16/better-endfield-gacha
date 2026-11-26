import type { AccountGlobalSummary } from "../api/types.js";
import { fmtStatStartDate, type UiStatCard, type UiTab } from "../lib/bar.js";
import { BadgeRow } from "./BadgeRow.js";

export function SummaryCards({
  cards,
  globalSummary,
  activeTab,
  onSelectTab,
}: {
  cards: UiStatCard[];
  globalSummary: AccountGlobalSummary;
  activeTab: UiTab;
  onSelectTab: (tab: UiTab) => void;
}) {
  const startDateText = fmtStatStartDate(globalSummary.firstRecordTs);

  return (
    <section class="statistic-panel" aria-label="抽卡总览">
      <div class={`evalution-ribbon ${globalSummary.isLucky ? "lucky" : "normal"}`}>
        <span class="ribbon-accent-bar" aria-hidden="true" />
        <span class="ribbon-desc">
          本地
          <br />
          评分
        </span>
        <span class="ribbon-title">
          <svg class="laurel" viewBox="0 0 12 18" width="11" height="17" aria-hidden="true">
            <path
              d="M9.6 16.5C5.6 14 4.2 9.8 5.6 4.2M6.2 4.6C4.1 4.2 3 2.9 3.2 1.7C4.7 2 5.9 3.2 6.2 4.6ZM5.1 9C2.9 8.8 1.7 7.4 2 6C3.5 6.3 4.8 7.5 5.1 9ZM6 13.3C3.9 13.4 2.6 12.4 2.6 11C4.1 11 5.5 11.9 6 13.3Z"
              fill="currentColor"
              stroke="currentColor"
              stroke-width="0.9"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="ribbon-title-text">{globalSummary.ratingLabel}</span>
          <svg class="laurel" viewBox="0 0 12 18" width="11" height="17" aria-hidden="true">
            <path
              d="M2.4 16.5C6.4 14 7.8 9.8 6.4 4.2M5.8 4.6C7.9 4.2 9 2.9 8.8 1.7C7.3 2 6.1 3.2 5.8 4.6ZM6.9 9C9.1 8.8 10.3 7.4 10 6C8.5 6.3 7.2 7.5 6.9 9ZM6 13.3C8.1 13.4 9.4 12.4 9.4 11C7.9 11 6.5 11.9 6 13.3Z"
              fill="currentColor"
              stroke="currentColor"
              stroke-width="0.9"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </div>

      <div class="stat-stamp" aria-hidden="true">
        <svg class="stamp-svg" viewBox="0 0 112 56" width="112" height="56">
          <ellipse
            cx="58"
            cy="28"
            rx="47"
            ry="23"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
            stroke-dasharray="2.5 2"
          />
          <ellipse
            cx="58"
            cy="28"
            rx="43"
            ry="19"
            fill="none"
            stroke="currentColor"
            stroke-width="0.8"
          />
          <ellipse
            cx="58"
            cy="28"
            rx="37"
            ry="14.5"
            fill="none"
            stroke="currentColor"
            stroke-width="0.6"
            opacity="0.7"
          />
        </svg>
        <div class="stamp-text">
          <div>本地统计自</div>
          <div>{startDateText}</div>
        </div>
      </div>

      <div class="statistic-cards">
        {cards.map((card) => (
          <button
            key={card.tab}
            type="button"
            class={`stat-card ${activeTab === card.tab ? "is-selected" : ""}`}
            onClick={() => onSelectTab(card.tab)}
          >
            <div class="stat-top">
              <div class="stat-name">{card.label}</div>
              <div class="stat-big">
                <span class="stat-big-num">{card.total}</span>
                <span class="stat-big-unit">抽</span>
              </div>
            </div>
            <div class="stat-bottom">
              <div class="stat-col left-col">
                <div class="stat-val">
                  <span>{card.count6}</span>
                  {card.showMiss && (
                    <>
                      <span class="stat-split">/</span>
                      <span class="miss-num">{card.offBanner}</span>
                    </>
                  )}
                </div>
                <div class="stat-label-scale">
                  <span>出卡数</span>
                  {card.showMiss && (
                    <>
                      <span class="stat-split">/</span>
                      <span class="miss-label">歪</span>
                    </>
                  )}
                </div>
              </div>
              <div class="stat-col right-col">
                <div class="stat-val">{card.rightValue ?? "—"}</div>
                <div class="stat-label-scale">{card.rightLabel}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <BadgeRow globalSummary={globalSummary} />
    </section>
  );
}
