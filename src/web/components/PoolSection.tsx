import { useState } from "preact/hooks";
import { CHAR_BEGINNER, CHAR_JOINT, CHAR_STANDARD } from "../../core/analysis/config.js";
import type { PoolGroup } from "../api/types.js";
import { barWidth, fmtMonthDay, fmtShortDateRange, fmtTs } from "../lib/bar.js";
import { useMediaManifest } from "../lib/media.js";
import { Avatar, bannerFor, MiniItemTile } from "./Avatar.js";
import { HitRow } from "./HitRow.js";
import { PendingRow } from "./PendingRow.js";
import { WeaponTenRollRow } from "./WeaponTenRollRow.js";

const NO_UP_HINT_TYPES = new Set<string>([CHAR_STANDARD, CHAR_BEGINNER, "constant"]);

function poolThemeClass(group: PoolGroup): string {
  if (group.kind === "weapon") return "theme-weapon";
  if (group.poolType.includes("Rerun")) return "theme-rerun";
  if (group.poolType.includes("Standard") || group.poolType.includes("Beginner")) {
    return "theme-standard";
  }
  return "theme-limited";
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
  const hasWeaponRolls = group.kind === "weapon" && (group.weaponTenRolls?.length ?? 0) > 0;
  const [weaponView, setWeaponView] = useState<"ten" | "pity" | null>(null);
  const activeWeaponView = weaponView ?? (hasWeaponRolls ? "ten" : "pity");
  useMediaManifest();

  if (group.total === 0) return null;

  const missingUp = !group.upKnown && group.count6 > 0 && !NO_UP_HINT_TYPES.has(group.poolType);
  const dateRange = fmtShortDateRange(group.firstTs, group.lastTs);
  const bannerUrl = bannerFor(group.poolId);
  const isSharedScope =
    group.kind === "char" && group.poolType !== CHAR_JOINT;

  // 同批（gachaTs + 付费）6★ 计数（用于“十连双金/三金”丝带与金底）
  const batchGoldCounts = new Map<string, number>();
  for (const h of group.hits) {
    if (h.isFree) continue;
    const k = `${h.gachaTs}|0`;
    batchGoldCounts.set(k, (batchGoldCounts.get(k) ?? 0) + 1);
  }
  const seenMultiBatch = new Set<string>();

  const showPendingRow =
    group.pending > 0 && (group.isCurrent || !isSharedScope);

  const visibleWeaponRolls = hasWeaponRolls
    ? group.weaponTenRolls!.filter((roll) => {
        if (showFiveStar) return roll.items.length > 0;
        return roll.items.some((it) => it.isGift || it.rarity >= 6);
      })
    : [];

  const freeBatches = group.freeBatches ?? [];
  const showTenRollMode = hasWeaponRolls && activeWeaponView === "ten";
  const hasAnyRecordRow = showTenRollMode
    ? visibleWeaponRolls.length > 0
    : group.hits.length > 0 || showPendingRow || freeBatches.length > 0;

  return (
    <section class="pool-section" aria-label={group.title}>
      <div
        class={`pool-head ${poolThemeClass(group)}`}
        style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : undefined}
      >
        <div class="pool-head-backdrop" aria-hidden="true" />
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
              {group.bigPity && group.bigPity.remaining > 0 && (
                <span class="meta-pity-rem">大保底余 {group.bigPity.remaining}</span>
              )}
            </div>
          </div>

          <div class="pool-head-right">
            <div class="pool-head-actions">
              {hasWeaponRolls && (
                <button
                  type="button"
                  class="pool-link-btn"
                  onClick={() => setWeaponView(activeWeaponView === "ten" ? "pity" : "ten")}
                >
                  {activeWeaponView === "ten" ? "看水位" : "看十连"}
                </button>
              )}
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
        ) : showTenRollMode ? (
          visibleWeaponRolls.map((roll, idx) => (
            <WeaponTenRollRow
              key={`${roll.rollIndex}-${roll.gachaTs}-${idx}`}
              roll={roll}
              showFiveStar={showFiveStar}
            />
          ))
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
            {group.hits.map((hit) => {
              const bk = `${hit.gachaTs}|0`;
              const goldCnt = hit.isFree ? 0 : (batchGoldCounts.get(bk) ?? 0);
              const isFirstOfMulti = goldCnt >= 2 && !seenMultiBatch.has(bk);
              if (isFirstOfMulti) seenMultiBatch.add(bk);
              return (
                <HitRow
                  key={`${hit.seqId}-${hit.itemId}`}
                  hit={hit}
                  max={group.smallPityMax}
                  showFiveStar={showFiveStar}
                  multiGoldCount={goldCnt}
                  showRibbon={hit.isFree || isFirstOfMulti}
                />
              );
            })}
            {freeBatches.map((fb, idx) => (
              <div
                class="com-record-item"
                key={`free-${fb.gachaTs}-${idx}`}
                title={`免费批次 ${fb.size} 抽（未出 6★） · ${fmtTs(fb.gachaTs)}`}
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
                          width: `${barWidth(fb.size, group.smallPityMax)}%`,
                          backgroundColor: "var(--bar-green)",
                        }}
                        role="img"
                        aria-label={`免费十连 ${fb.size} 抽`}
                      >
                        <span class="bar-num">{fb.size}</span>
                        <span class="bar-unit">抽</span>
                      </div>
                    </div>
                  </div>
                </div>
                {showFiveStar && (
                  <div class="record-bottom">
                    <span class="record-time">{fmtMonthDay(fb.gachaTs)}</span>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
