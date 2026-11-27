import { useState } from "preact/hooks";
import { iconFor, useMediaManifest } from "../lib/media.js";

export { bannerFor, currencyIconFor, iconFor } from "../lib/media.js";

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
  useMediaManifest();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const rawIcon = itemId ? iconFor(itemId) : null;
  const icon = rawIcon && rawIcon !== failedSrc ? rawIcon : null;
  const sizeCls = size === "lg" ? "avatar-lg" : "";
  if (icon) {
    return (
      <img
        class={`avatar ${sizeCls} ${rarity === 6 ? (isUp === false ? "r6 off-tone" : "r6") : "q"}`}
        src={icon}
        alt=""
        aria-hidden="true"
        onError={() => setFailedSrc(icon)}
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
  useMediaManifest();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const rawIcon = itemId ? iconFor(itemId) : null;
  const icon = rawIcon && rawIcon !== failedSrc ? rawIcon : null;
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
        <img
          class="mini-tile-img"
          src={icon}
          alt=""
          aria-hidden="true"
          onError={() => setFailedSrc(icon)}
        />
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
