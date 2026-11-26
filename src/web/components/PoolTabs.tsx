import { UI_TAB_META, type UiTab } from "../lib/bar.js";

export function PoolTabs({
  active,
  onChange,
  showFiveStar,
  onToggleFiveStar,
}: {
  active: UiTab;
  onChange: (tab: UiTab) => void;
  showFiveStar: boolean;
  onToggleFiveStar: () => void;
}) {
  return (
    <div class="record-selector">
      <div class="tabs" role="tablist" aria-label="卡池分类">
        {UI_TAB_META.map((t) => (
          <button
            key={t.tab}
            type="button"
            role="tab"
            aria-selected={active === t.tab}
            onClick={() => onChange(t.tab)}
          >
            {t.tabLabel}
          </button>
        ))}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={showFiveStar}
        aria-label="展示五星"
        class="toggle-five-btn"
        onClick={onToggleFiveStar}
      >
        <span class="toggle-text">展示五星</span>
        <span class={`toggle-track ${showFiveStar ? "active" : ""}`} aria-hidden="true">
          <span class="toggle-thumb" />
        </span>
      </button>
    </div>
  );
}
