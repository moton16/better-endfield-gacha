import type { Tab } from "../api/types.js";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "limited", label: "限定池" },
  { id: "weapon", label: "武器池" },
  { id: "standard", label: "常驻池" },
  { id: "beginner", label: "启程池" },
];

export function PoolTabs({
  active,
  onChange,
  showFiveStar,
  onToggleFiveStar,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
  showFiveStar: boolean;
  onToggleFiveStar: () => void;
}) {
  return (
    <div class="record-selector">
      <div class="tabs" role="tablist" aria-label="卡池分类">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            onClick={() => onChange(t.id)}
          >
            {t.label}
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
