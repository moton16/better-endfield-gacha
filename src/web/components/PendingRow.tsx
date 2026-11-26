import type { SubHitSummary } from "../api/types.js";
import { barWidth, pendingTone, TONE_VAR } from "../lib/bar.js";
import { Avatar, MiniItemTile } from "./Avatar.js";

export function PendingRow({
  pending,
  max,
  showFiveStar = false,
  pendingSubHits5,
}: {
  pending: number;
  max: number;
  showFiveStar?: boolean;
  pendingSubHits5?: SubHitSummary[];
}) {
  if (pending <= 0) return null;
  const tone = pendingTone(pending, max);

  return (
    <div class="com-record-item pending-row">
      <div class="record-top">
        <Avatar name="?" rarity={0} />
        <div class="hit-col">
          <div class="barwrap">
            <div
              class={`bar stripe-${tone}`}
              style={{ width: `${barWidth(pending, max)}%`, backgroundColor: TONE_VAR[tone] }}
              role="img"
              aria-label={`当前已垫 ${pending} 抽`}
            >
              <span class="bar-num">{pending}</span>
              <span class="bar-unit">抽</span>
            </div>
          </div>
        </div>
      </div>

      {showFiveStar && pendingSubHits5 && pendingSubHits5.length > 0 && (
        <div class="record-bottom">
          <span class="record-time">至今</span>
          <div class="sub-five-list" aria-label="已垫期间五星">
            {pendingSubHits5.map((sub) => (
              <MiniItemTile
                key={`${sub.itemId}-${sub.itemName}`}
                itemId={sub.itemId}
                name={sub.itemName}
                rarity={5}
                count={sub.count}
                size="xs"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
