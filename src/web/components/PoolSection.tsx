import { useState } from "preact/hooks";
import { CHAR_BEGINNER, CHAR_JOINT, CHAR_STANDARD } from "../../core/analysis/config.js";
import type { PoolGroup } from "../api/types.js";
import { barWidth, fmtMonthDay, fmtShortDateRange, fmtTs, groupArsenalQuota } from "../lib/bar.js";
import { useMediaManifest } from "../lib/media.js";
import { Avatar, bannerFor, currencyIconFor, iconFor, MiniItemTile } from "./Avatar.js";
import { HitRow } from "./HitRow.js";
import { PendingRow } from "./PendingRow.js";

const NO_UP_HINT_TYPES = new Set<string>([CHAR_STANDARD, CHAR_BEGINNER, "constant"]);

function poolThemeClass(group: PoolGroup): string {
  if (group.kind === "weapon") return "theme-weapon";
  if (group.poolType.includes("Rerun")) return "theme-rerun";
  if (group.poolType.includes("Standard") || group.poolType.includes("Beginner")) {
    return "theme-standard";
  }
  return "theme-limited";
}

function resolveHeaderArt(
  group: PoolGroup,
): { url: string; kind: "char" | "weapon" | "banner" } | null {
  if (group.kind === "weapon") {
    const candidateId = group.up6Ids[0] ?? group.hits.find((h) => h.itemId)?.itemId ?? "";
    const url = candidateId ? iconFor(candidateId) : null;
    return url ? { url, kind: "weapon" } : null;
  }

  if (group.up6Ids.length > 1) {
    const banner = bannerFor(group.poolId);
    if (banner) return { url: banner, kind: "banner" };
  }

  const primaryCharId = group.up6Ids[0] ?? group.hits.find((h) => h.itemId)?.itemId ?? "";
  const charPortrait = primaryCharId ? iconFor(primaryCharId) : null;
  if (charPortrait) return { url: charPortrait, kind: "char" };

  const banner = bannerFor(group.poolId);
  return banner ? { url: banner, kind: "banner" } : null;
}

