// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import type { PoolGroup, SixStarHit } from "../src/web/api/types.js";
import { HitRow } from "../src/web/components/HitRow.js";
import { PendingRow } from "../src/web/components/PendingRow.js";
import { PoolSection } from "../src/web/components/PoolSection.js";
import {
  barWidth,
  fmtRelativeTime,
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
  it("computes barWidth with 14% floor and 100% cap", () => {
    expect(barWidth(0, 80)).toBe(14);
    expect(barWidth(5, 80)).toBe(14);
    expect(barWidth(40, 80)).toBe(50);
    expect(barWidth(200, 80)).toBe(100);
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

  it("masks names when show=false and formats timestamps", () => {
    expect(maskName("测试昵称", false)).toBe("***");
    expect(maskName("测试昵称", true)).toBe("测试昵称");
    expect(maskName("", true)).toBe("—");
    expect(fmtTs("0")).toBe("—");
    expect(fmtTs("1760000000")).toMatch(/^202\d-/);
    expect(fmtTs("1760000000000")).toMatch(/^202\d-/);
    expect(fmtRelativeTime(1000, 1000 + 30_000)).toBe("刚刚");
    expect(fmtRelativeTime(1000, 1000 + 5 * 60_000)).toBe("5 分钟前");
  });
});

describe("HitRow & PendingRow", () => {
  it("renders 歪 badge only when isUp===false and shows luck labels", () => {
    const { rerender } = render(
      <HitRow
        hit={makeHit({ itemName: "常驻干员甲", pity: 76, isUp: false, tone: "pink", luck: "fei" })}
        max={80}
      />,
    );
    expect(screen.getByText("歪")).toBeTruthy();
    expect(screen.getByText("超非")).toBeTruthy();
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toContain("76 抽");
    expect(img.getAttribute("aria-label")).toContain("歪");
    expect((img as HTMLElement).style.width).toBe("95%");

    rerender(
      <HitRow
        hit={makeHit({ itemName: "未知干员", pity: 8, isUp: null, isFree: true, tone: "green", luck: "ou" })}
        max={80}
      />,
    );
    expect(screen.queryByText("歪")).toBeNull();
    expect(screen.getByText("超欧")).toBeTruthy();
    expect(screen.getByText("·免费")).toBeTruthy();
  });

  it("hides PendingRow when pending<=0 and renders when pending>0", () => {
    const { container, rerender } = render(<PendingRow pending={0} max={80} />);
    expect(container.firstChild).toBeNull();

    rerender(<PendingRow pending={20} max={80} />);
    const bar = screen.getByRole("img");
    expect(bar.getAttribute("aria-label")).toContain("20 抽");
    expect((bar as HTMLElement).style.width).toBe("25%");
  });
});

describe("PoolSection", () => {
  it("skips empty pools, shows 当前 and bigPity remaining, and toggles details", () => {
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
    expect(screen.getByText(/距大保底 78 抽/)).toBeTruthy();

    expect(screen.queryByText(/星级分布/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    expect(screen.getByText(/星级分布：6★ 1 · 5★ 5 · 4★ 44/)).toBeTruthy();
    expect(screen.getByText(/官方累计/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByText(/星级分布/)).toBeNull();
  });
});
