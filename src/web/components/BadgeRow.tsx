import type { AccountGlobalSummary } from "../api/types.js";

export function BadgeRow({ globalSummary }: { globalSummary: AccountGlobalSummary }) {
  const { globalBadges, globalLuckCounts } = globalSummary;
  if (
    globalBadges.length === 0 &&
    globalLuckCounts.ou === 0 &&
    globalLuckCounts.fei === 0
  ) {
    return null;
  }

  return (
    <div class="badges" aria-label="欧非与特殊徽章">
      {globalBadges.map((b) => (
        <span key={b.id} class={`chip ${b.id === "double_gold" ? "green" : "pink"}`}>
          {b.label} ×{b.count}
        </span>
      ))}
      {globalLuckCounts.ou > 0 && <span class="chip green">超欧 ×{globalLuckCounts.ou}</span>}
      {globalLuckCounts.fei > 0 && <span class="chip pink">超非 ×{globalLuckCounts.fei}</span>}
    </div>
  );
}
