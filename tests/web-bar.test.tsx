// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import type { PoolGroup, SixStarHit, WeaponTenRoll } from "../src/web/api/types.js";
import { HitRow } from "../src/web/components/HitRow.js";
import { PendingRow } from "../src/web/components/PendingRow.js";
import { PoolSection } from "../src/web/components/PoolSection.js";
import { WeaponTenRollRow } from "../src/web/components/WeaponTenRollRow.js";
import {
  barWidth,
  fmtMonthDay,
  fmtRelativeTime,
  fmtShortDateRange,
  fmtStatStartDate,
  fmtTs,
  maskName,
  pendingTone,
  TONE_VAR,
} from "../src/web/lib/bar.js";

afterEach(() => {
  cleanup();
});

function makeHit(overrides: Partial<SixStarHit> = {}): SixStarHit {
  return {
    itemId: "chr_01",
    itemName: "测试干员",
    pity: 40,
    isFree: false,
    isNew: true,
    isUp: true,
    gachaTs: "1760000090000",
    seqId: "1001",
    tone: "yellow",
    luck: null,
    subHits5: [{ itemId: "chr_5_a", itemName: "五星甲", count: 2 }],
    ...overrides,
  };
}

function makeGroup(overrides: Partial<PoolGroup> = {}): PoolGroup {
  return {
    key: "char:E_CharacterGachaPoolType_Special:p1",
    kind: "char",
    tab: "limited",
    poolType: "E_CharacterGachaPoolType_Special",
    poolId: "p1",
    title: "测试特许池",
    total: 50,
    paid: 50,
    free: 0,
    count6: 1,
    count5: 5,
    count4: 44,
    up6Ids: ["chr_01"],
    upKnown: true,
    hits: [makeHit()],
    pending: 10,
    pendingSubHits5: [{ itemId: "chr_5_b", itemName: "五星乙", count: 1 }],
    smallPityMax: 80,
    bigPity: {
      max: 120,
      count: 50,
      remaining: 70,
      gotUp: false,
      fromOfficialCount: false,
    },
    freeBatches: [],
    isCurrent: true,
    firstTs: "1760000000000",
    lastTs: "1760000090000",
    ...overrides,
  };
}

describe("bar helpers", () => {
  it("computes barWidth with 70-capped scaling, 14% floor, and 100% cap", () => {
    expect(barWidth(0, 80)).toBe(14);
    expect(barWidth(5, 80)).toBe(14);
    expect(barWidth(35, 80)).toBe(50);
    expect(barWidth(40, 80)).toBe(57);
    expect(barWidth(70, 80)).toBe(100);
    expect(barWidth(200, 80)).toBe(100);
    expect(barWidth(20, 40)).toBe(50);
    expect(barWidth(40, 40)).toBe(100);
    expect(barWidth(10, 0)).toBe(14);
  });

  it("aligns pendingTone thresholds with core tone()", () => {
    expect(pendingTone(15, 80)).toBe("green");
    expect(pendingTone(16, 80)).toBe("yellow");
    expect(pendingTone(63, 80)).toBe("yellow");
    expect(pendingTone(64, 80)).toBe("pink");
    expect(pendingTone(32, 40)).toBe("pink");
    expect(TONE_VAR.green).toBe("var(--bar-green)");
    expect(TONE_VAR.pink).toBe("var(--bar-pink)");
  });

  it("masks names and formats timestamps and short dates", () => {
    expect(maskName("测试昵称", false)).toBe("***");
    expect(maskName("测试昵称", true)).toBe("测试昵称");
    expect(maskName("", true)).toBe("—");
    expect(fmtTs("0")).toBe("—");
    expect(fmtTs("1760000000")).toMatch(/^202\d-/);
    expect(fmtTs("1760000000000")).toMatch(/^202\d-/);
    expect(fmtMonthDay("1760000000000")).toMatch(/^\d{2}-\d{2}$/);
    expect(fmtShortDateRange("1760000000000", "1760086400000")).toMatch(/^\d{2}\.\d{2}~\d{2}\.\d{2}$/);
    expect(fmtStatStartDate(null)).toBe("暂无记录");
    expect(fmtStatStartDate("1760000000000")).toMatch(/^202\d年\d+月\d+日$/);
    expect(fmtRelativeTime(1000, 1000 + 30_000)).toBe("刚刚");
    expect(fmtRelativeTime(1000, 1000 + 5 * 60_000)).toBe("5 分钟前");
  });
});

