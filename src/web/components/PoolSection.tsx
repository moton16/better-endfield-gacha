import { useState } from "preact/hooks";
import { CHAR_BEGINNER, CHAR_STANDARD } from "../../core/analysis/config.js";
import type { PoolGroup } from "../api/types.js";
import { fmtTs } from "../lib/bar.js";
import { HitRow } from "./HitRow.js";
import { PendingRow } from "./PendingRow.js";

const NO_UP_HINT_TYPES = new Set<string>([CHAR_STANDARD, CHAR_BEGINNER, "constant"]);

export function PoolSection({ group }: { group: PoolGroup }) {
  const [expanded, setExpanded] = useState(false);

  if (group.total === 0) return null;

  const missingUp = !group.upKnown && group.count6 > 0 && !NO_UP_HINT_TYPES.has(group.poolType);

  return (
    <section class="pool-section card" aria-label={group.title}>
      <div class="pool-head">
        <div class="pool-head-main">
          <div class="pool-title-row">
            <h3>{group.title}</h3>
            {group.isCurrent && <span class="pill current">当前</span>}
            {missingUp && <span class="pill warn">UP 信息缺失</span>}
          </div>
          <div class="meta">
            合计 {group.total} 抽 · 垫 {group.pending} 抽
            {group.bigPity ? ` · 距大保底 ${group.bigPity.remaining} 抽` : ""}
          </div>
        </div>
        <button
          type="button"
          class="pool-detail-btn"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起" : "详情"}
        </button>
      </div>

      {expanded && (
        <div class="pool-details">
          <div>
            星级分布：6★ {group.count6} · 5★ {group.count5} · 4★ {group.count4}
          </div>
          <div>
            抽数构成：付费 {group.paid} 抽 · 免费 {group.free} 抽
          </div>
          <div>
            时间范围：{fmtTs(group.firstTs)} ~ {fmtTs(group.lastTs)}
          </div>
          {group.bigPity && (
            <div>
              大保底进度：{group.bigPity.count} / {group.bigPity.max}
              {group.bigPity.gotUp ? "（已获本期 UP）" : ""}
              {group.bigPity.fromOfficialCount ? " · 官方累计" : ""}
            </div>
          )}
        </div>
      )}

      {(group.isCurrent || group.pending > 0) && (
        <PendingRow pending={group.pending} max={group.smallPityMax} />
      )}
      {group.hits.map((hit) => (
        <HitRow key={`${hit.seqId}-${hit.itemId}`} hit={hit} max={group.smallPityMax} />
      ))}
    </section>
  );
}
