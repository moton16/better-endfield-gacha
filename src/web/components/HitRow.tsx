import { useState } from "preact/hooks";
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
  const [inspectOpen, setInspectOpen] = useState(false);
  const isMultiGold = !hit.isFree && multiGoldCount >= 2;
  const ribbonKind = !showRibbon
    ? null
    : hit.isFree
      ? "free"
      : isMultiGold
        ? "multi"
        : null;
  const rowTitle = `${hit.itemName}${hit.isNew ? " · NEW" : ""} · ${hit.pity} 抽${hit.isFree ? "（免费）" : ""}${hit.isUp === false ? " · 歪" : ""} · ${fmtTs(hit.gachaTs)}`;

  const isLongBar = max > 0 && hit.pity / Math.min(max, 70) >= 0.78;

  return (
    <div
      class={`com-record-item ${isMultiGold ? "continuous-ssr" : ""}`}
      title={rowTitle}
    >
      {ribbonKind && (
        <div class={`record-desc ${ribbonKind}`}>
          <span class="desc-text">
            {ribbonKind === "free" ? "免费十连" : multiGoldText(multiGoldCount)}
          </span>
        </div>
      )}

      <div
        class="record-top record-top-clickable"
        onClick={() => setInspectOpen((v) => !v)}
      >
        <Avatar name={hit.itemName} rarity={6} itemId={hit.itemId} isUp={hit.isUp} />
        <div class="hit-col">
          <div class="barwrap">
            <div
              class={`bar stripe-${hit.tone}${hit.isFree ? " has-free" : ""}`}
              style={{ width: `${barWidth(hit.pity, max)}%`, backgroundColor: TONE_VAR[hit.tone] }}
              role="img"
              aria-label={`${hit.itemName} ${hit.pity} 抽${hit.isUp === false ? "，歪" : ""}`}
            >
              <span class="bar-num">{hit.pity}</span>
              <span class="bar-unit">抽</span>
              {hit.isFree && <span class="bar-free">·免费</span>}
            </div>

            {hit.luck && <span class={`tag ${hit.luck}`}>{LUCK_LABEL[hit.luck]}</span>}

            {hit.prevPoolDiff !== undefined && hit.prevPoolDiff > 0 && (
              <span class="diff-tag">已垫{hit.prevPoolDiff}抽</span>
            )}

            {hit.isUp === false && (
              <span class={`off-stamp tone-${hit.tone}`} title="歪（未出本池 UP）">
                <svg class="stamp-ring" viewBox="0 0 34 34" aria-hidden="true">
                  <circle
                    cx="17"
                    cy="17"
                    r="14.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-dasharray="16 3 8 3"
                  />
                  <circle
                    cx="17"
                    cy="17"
                    r="11.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="0.8"
                    opacity="0.7"
                  />
                </svg>
                <span class="stamp-char">歪</span>
              </span>
            )}

            <span class={`hit-sub ${isLongBar ? "is-hidden-compact" : ""}`}>
              {hit.itemName}
              {hit.isNew ? "·NEW" : ""}
            </span>
          </div>
        </div>
      </div>

      {inspectOpen && !showFiveStar && (
        <div class="hit-inspect-line">
          <span>
            {hit.itemName}
            {hit.isNew ? " · NEW" : ""} · {fmtTs(hit.gachaTs)}
          </span>
        </div>
      )}

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
