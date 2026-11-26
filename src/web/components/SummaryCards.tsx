import type { AccountAnalysis, Tab } from "../api/types.js";

const CARDS: ReadonlyArray<{
  tab: Extract<Tab, "limited" | "weapon" | "standard">;
  label: string;
  rightMode: "up" | "pity";
}> = [
  { tab: "limited", label: "限定角色", rightMode: "up" },
  { tab: "weapon", label: "武器申领", rightMode: "up" },
  { tab: "standard", label: "常驻池", rightMode: "pity" },
];

export function SummaryCards({
  overview,
  activeTab,
  onSelectTab,
}: {
  overview: AccountAnalysis["overview"];
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
}) {
  return (
    <section class="summary" aria-label="抽卡总览">
      {CARDS.map((card) => {
        const ov = overview[card.tab];
        const rightValue = card.rightMode === "up" ? ov.avgCostPerUp : ov.avgPity6;
        const rightLabel = card.rightMode === "up" ? "平均每UP" : "六星平均";
        return (
          <button
            key={card.tab}
            type="button"
            class={`card summary-card ${activeTab === card.tab ? "active" : ""}`}
            onClick={() => onSelectTab(card.tab)}
          >
            <div>
              <div class="summary-title">{card.label}</div>
              <div class="big">
                {ov.total}
                <small>抽</small>
              </div>
            </div>
            <div class="sub">
              <div>
                <b>
                  {ov.count6} / <span class="off-num">{ov.offBanner}</span>
                </b>
                <span>出卡数 / 歪</span>
              </div>
              <div>
                <b>{rightValue ?? "—"}</b>
                <span>{rightLabel}</span>
              </div>
            </div>
          </button>
        );
      })}
    </section>
  );
}
