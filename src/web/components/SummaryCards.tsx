import { useEffect, useRef, useState } from "preact/hooks";
import type { AccountGlobalSummary } from "../api/types.js";
import { fmtStatStartDate, type UiStatCard, type UiTab } from "../lib/bar.js";
import { BadgeRow } from "./BadgeRow.js";

function LaurelSprig({ mirror = false }: { mirror?: boolean }) {
  return (
    <svg class="laurel" viewBox="0 0 24 38" width="12" height="19" aria-hidden="true">
      <g transform={mirror ? "translate(24, 0) scale(-1, 1)" : undefined}>
        <path
          d="M17 34C8.5 26.5 7 12.5 16.5 4.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
        <ellipse cx="16.6" cy="4.6" rx="1.65" ry="3.3" transform="rotate(26 16.6 4.6)" fill="currentColor" />
        <ellipse cx="8.6" cy="9.4" rx="1.55" ry="3.1" transform="rotate(-22 8.6 9.4)" fill="currentColor" />
        <ellipse cx="5.6" cy="16.2" rx="1.6" ry="3.2" transform="rotate(-44 5.6 16.2)" fill="currentColor" />
        <ellipse cx="6.2" cy="23.4" rx="1.6" ry="3.1" transform="rotate(-64 6.2 23.4)" fill="currentColor" />
        <ellipse cx="10.2" cy="29.4" rx="1.5" ry="2.9" transform="rotate(-76 10.2 29.4)" fill="currentColor" />
        <ellipse cx="13.8" cy="11.2" rx="1.3" ry="2.5" transform="rotate(14 13.8 11.2)" fill="currentColor" />
        <ellipse cx="11.8" cy="18.2" rx="1.35" ry="2.6" transform="rotate(4 11.8 18.2)" fill="currentColor" />
        <ellipse cx="12.6" cy="25.2" rx="1.3" ry="2.5" transform="rotate(-12 12.6 25.2)" fill="currentColor" />
      </g>
    </svg>
  );
}

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
  const trackRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const dragState = useRef<{ active: boolean; startX: number; startScroll: number; moved: boolean }>({
    active: false,
    startX: 0,
    startScroll: 0,
    moved: false,
  });
  const [pageIdx, setPageIdx] = useState(0);

  useEffect(() => {
    const idx = cards.findIndex((c) => c.tab === activeTab);
    if (idx < 0 || cards.length <= 3) return;
    const nextPage = idx >= 3 ? 1 : 0;
    setPageIdx(nextPage);
    const el = trackRef.current;
    if (el) {
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      const targetLeft = nextPage === 0 ? 0 : maxScroll;
      if (typeof el.scrollTo === "function") {
        el.scrollTo({ left: targetLeft, behavior: "auto" });
      } else {
        el.scrollLeft = targetLeft;
      }
    }
  }, [activeTab, cards]);

  function handleTrackScroll() {
    const el = trackRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 1) return;
    setPageIdx(el.scrollLeft > maxScroll * 0.45 ? 1 : 0);
  }

  function scrollToPage(target: number) {
    const el = trackRef.current;
    setPageIdx(target);
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const left = target === 0 ? 0 : maxScroll;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ left, behavior: "smooth" });
    } else {
      el.scrollLeft = left;
    }
  }

  function handleTrackWheel(e: WheelEvent) {
    const el = trackRef.current;
    if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && e.deltaY !== 0) {
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }

  function handlePointerDown(e: PointerEvent) {
    const el = trackRef.current;
    if (!el) return;
    dragState.current = {
      active: true,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
    };
  }

  function handlePointerMove(e: PointerEvent) {
    const st = dragState.current;
    const el = trackRef.current;
    if (!st.active || !el) return;
    const dx = e.clientX - st.startX;
    if (Math.abs(dx) >= 5) st.moved = true;
    if (st.moved) {
      el.scrollLeft = st.startScroll - dx;
    }
  }

  function handlePointerEnd() {
    dragState.current.active = false;
  }

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
          <LaurelSprig />
          <span class="ribbon-title-text">{globalSummary.ratingLabel}</span>
          <LaurelSprig mirror />
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

      <div
        ref={trackRef}
        class="statistic-cards"
        onScroll={handleTrackScroll}
        onWheel={handleTrackWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        {cards.map((card, idx) => (
          <button
            key={card.tab}
            ref={(node) => {
              cardRefs.current[idx] = node;
            }}
            type="button"
            class={`stat-card ${activeTab === card.tab ? "is-selected" : ""}`}
            onClick={() => {
              if (dragState.current.moved) {
                dragState.current.moved = false;
                return;
              }
              onSelectTab(card.tab);
            }}
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

      {cards.length > 3 && (
        <div class="stat-pager" aria-label="切换总览卡页">
          <button
            type="button"
            class="stat-pager-arrow"
            aria-label="上一页"
            disabled={pageIdx === 0}
            onClick={() => scrollToPage(0)}
          >
            ‹
          </button>
          <button
            type="button"
            class={`stat-pager-dot ${pageIdx === 0 ? "active" : ""}`}
            aria-label="查看限定/复刻/武器"
            onClick={() => scrollToPage(0)}
          />
          <button
            type="button"
            class={`stat-pager-dot ${pageIdx === 1 ? "active" : ""}`}
            aria-label="查看庆典/基准"
            onClick={() => scrollToPage(1)}
          />
          <button
            type="button"
            class="stat-pager-arrow"
            aria-label="下一页"
            disabled={pageIdx === 1}
            onClick={() => scrollToPage(1)}
          >
            ›
          </button>
        </div>
      )}

      <BadgeRow globalSummary={globalSummary} />
    </section>
  );
}
