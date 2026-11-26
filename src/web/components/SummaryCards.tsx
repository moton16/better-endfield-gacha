import type { AccountAnalysis, AccountGlobalSummary, Tab } from "../api/types.js";
import { fmtStatStartDate } from "../lib/bar.js";
import { BadgeRow } from "./BadgeRow.js";

const CARDS: ReadonlyArray<{
  tab: Tab;
  label: string;
  showMiss: boolean;
}> = [
  { tab: "limited", label: "限定角色", showMiss: true },
  { tab: "weapon", label: "武器申领", showMiss: true },
  { tab: "standard", label: "常驻池", showMiss: false },
  { tab: "beginner", label: "启程池", showMiss: false },
];

export function SummaryCards({
  overview,
  globalSummary,
  activeTab,
  onSelectTab,
}: {
  overview: AccountAnalysis["overview"];
  globalSummary: AccountGlobalSummary;
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
}) {
  const startDateText = fmtStatStartDate(globalSummary.firstRecordTs);

  return (
    <section class="statistic-panel" aria-label="抽卡总览">
      <div class={`evalution-ribbon ${globalSummary.isLucky ? "lucky" : "normal"}`}>
        <svg
          class="ribbon-bg"
          viewBox="0 0 210 34"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M0 0H202L190 34H0V0Z" />
        </svg>
        <div class="ribbon-content">
          <span class="ribbon-desc">
            本地
            <br />
            评分
          </span>
          <span class="ribbon-title">
            <svg class="laurel" viewBox="0 0 14 20" width="12" height="17" aria-hidden="true">
              <path
                d="M11 18C6.2 15.2 4.5 10.6 6.2 4.5M7 5.2C4.5 4.8 3.2 3.2 3.5 1.8C5.2 2.1 6.7 3.5 7 5.2ZM5.8 10C3.2 9.8 1.8 8.2 2.1 6.6C3.9 6.9 5.4 8.3 5.8 10ZM6.8 14.6C4.4 14.8 2.8 13.6 2.8 12C4.6 12 6.2 13 6.8 14.6Z"
                fill="currentColor"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="ribbon-title-text">{globalSummary.ratingLabel}</span>
            <svg class="laurel" viewBox="0 0 14 20" width="12" height="17" aria-hidden="true">
              <path
                d="M3 18C7.8 15.2 9.5 10.6 7.8 4.5M7 5.2C9.5 4.8 10.8 3.2 10.5 1.8C8.8 2.1 7.3 3.5 7 5.2ZM8.2 10C10.8 9.8 12.2 8.2 11.9 6.6C10.1 6.9 8.6 8.3 8.2 10ZM7.2 14.6C9.6 14.8 11.2 13.6 11.2 12C9.4 12 7.8 13 7.2 14.6Z"
                fill="currentColor"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </div>
      </div>

      <div class="stat-stamp" aria-hidden="true">
        <svg class="stamp-svg" viewBox="0 0 116 56" width="116" height="56">
          <ellipse
            cx="62"
            cy="26"
            rx="46"
            ry="22"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-dasharray="4 2"
          />
          <ellipse
            cx="62"
            cy="26"
            rx="40"
            ry="17"
            fill="none"
            stroke="currentColor"
            stroke-width="0.9"
          />
        </svg>
        <div class="stamp-text">
          <div>本地统计自</div>
          <div>{startDateText}</div>
        </div>
      </div>

      <div class="statistic-cards">
        {CARDS.map((card) => {
          const ov = overview[card.tab];
          const rightValue = card.showMiss ? ov.avgCostPerUp : ov.avgPity6;
          const rightLabel = card.showMiss ? "平均每UP" : "六星平均";
          return (
            <button
              key={card.tab}
              type="button"
              class={`stat-card ${activeTab === card.tab ? "active" : ""}`}
              onClick={() => onSelectTab(card.tab)}
            >
              <div class="stat-top">
                <div class="stat-name">{card.label}</div>
                <div class="stat-big">
                  <span class="stat-big-num">{ov.total}</span>
                  <span class="stat-big-unit">抽</span>
                </div>
              </div>
              <div class="stat-bottom">
                <div class="stat-col">
                  <div class="stat-val">
                    <span>{ov.count6}</span>
                    {card.showMiss && (
                      <>
                        <span class="stat-split">/</span>
                        <span class="miss-num">{ov.offBanner}</span>
                      </>
                    )}
                  </div>
                  <div class="stat-label">
                    <span>出卡数</span>
                    {card.showMiss && (
                      <>
                        <span class="stat-split">/</span>
                        <span class="miss-label">歪</span>
                      </>
                    )}
                  </div>
                </div>
                <div class="stat-col">
                  <div class="stat-val">{rightValue ?? "—"}</div>
                  <div class="stat-label">{rightLabel}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <BadgeRow globalSummary={globalSummary} />
    </section>
  );
}