export function PoolSection({
  group,
  showFiveStar = false,
}: {
  group: PoolGroup;
  showFiveStar?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showPityHelp, setShowPityHelp] = useState(false);
  const [failedHeroUrl, setFailedHeroUrl] = useState<string | null>(null);
  const [failedArsenalUrl, setFailedArsenalUrl] = useState<string | null>(null);
  useMediaManifest();

  if (group.total === 0) return null;

  const missingUp = !group.upKnown && group.count6 > 0 && !NO_UP_HINT_TYPES.has(group.poolType);
  const dateRange = fmtShortDateRange(group.firstTs, group.lastTs);
  const hero = resolveHeaderArt(group);
  const effectiveHero = hero && hero.url !== failedHeroUrl ? hero : null;
  const arsenalQuota = groupArsenalQuota(group);
  const rawArsenalUrl = arsenalQuota !== null ? currencyIconFor("item_gachabyproducts_weapongold") : null;
  const arsenalUrl = rawArsenalUrl && rawArsenalUrl !== failedArsenalUrl ? rawArsenalUrl : null;
  const isSharedScope =
    group.kind === "char" && group.poolType !== CHAR_JOINT;

  const paidHits = group.hits.filter((h) => !h.isFree);
  const freeHits = group.hits.filter((h) => h.isFree);

  // 同批（gachaTs + 付费）6★ 计数（用于“十连双金/三金”丝带与金底）
  const batchGoldCounts = new Map<string, number>();
  for (const h of paidHits) {
    const k = `${h.gachaTs}|0`;
    batchGoldCounts.set(k, (batchGoldCounts.get(k) ?? 0) + 1);
  }
  const seenMultiBatch = new Set<string>();

  const showPendingRow =
    group.pending > 0 && (group.isCurrent || !isSharedScope);

  const freeBatches = group.freeBatches ?? [];
  type FreeEntry =
    | { kind: "hits"; gachaTs: string; hits: typeof freeHits }
    | { kind: "empty"; gachaTs: string; size: number };

  const freeEntries: FreeEntry[] = [];
  const freeHitBuckets = new Map<string, typeof freeHits>();
  for (const h of freeHits) {
    const ts = h.gachaTs || "0";
    const bucket = freeHitBuckets.get(ts);
    if (bucket) bucket.push(h);
    else freeHitBuckets.set(ts, [h]);
  }
  for (const [gachaTs, hits] of freeHitBuckets) {
    freeEntries.push({ kind: "hits", gachaTs, hits });
  }
  for (const fb of freeBatches) {
    freeEntries.push({ kind: "empty", gachaTs: fb.gachaTs || "0", size: fb.size });
  }
  freeEntries.sort((a, b) => Number(b.gachaTs) - Number(a.gachaTs));

  const hasAnyRecordRow = paidHits.length > 0 || showPendingRow || freeEntries.length > 0;

  return (
    <section class="pool-section" aria-label={group.title}>
      <div class={`pool-head ${poolThemeClass(group)}`}>
        <div class="pool-head-backdrop" aria-hidden="true" />
        {effectiveHero && (
          <div class={`pool-head-art-box kind-${effectiveHero.kind}`} aria-hidden="true">
            <img
              class={`pool-head-art kind-${effectiveHero.kind}`}
              src={effectiveHero.url}
              alt=""
              onError={() => setFailedHeroUrl(effectiveHero.url)}
            />
          </div>
        )}
        <div class="pool-head-wrapper">
          <div class="pool-head-main">
            <div class="pool-title-row">
              <h3>{group.title}</h3>
              {dateRange && <span class="pool-date">{dateRange}</span>}
              {missingUp && (
                <span
                  class="pool-warn-dot"
                  title="缺少 UP 信息，未判定歪（可在数据目录补充 up-map.override.json 或更新 src/core/data/up-map.json）"
                >
                  !
                </span>
              )}
            </div>
            <div class="pool-meta-row">
              <span class="meta-text">
                合计 <strong class="meta-num">{group.total}</strong> 抽
              </span>
              <span class="meta-pity-wrap">
                <span class="meta-text">
                  垫 <span class="meta-pity-num">{group.pending}</span>
                </span>
                <button
                  type="button"
                  class="help-dot-btn"
                  aria-label="垫抽释义"
                  aria-expanded={showPityHelp}
                  onClick={() => setShowPityHelp((v) => !v)}
                >
                  ?
                </button>
              </span>
              {arsenalQuota !== null && (
                <span
                  class="meta-award"
                  title={`本池产出武库配额：${arsenalQuota}（6★ 2000 / 5★ 200 / 4★ 20）`}
                >
                  <span class="meta-award-label">产出</span>
                  {arsenalUrl ? (
                    <img
                      class="meta-award-icon"
                      src={arsenalUrl}
                      alt="武库配额"
                      onError={() => setFailedArsenalUrl(arsenalUrl)}
                    />
                  ) : (
                    <span class="meta-award-unit">配额</span>
                  )}
                  <strong class="meta-num">{arsenalQuota}</strong>
                </span>
              )}
              {group.bigPity && group.bigPity.remaining > 0 && (
                <span class="meta-pity-rem">大保底余 {group.bigPity.remaining}</span>
              )}
            </div>
          </div>

          <div class="pool-head-right">
            <div class="pool-head-actions">
              <button
                type="button"
                class="pool-link-btn"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? "收起" : "详情"}
              </button>
            </div>

            {group.up6Ids.length > 0 && (
              <div class="pool-up-icons" aria-label="本期 UP 预览">
                {group.up6Ids.map((id, idx) => (
                  <MiniItemTile
                    key={id}
                    itemId={id}
                    name={group.hits.find((h) => h.itemId === id)?.itemName ?? `UP${idx + 1}`}
                    rarity={6}
                    size="xs"
                    bare
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showPityHelp && (
        <div class="pity-popover" role="note" aria-label="垫抽释义说明">
          <div class="pity-popover-head">
            <span>垫抽释义</span>
            <button
              type="button"
              class="pity-popover-close"
              aria-label="关闭垫抽释义"
              onClick={() => setShowPityHelp(false)}
            >
              ✕
            </button>
          </div>
          <p class="pity-popover-desc">
            额外投入 <strong class="blue-num">{group.pending}</strong>{" "}
            抽未出 6★，将作用于下一次同规则卡池保底计算，体现在下一条 6★ 的抽数中。
          </p>
        </div>
      )}

      {expanded && (
        <div class="pool-details">
          <div>
            星级分布：6★ {group.count6} · 5★ {group.count5} · 4★ {group.count4}
          </div>
          <div>
            抽数构成：付费 {group.paid} 抽 · 免费 {group.free} 抽
          </div>
          {arsenalQuota !== null && <div>武库配额产出：{arsenalQuota}</div>}
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

      <div class="pool-records-body">
        {!hasAnyRecordRow ? (
          <div class="record-empty">该卡池未抽出六星</div>
        ) : (
          <>
            {showPendingRow && (
              <PendingRow
                pending={group.pending}
                max={group.smallPityMax}
                showFiveStar={showFiveStar}
                pendingSubHits5={group.pendingSubHits5}
              />
            )}
            {paidHits.map((hit) => {
              const bk = `${hit.gachaTs}|0`;
              const goldCnt = batchGoldCounts.get(bk) ?? 0;
              const isFirstOfMulti = goldCnt >= 2 && !seenMultiBatch.has(bk);
              if (isFirstOfMulti) seenMultiBatch.add(bk);
              return (
                <HitRow
                  key={`${hit.seqId}-${hit.itemId}`}
                  hit={hit}
                  max={group.smallPityMax}
                  showFiveStar={showFiveStar}
                  multiGoldCount={goldCnt}
                  showRibbon={isFirstOfMulti}
                />
              );
            })}
            {freeEntries.map((entry, idx) =>
              entry.kind === "hits" ? (
                entry.hits.map((hit, hitIdx) => (
                  <HitRow
                    key={`${hit.seqId}-${hit.itemId}`}
                    hit={hit}
                    max={group.smallPityMax}
                    showFiveStar={showFiveStar}
                    multiGoldCount={0}
                    showRibbon={hitIdx === 0}
                  />
                ))
              ) : (
                <div
                  class="com-record-item"
                  key={`free-${entry.gachaTs}-${idx}`}
                  title={`免费十连 ${entry.size} 抽（未出 6★） · ${fmtTs(entry.gachaTs)}`}
                >
                  <div class="record-desc free-muted">
                    <span class="desc-text">免费十连</span>
                  </div>
                  <div class="record-top">
                    <Avatar name="×" rarity={0} isEmptyFree />
                    <div class="hit-col">
                      <div class="barwrap">
                        <div
                          class="bar stripe-green"
                          style={{
                            width: `${barWidth(entry.size, group.smallPityMax)}%`,
                            backgroundColor: "var(--bar-green)",
                          }}
                          role="img"
                          aria-label={`免费十连 ${entry.size} 抽`}
                        >
                          <span class="bar-num">{entry.size}</span>
                          <span class="bar-unit">抽</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {showFiveStar && (
                    <div class="record-bottom">
                      <span class="record-time">{fmtMonthDay(entry.gachaTs)}</span>
                    </div>
                  )}
                </div>
              ),
            )}
          </>
        )}
      </div>
    </section>
  );
}
