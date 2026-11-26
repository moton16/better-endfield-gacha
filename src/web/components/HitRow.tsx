import type { SixStarHit } from "../api/types.js";
import { barWidth, fmtTs, LUCK_LABEL, TONE_VAR } from "../lib/bar.js";
import { Avatar } from "./Avatar.js";

export function HitRow({ hit, max }: { hit: SixStarHit; max: number }) {
  return (
    <div class="row">
      <Avatar name={hit.itemName} rarity={6} itemId={hit.itemId} />
      <div class="hit-col">
        <div class="barwrap">
          <div
            class="bar"
            style={{ width: `${barWidth(hit.pity, max)}%`, background: TONE_VAR[hit.tone] }}
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
          {hit.isNew ? " · NEW" : ""} · {fmtTs(hit.gachaTs)}
        </div>
      </div>
      {hit.isUp === false && (
        <span class="off" title="歪（未出本池 UP）">
          歪
        </span>
      )}
    </div>
  );
}
