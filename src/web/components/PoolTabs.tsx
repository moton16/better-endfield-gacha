import type { Tab } from "../api/types.js";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "limited", label: "限定角色" },
  { id: "weapon", label: "武器申领" },
  { id: "standard", label: "常驻" },
  { id: "beginner", label: "启程" },
];

export function PoolTabs({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
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
  );
}
