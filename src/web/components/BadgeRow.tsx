import type { TabOverview } from "../api/types.js";

export function BadgeRow({ overview }: { overview: TabOverview }) {
  const { badges, luckCounts } = overview;
  if (badges.length === 0 && luckCounts.ou === 0 && luckCounts.fei === 0) {
    return null;
  }

  return (
    <div class="badges" aria-label="欧非与特殊徽章">
      {badges.map((b) => (
        <span key={b.id} class={`chip ${b.id === "double_gold" ? "green" : "pink"}`}>
          {b.label} ×{b.count}
        </span>
      ))}
      {luckCounts.ou > 0 && <span class="chip green">超欧 ×{luckCounts.ou}</span>}
      {luckCounts.fei > 0 && <span class="chip pink">超非 ×{luckCounts.fei}</span>}
    </div>
  );
}
