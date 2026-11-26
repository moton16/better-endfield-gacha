// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/web/App.js";
import { clearKey, setKey } from "../src/web/api/client.js";
import { resetMockState } from "../src/web/api/mock.js";

beforeEach(() => {
  resetMockState();
  clearKey();
  sessionStorage.clear();
  history.replaceState(null, "", "/?mock=1");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearKey();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

describe("Web UI mock mode & interactions", () => {
  it("renders summary cards, badges, pool groups, switches tabs and privacy mask", async () => {
    render(<App />);

    // 3 summary cards
    await screen.findByText("135");
    const summary = within(screen.getByLabelText("抽卡总览"));
    expect(summary.getByText("135")).toBeTruthy();
    expect(summary.getByText("90")).toBeTruthy();
    expect(summary.getAllByText("45").length).toBeGreaterThanOrEqual(1);
    expect(summary.getByText("限定角色")).toBeTruthy();
    expect(summary.getByText("武器申领")).toBeTruthy();
    expect(summary.getByText("常驻池")).toBeTruthy();

    // Badges on limited tab
    expect(screen.getByText("十连双金 ×1")).toBeTruthy();
    expect(screen.getByText("九蓝一紫 ×2")).toBeTruthy();
    expect(screen.getByText("超欧 ×2")).toBeTruthy();
    expect(screen.getByText("超非 ×1")).toBeTruthy();

    // Pool groups on limited tab
    expect(screen.getByText("合成特许寻访二期")).toBeTruthy();
    expect(screen.getByText("合成重构寻访一期")).toBeTruthy();

    // Privacy masked by default
    expect(screen.getByTestId("account-nickname").textContent).toBe("***");
    fireEvent.click(screen.getByRole("button", { name: "切换隐私遮罩" }));
    expect(screen.getByTestId("account-nickname").textContent).toBe("合成测试账号A");

    // Switch tab to weapon
    fireEvent.click(screen.getByRole("tab", { name: "武器申领" }));
    expect(screen.getByText("合成武器申领箱二")).toBeTruthy();
    expect(screen.getByText("合成武器申领箱一")).toBeTruthy();
    expect(screen.queryByText("合成特许寻访二期")).toBeNull();
    // 3 summary cards remain visible
    expect(screen.getByText("135")).toBeTruthy();

    // Switch tab to standard & expand details
    fireEvent.click(screen.getByRole("tab", { name: "常驻" }));
    expect(screen.getByText("基础寻访")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    expect(screen.getByText(/星级分布：6★ 1 · 5★ 5 · 4★ 39/)).toBeTruthy();

    // Switch account
    fireEvent.change(screen.getByLabelText("切换账号"), {
      target: { value: "cn_1_SYNTHUID002_SYNTHROLE002" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "限定角色" }));
    expect(await screen.findByText("合成官服特许池")).toBeTruthy();
  });

  it("handles SyncDialog Route A (scan, sync job poll, copy & reveal confirm) and Route B (inspect, clear token, vault)", async () => {
    render(<App />);
    await screen.findByText("合成特许寻访二期");

    fireEvent.click(screen.getByRole("button", { name: "同步" }));
    expect(await screen.findByText(/找到 1 个凭据/)).toBeTruthy();

    // Copy link toast
    fireEvent.click(screen.getByRole("button", { name: "复制抽卡链接" }));
    expect(await screen.findByText("已复制（含凭据，勿分享）")).toBeTruthy();

    // Reveal link requires secondary confirmation
    fireEvent.click(screen.getByRole("button", { name: "显示链接" }));
    expect(screen.getByText(/确定要在屏幕明文显示吗/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认显示链接" }));
    expect(await screen.findByText(/明文抽卡链接/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "隐藏链接" }));
    expect(screen.queryByText(/明文抽卡链接/)).toBeNull();

    // Run cache sync job
    fireEvent.click(screen.getByRole("button", { name: "开始同步" }));
    expect(await screen.findByText(/✓ 特许寻访：拉取 10，新增 3/)).toBeTruthy();

    // Switch to Passport tab
    fireEvent.click(screen.getByRole("tab", { name: "鹰角通行证" }));
    const tokenInput = screen.getByLabelText(/通行证 token/) as HTMLInputElement;
    expect(tokenInput.type).toBe("password");
    expect(tokenInput.getAttribute("autocomplete")).toBe("off");

    fireEvent.input(tokenInput, { target: { value: "SYNTH_HYTOKEN_INPUT" } });
    fireEvent.click(screen.getByRole("button", { name: "校验" }));

    // Input is immediately cleared after submit
    expect(tokenInput.value).toBe("");
    expect(await screen.findByText(/绑定列表（共 2 项）/)).toBeTruthy();

    // Clear vault with secondary confirmation
    fireEvent.click(screen.getByRole("button", { name: "清除全部" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清除全部会话" }));
    expect(await screen.findByText(/已清除全部本地加密会话/)).toBeTruthy();
  });

  it("handles DataDialog export, v1 dry-run -> apply, lcx account guard, and backup", async () => {
    const createUrl = vi.fn(() => "blob:mock-export");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<App />);
    await screen.findByText("合成特许寻访二期");

    fireEvent.click(screen.getByRole("button", { name: "导入/导出" }));

    // Export CSV & JSON
    fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }));
    expect(await screen.findByText("已导出 CSV 文件")).toBeTruthy();
    expect(createUrl).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();

    // Backup
    fireEvent.click(screen.getByRole("button", { name: "立即备份数据库" }));
    expect(await screen.findByText(/gacha-backup-mock\.sqlite/)).toBeTruthy();

    // Upload a mock lcx JSON while clearing targetAccount -> should block preview
    const fileInput = screen.getByLabelText(/选择文件/) as HTMLInputElement;
    const lcxPayload = JSON.stringify({ list: [{ poolName: "x", itemName: "y", rarity: 6 }] });
    const lcxFile = {
      name: "lcx.json",
      size: lcxPayload.length,
      text: async () => lcxPayload,
    } as unknown as File;
    fireEvent.change(screen.getByLabelText(/目标账号/), { target: { value: "" } });
    fireEvent.change(fileInput, { target: { files: [lcxFile] } });

    await waitFor(() => {
      expect(screen.getByText(/离愁轩格式导入必须先选择目标账号/)).toBeTruthy();
    });
    const previewBtn = screen.getByRole("button", { name: "预览导入（干跑）" }) as HTMLButtonElement;
    expect(previewBtn.disabled).toBe(true);

    // Upload a v1 JSON -> dry-run then apply
    const v1Payload = JSON.stringify({ format: "better-endfield-gacha/v1", accounts: [] });
    const v1File = {
      name: "v1.json",
      size: v1Payload.length,
      text: async () => v1Payload,
    } as unknown as File;
    fireEvent.change(fileInput, { target: { files: [v1File] } });

    await waitFor(() => {
      expect(previewBtn.disabled).toBe(false);
    });
    fireEvent.click(previewBtn);
    expect(await screen.findByText(/干跑预览/)).toBeTruthy();
    expect(screen.getByText(/新增 12/)).toBeTruthy();

    const applyBtn = screen.getByRole("button", { name: "确认导入" }) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
    fireEvent.click(applyBtn);
    expect(await screen.findByText(/导入已完成/)).toBeTruthy();
  });

  it("escapes untrusted XSS payloads in nickname, pool title, itemName, and notes", async () => {
    history.replaceState(null, "", "/");
    setKey("xss-test-key");
    const xssPayload = '<script>window.__begXss=1</script><img src=x onerror="window.__begXss=2">';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/accounts") {
        return new Response(
          JSON.stringify([
            {
              accountKey: "cn_2_SYNTH_XSS",
              maskedKey: "cn_2_#xss",
              region: "cn",
              channelName: "bilibili服",
              nickname: xssPayload,
              source: "cache",
              updatedAt: 1760000090000,
              counts: { total: 10, draws: 10 },
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes("/analysis")) {
        return new Response(
          JSON.stringify({
            accountKey: "cn_2_SYNTH_XSS",
            generatedAt: 1760000100000,
            overview: {
              limited: {
                total: 10,
                count6: 1,
                offBanner: 0,
                upCount: 1,
                avgPity6: 10,
                avgCostPerUp: 10,
                badges: [],
                luckCounts: { ou: 1, fei: 0 },
              },
              weapon: { total: 0, count6: 0, offBanner: 0, upCount: 0, avgPity6: null, avgCostPerUp: null, badges: [], luckCounts: { ou: 0, fei: 0 } },
              standard: { total: 0, count6: 0, offBanner: 0, upCount: 0, avgPity6: null, avgCostPerUp: null, badges: [], luckCounts: { ou: 0, fei: 0 } },
              beginner: { total: 0, count6: 0, offBanner: 0, upCount: 0, avgPity6: null, avgCostPerUp: null, badges: [], luckCounts: { ou: 0, fei: 0 } },
            },
            groups: [
              {
                key: "g1",
                kind: "char",
                tab: "limited",
                poolType: "E_CharacterGachaPoolType_Special",
                poolId: "p1",
                title: xssPayload,
                total: 10,
                paid: 10,
                free: 0,
                count6: 1,
                count5: 1,
                count4: 8,
                up6Ids: ["i1"],
                upKnown: true,
                hits: [
                  {
                    itemId: "i1",
                    itemName: xssPayload,
                    pity: 10,
                    isFree: false,
                    isNew: true,
                    isUp: true,
                    gachaTs: "1760000090000",
                    seqId: "10",
                    tone: "green",
                    luck: "ou",
                  },
                ],
                pending: 0,
                smallPityMax: 80,
                freeBatches: [],
                isCurrent: true,
                firstTs: "1760000000000",
                lastTs: "1760000090000",
              },
            ],
            notes: [xssPayload],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: xssPayload })).toBeTruthy();
    });

    // Reveal nickname too
    fireEvent.click(screen.getByRole("button", { name: "切换隐私遮罩" }));
    expect(screen.getByTestId("account-nickname").textContent).toBe(xssPayload);
    expect(container.querySelector(".hit-sub")?.textContent).toContain(xssPayload);
    expect(container.querySelector(".notes")?.textContent).toContain(xssPayload);

    // No raw script or img tag was injected into DOM
    expect(container.querySelectorAll("script").length).toBe(0);
    expect(container.querySelectorAll("img").length).toBe(0);
    expect((window as unknown as { __begXss?: unknown }).__begXss).toBeUndefined();
  });
});
