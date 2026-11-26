/** 预留按 itemId 解析仓库内置图标（如 icons/<itemId>.webp），当前退回首字色块 */
export function iconFor(_itemId: string): string | null {
  return null;
}

export function Avatar({
  name,
  rarity,
  itemId,
}: {
  name: string;
  rarity: number;
  itemId?: string;
}) {
  const icon = itemId ? iconFor(itemId) : null;
  if (icon) {
    return <img class="avatar" src={icon} alt="" aria-hidden="true" />;
  }
  const initial = rarity === 6 ? ([...name][0] ?? "?") : "?";
  return (
    <div class={`avatar ${rarity === 6 ? "r6" : "q"}`} aria-hidden="true">
      {initial}
    </div>
  );
}
