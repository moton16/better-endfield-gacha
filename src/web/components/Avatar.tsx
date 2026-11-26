/** 预留按 itemId 解析仓库内置图标（如 icons/<itemId>.webp），当前退回首字色块 */
export function iconFor(_itemId: string): string | null {
  return null;
}

/** 预留按 poolId 解析仓库内置卡池头图（如 banners/<poolId>.webp），当前退回渐变纹样 */
export function bannerFor(_poolId: string): string | null {
  return null;
}

export function Avatar({
  name,
  rarity,
  itemId,
  isUp,
  isEmptyFree = false,
  size = "md",
}: {
  name: string;
  rarity: number;
  itemId?: string;
  isUp?: boolean | null;
  isEmptyFree?: boolean;
  size?: "md" | "lg";
}) {
  const icon = itemId ? iconFor(itemId) : null;
  const sizeCls = size === "lg" ? "avatar-lg" : "";
  if (icon) {
    return (
      <img
        class={`avatar ${sizeCls} ${rarity === 6 ? "r6" : "q"}`}
        src={icon}
        alt=""
        aria-hidden="true"
      />
    );
  }
  const initial = isEmptyFree ? "×" : rarity >= 5 ? ([...name][0] ?? "?") : "?";
  const toneCls = isEmptyFree
    ? "q free-x"
    : rarity === 6
      ? isUp === false
        ? "r6 off-tone"
        : "r6"
      : rarity === 5
        ? "r5"
        : "q";
  return (
    <div class={`avatar ${sizeCls} ${toneCls}`} aria-hidden="true">
      <span>{initial}</span>
    </div>
  );
}

export function MiniItemTile({
  itemId,
  name,
  rarity,
  count,
  isGift = false,
  isUp = null,
  size = "sm",
  bare = false,
}: {
  itemId?: string;
  name: string;
  rarity: number;
  count?: number;
  isGift?: boolean;
  isUp?: boolean | null;
  size?: "xs" | "sm" | "md";
  bare?: boolean;
}) {
  const icon = itemId ? iconFor(itemId) : null;
  const initial = [...(name || itemId || "?")][0] ?? "?";
  const rankCls = bare ? "tile-neutral" : isGift || rarity >= 6 ? "tile-ssr" : "tile-sr";
  const sizeCls = `tile-${size}`;
  const titleText = `${name || itemId}${count && count > 1 ? ` ×${count}` : ""}${isGift ? "（赠品）" : isUp === false ? "（歪）" : ""}`;

  const hasBadge = isGift || (count !== undefined && count > 0);
  return (
    <div
      class={`mini-tile ${sizeCls} ${rankCls} ${hasBadge ? "has-badge" : ""}`}
      title={titleText}
      aria-label={titleText}
    >
      {icon ? (
        <img class="mini-tile-img" src={icon} alt="" aria-hidden="true" />
      ) : (
        <span class="mini-tile-char" aria-hidden="true">
          {initial}
        </span>
      )}
      {isGift ? (
        <span class="tile-corner-gift">赠</span>
      ) : (
        count !== undefined && count > 0 && <span class="tile-corner-cnt">{count}</span>
      )}
      {!isGift && isUp === false && <span class="tile-corner-off" aria-hidden="true" />}
    </div>
  );
}
