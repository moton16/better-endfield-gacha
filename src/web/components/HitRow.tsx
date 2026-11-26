import type { SixStarHit } from "../api/types.js";
import { barWidth, fmtMonthDay, fmtTs, LUCK_LABEL, TONE_VAR } from "../lib/bar.js";
import { Avatar, MiniItemTile } from "./Avatar.js";

const CN_DIGITS = ["零", "一", "双", "三", "四", "五", "六", "七", "八", "九", "十"];

function multiGoldText(count: number): string {
  return `十连${CN_DIGITS[count] ?? count}金`;
}

export function HitRow({
  hit,
  max,
  showFiveStar = false,
  multiGoldCount = 0,
  showRibbon = true,
}: {
  hit: SixStarHit;
  max: number;
  showFiveStar?: boolean;
  multiGoldCount?: number;
  showRibbon?: boolean;
}) {
  const isMultiGold = !hit.isFree && multiGoldCount >= 2;
  const ribbonKind = !showRibbon
    ? null
    : hit.isFree
      ? "free"
      : isMultiGold
        ? "multi"
        : null;

  return (
    <div class={`com-record-item ${isMultiGold ? "continuous-ssr" : ""}`}>
      {ribbonKind && (
        <div class={`record-desc ${ribbonKind}`}>
          <svg
            class="ribbon-shape"
            viewBox="0 0 96 18"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d="M0 0H88L80 18H0V0Z" />
          </svg>
          <span class="desc-text">
            {ribbonKind === "free" ? "免费十连" : multiGoldText(multiGoldCount)}
          </span>
        </div>
      )}

      <div class="record-top">
        <Avatar name={hit.itemName} rarity={6} itemId={hit.itemId} isUp={hit.isUp} />
        <div class="hit-col">
          <div class="barwrap">
            <div
              class={`bar stripe-${hit.tone}${hit.isFree ? " has-free" : ""}`}
              style={{ width: `${barWidth(hit.pity, max)}%`, backgroundColor: TONE_VAR[hit.tone] }}
              role="img"
              aria-label={`${hit.itemName} ${hit.pity} 抽${hit.isUp === false ? "，歪" : ""}`}
            >
              {hit.pity}
              <small>抽</small>
              {hit.isFree && <small>·免费</small>}
            </div>
            {hit.luck && <span class={`tag ${hit.luck}`}>{LUCK_LABEL[hit.luck]}</span>}
          </div>
          <div class="hit-sub">
            {hit.itemName}
            {hit.isNew ? " · NEW" : ""}
            {!showFiveStar ? ` · ${fmtTs(hit.gachaTs)}` : ""}
          </div>
        </div>
        {hit.isUp === false && (
          <span class={`off-stamp tone-${hit.tone}`} title="歪（未出本池 UP）">
            <svg class="stamp-ring" viewBox="0 0 36 36" aria-hidden="true">
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-dasharray="18 3 9 3"
              />
              <circle
                cx="18"
                cy="18"
                r="12.5"
                fill="none"
                stroke="currentColor"
                stroke-width="0.9"
                opacity="0.7"
              />
            </svg>
            <span class="stamp-char">歪</span>
          </span>
        )}
      </div>

      {showFiveStar && (
        <div class="record-bottom">
          <span class="record-time">{fmtMonthDay(hit.gachaTs)}</span>
          <div class="sub-five-list" aria-label="同周期五星">
            {hit.subHits5 && hit.subHits5.length > 0 ? (
              hit.subHits5.map((sub) => (
                <MiniItemTile
                  key={`${sub.itemId}-${sub.itemName}`}
                  itemId={sub.itemId}
                  name={sub.itemName}
                  rarity={5}
                  count={sub.count}
                  size="xs"
                />
              ))
            ) : (
              <span class="sub-five-empty">周期内无 5★</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