describe("HitRow, PendingRow & WeaponTenRollRow", () => {
  it("renders 歪 stamp only when isUp===false, luck labels, multi-gold ribbon, and 5-star sub-hits", () => {
    const { container, rerender } = render(
      <HitRow
        hit={makeHit({ itemName: "常驻干员甲", pity: 76, isUp: false, tone: "pink", luck: "fei" })}
        max={80}
        showFiveStar
        multiGoldCount={2}
      />,
    );
    expect(screen.getByText("歪")).toBeTruthy();
    expect(screen.getByText("超非")).toBeTruthy();
    expect(screen.getByText("十连双金")).toBeTruthy();
    expect(container.querySelector(".continuous-ssr")).toBeTruthy();
    expect(container.querySelector(".off-stamp.tone-pink")).toBeTruthy();
    expect(screen.getByLabelText("同周期五星")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();

    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toContain("76 抽");
    expect(img.getAttribute("aria-label")).toContain("歪");
    expect((img as HTMLElement).style.width).toBe("100%");

    rerender(
      <HitRow
        hit={makeHit({ itemName: "未知干员", pity: 8, isUp: null, isFree: true, tone: "green", luck: "ou" })}
        max={80}
      />,
    );
    expect(screen.queryByText("歪")).toBeNull();
    expect(screen.getByText("免费十连")).toBeTruthy();
    expect(screen.getByText("超欧")).toBeTruthy();
    expect(screen.getByText("·免费")).toBeTruthy();
    expect(screen.queryByLabelText("同周期五星")).toBeNull();
  });

  it("hides PendingRow when pending<=0 and shows pendingSubHits5 when showFiveStar=true", () => {
    const { container, rerender } = render(<PendingRow pending={0} max={80} />);
    expect(container.firstChild).toBeNull();

    rerender(
      <PendingRow
        pending={20}
        max={80}
        showFiveStar
        pendingSubHits5={[{ itemId: "c5_x", itemName: "五星丙", count: 3 }]}
      />,
    );
    const bar = screen.getByRole("img");
    expect(bar.getAttribute("aria-label")).toContain("20 抽");
    expect((bar as HTMLElement).style.width).toBe("29%");
    expect(screen.getByText("至今")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("renders WeaponTenRollRow with 6★, 5★ gated by showFiveStar, and cyan gift badge", () => {
    const roll: WeaponTenRoll = {
      rollIndex: 3,
      gachaTs: "1760000035000",
      drawCount: 10,
      items: [
        { itemId: "w6", itemName: "专武一", rarity: 6, count: 1, isUp: true, isNew: true, isFree: false, isGift: false },
        { itemId: "w5", itemName: "五武甲", rarity: 5, count: 2, isUp: null, isNew: false, isFree: false, isGift: false },
        { itemId: "wg", itemName: "武器箱", rarity: 6, count: 1, isUp: null, isNew: false, isFree: false, isGift: true },
      ],
    };

    const { rerender } = render(<WeaponTenRollRow roll={roll} showFiveStar={false} />);
    expect(screen.getByLabelText("第 3 个十连")).toBeTruthy();
    expect(screen.getByText("赠")).toBeTruthy();
    expect(screen.getByTitle(/专武一/)).toBeTruthy();
    expect(screen.queryByTitle(/五武甲/)).toBeNull();

    rerender(<WeaponTenRollRow roll={roll} showFiveStar />);
    expect(screen.getByTitle(/五武甲/)).toBeTruthy();
  });
});

describe("PoolSection", () => {
  it("skips empty pools, toggles details & pity-help popover, and switches weapon views", () => {
    const { container, rerender } = render(<PoolSection group={makeGroup({ total: 0 })} />);
    expect(container.firstChild).toBeNull();

    rerender(
      <PoolSection
        group={makeGroup({
          upKnown: false,
          count6: 1,
          isCurrent: true,
          bigPity: { max: 120, count: 42, remaining: 78, gotUp: false, fromOfficialCount: true },
        })}
      />,
    );

    expect(screen.getByText("当前")).toBeTruthy();
    expect(screen.getByText("UP 信息缺失")).toBeTruthy();
    expect(screen.getByText(/距大保底/)).toBeTruthy();

    // Pity help popover
    expect(screen.queryByLabelText("垫抽释义说明")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "垫抽释义" }));
    expect(screen.getByLabelText("垫抽释义说明")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭垫抽释义" }));
    expect(screen.queryByLabelText("垫抽释义说明")).toBeNull();

    // Details toggle
    expect(screen.queryByText(/星级分布/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    expect(screen.getByText(/星级分布：6★ 1 · 5★ 5 · 4★ 44/)).toBeTruthy();
    expect(screen.getByText(/官方累计/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByText(/星级分布/)).toBeNull();

    // Weapon view toggle (ten-roll vs pity)
    rerender(
      <PoolSection
        group={makeGroup({
          kind: "weapon",
          tab: "weapon",
          poolType: "special",
          smallPityMax: 40,
          hits: [makeHit({ itemId: "w6", itemName: "专武一", pity: 22 })],
          weaponTenRolls: [
            {
              rollIndex: 1,
              gachaTs: "1760000010000",
              drawCount: 10,
              items: [
                { itemId: "w6", itemName: "专武一", rarity: 6, count: 1, isUp: true, isNew: true, isFree: false, isGift: false },
              ],
            },
          ],
        })}
      />,
    );
    expect(screen.getByLabelText("第 1 个十连")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "看水位" }));
    expect(screen.getByText(/专武一/)).toBeTruthy();
    expect(screen.queryByLabelText("第 1 个十连")).toBeNull();
  });
});
