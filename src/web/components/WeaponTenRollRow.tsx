import type { WeaponTenRoll } from "../api/types.js";
import { MiniItemTile } from "./Avatar.js";

export function WeaponTenRollRow({
  roll,
  showFiveStar,
}: {
  roll: WeaponTenRoll;
  showFiveStar: boolean;
}) {
  const nonGifts = roll.items.filter((it) => !it.isGift);
  const gifts = roll.items.filter((it) => it.isGift);
  const ssrItems = nonGifts.filter((it) => it.rarity >= 6);
  const srItems = nonGifts.filter((it) => it.rarity === 5);
  const visibleItems = showFiveStar ? [...ssrItems, ...srItems] : ssrItems;
  const srTotalCount = srItems.reduce((s, it) => s + it.count, 0);
  const needsFade = visibleItems.length >= 6;

  return (
    <div
      class={`weapon-ten-roll-item ${gifts.length > 0 ? "has-free-weapon" : ""}`}
      aria-label={roll.rollIndex > 0 ? `第 ${roll.rollIndex} 个十连` : "武器赠品"}
    >
      <div class={`weapon-avatar-viewport ${needsFade ? "weapon-avatar-viewport-fade" : ""}`}>
        {visibleItems.length > 0 ? (
          <div class="weapon-avatar-list">
            {visibleItems.map((it) => (
              <MiniItemTile
                key={`${it.itemId}-${it.itemName}-${it.rarity}`}
                itemId={it.itemId}
                name={it.itemName}
                rarity={it.rarity}
                count={it.count}
                isUp={it.isUp}
                size="md"
              />
            ))}
          </div>
        ) : (
          <div class="weapon-no-ssr">
            {gifts.length > 0
              ? "赠品领取"
              : srTotalCount > 0
                ? `无六星 · 含 ${srTotalCount} 把五星`
                : `共 ${roll.drawCount} 抽（无 5★/6★）`}
          </div>
        )}
      </div>

      {roll.rollIndex > 0 && (
        <div class="weapon-ten-roll-tag">
          第 <span class="weapon-ten-roll-value">{roll.rollIndex}</span> 个十连
        </div>
      )}

      {gifts.length > 0 && (
        <div class="weapon-gift-list">
          {gifts.map((g) => (
            <MiniItemTile
              key={`gift-${g.itemId}-${g.itemName}`}
              itemId={g.itemId}
              name={g.itemName}
              rarity={g.rarity}
              count={g.count}
              isGift
              size="md"
            />
          ))}
        </div>
      )}
    </div>
  );
}
