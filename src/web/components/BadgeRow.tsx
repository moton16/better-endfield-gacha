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
          <span>{b.label}</span>
          <span class="badge-cnt">x{b.count}</span>
        </span>
      ))}
      {globalLuckCounts.ou > 0 && (
        <span class="chip green">
          <span>超欧</span>
          <span class="badge-cnt">x{globalLuckCounts.ou}</span>
        </span>
      )}
      {globalLuckCounts.fei > 0 && (
        <span class="chip pink">
          <span>超非</span>
          <span class="badge-cnt">x{globalLuckCounts.fei}</span>
        </span>
      )}
    </div>
  );
}
