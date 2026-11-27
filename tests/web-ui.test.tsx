// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/web/App.js";
import { clearKey, setKey } from "../src/web/api/client.js";
import { mockFetch, resetMockState } from "../src/web/api/mock.js";
import { cropImageFileToDataUrl } from "../src/web/components/AvatarPickerDialog.js";
import { resetMediaManifestForTest, setMediaManifestForTest } from "../src/web/lib/media.js";

beforeEach(() => {
  resetMockState();
  resetMediaManifestForTest();
  clearKey();
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, "", "/?mock=1");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetMediaManifestForTest();
  clearKey();
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, "", "/");
});

describe("Web UI mock mode & interactions", () => {
  it("renders summary cards, global badges, rating ribbon, cost strip, tabs, show-5 toggle, unified weapon pity view, and privacy mask", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(<App />);

    // Summary cards + rating ribbon + stamp + cost strip
    await screen.findByText("120");
    const strip = within(screen.getByLabelText("全账号抽卡汇总"));
    expect(strip.getByText("总抽取")).toBeTruthy();
    expect(strip.getByText("总消耗")).toBeTruthy();
    expect(strip.getByText("嵌晶玉")).toBeTruthy();
    expect(strip.getByText("武库配额")).toBeTruthy();

    // Load currency icons in manifest -> strip replaces fallback text with currency <img> icons
    setMediaManifestForTest({
      currency: ["item_diamond", "item_gachabyproducts_weapongold"],
    });
    await waitFor(() => {
      expect(strip.getByAltText("嵌晶玉").getAttribute("src")).toBe(
        "./media/currency/item_diamond.webp",
      );
      expect(strip.getByAltText("武库配额").getAttribute("src")).toBe(
        "./media/currency/item_gachabyproducts_weapongold.webp",
      );
    });
    expect(strip.queryByText("嵌晶玉")).toBeNull();
    expect(strip.queryByText("武库配额")).toBeNull();

    const summary = within(screen.getByLabelText("抽卡总览"));
    expect(summary.getByText("120")).toBeTruthy();
    expect(summary.getByText("15")).toBeTruthy();
    expect(summary.getByText("90")).toBeTruthy();
    expect(summary.getByText("85")).toBeTruthy();
    expect(summary.getByText("限定")).toBeTruthy();
    expect(summary.getByText("复刻")).toBeTruthy();
    expect(summary.getByText("武器")).toBeTruthy();
    expect(summary.getByText("庆典")).toBeTruthy();
    expect(summary.getByText("基准")).toBeTruthy();
    expect(summary.getByText("《宇宙级至尊欧皇》")).toBeTruthy();
    expect(summary.getByText("本地统计自")).toBeTruthy();
    expect(summary.getByLabelText("切换总览卡页")).toBeTruthy();

    // Global badges (aggregated across all tabs)
    const badgeBox = within(screen.getByLabelText("欧非与特殊徽章"));
    expect(badgeBox.getByText("十连双金").parentElement?.textContent).toBe("十连双金x1");
    expect(badgeBox.getByText("九蓝一紫").parentElement?.textContent).toBe("九蓝一紫x6");
    expect(badgeBox.getByText("超欧").parentElement?.textContent).toBe("超欧x2");
    expect(badgeBox.getByText("超非").parentElement?.textContent).toBe("超非x2");

    // Pool groups on special tab + multi-gold, carry pity, arsenal quota & free batch
    expect(screen.getByText("合成特许寻访二期")).toBeTruthy();
    expect(screen.getByText("合成特许寻访一期")).toBeTruthy();
    expect(screen.getByText("已垫12抽")).toBeTruthy();
    expect(screen.getByText("免费十连")).toBeTruthy();
    expect(screen.getAllByText("产出").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("8520")).toBeTruthy(); // 3*2000 + 6*200 + 66*20
    expect(screen.queryByText("合成重构寻访一期")).toBeNull();

    // Switch to rerun tab
    fireEvent.click(screen.getByRole("tab", { name: "复刻池" }));
    expect(screen.getByText("合成重构寻访一期")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "限定池" }));

    // Privacy masked by default -> copy blocked with toast, then toggle to plaintext and copy
    expect(screen.getByTestId("account-nickname").textContent).toBe("***");
    fireEvent.click(screen.getByText(/^ID:/));
    expect(await screen.findByText(/隐私遮罩已开启/)).toBeTruthy();
    expect(writeText).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "切换隐私遮罩" }));
    expect(screen.getByTestId("account-nickname").textContent).toBe("合成测试账号A");
    fireEvent.click(screen.getByText(/^ID:/));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("cn_2_SYNTHUID001_SYNTHROLE001");
    });

    // Toggle 展示五星
    const show5Btn = screen.getByRole("switch", { name: "展示五星" });
    expect(show5Btn.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(show5Btn);
    expect(show5Btn.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem("beg.show5")).toBe("1");
    expect(screen.getAllByLabelText("同周期五星").length).toBeGreaterThanOrEqual(1);

    // Switch tab to weapon -> unified pity-bar rows (no 看十连/看水位 mode toggle); global badges stay visible
    fireEvent.click(screen.getByRole("tab", { name: "武器池" }));
    expect(screen.getByText("合成武器申领箱二")).toBeTruthy();
    expect(screen.getByText("合成武器申领箱一")).toBeTruthy();
    expect(screen.getByRole("img", { name: /武器01 18 抽/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: /武器03 37 抽/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /看水位|看十连/ })).toBeNull();
    expect(screen.queryByLabelText(/第 \d+ 个十连/)).toBeNull();
    expect(screen.queryByText("合成特许寻访二期")).toBeNull();
    expect(badgeBox.getByText("十连双金")).toBeTruthy();

    // Switch tab to standard & expand details
    fireEvent.click(screen.getByRole("tab", { name: "常驻" }));
    expect(screen.getByText("基础寻访")).toBeTruthy();
    expect(screen.getByText("启程寻访")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "详情" })[0]!);
    expect(screen.getByText(/星级分布：6★ 1 · 5★ 5 · 4★ 39/)).toBeTruthy();

    // Switch account
    fireEvent.change(screen.getByLabelText("切换账号"), {
      target: { value: "cn_1_SYNTHUID002_SYNTHROLE002" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "限定池" }));
    expect(await screen.findByText("合成官服特许池")).toBeTruthy();

    // Footer data import/export shortcut opens DataDialog
    fireEvent.click(screen.getByRole("button", { name: "数据导入导出" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
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

  it("handles DataDialog export-to-disk, one-click lcx/v1 import, and one-click backup restore", async () => {
    render(<App />);
    await screen.findByText("合成特许寻访二期");

    fireEvent.click(screen.getByRole("button", { name: "导入/导出" }));

    // 导出直接落盘并显示位置，不再依赖浏览器下载
    fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }));
    expect(await screen.findByText(/已保存：beg-export-mock\.csv/)).toBeTruthy();
    expect(screen.getByText(/位置：C:\\mock\\data\\exports/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开导出文件夹" })).toBeTruthy();

    // Backup（立即备份后刷新备份列表）
    fireEvent.click(screen.getByRole("button", { name: "立即备份数据库" }));
    expect((await screen.findAllByText(/gacha-backup-mock\.sqlite/)).length).toBeGreaterThan(0);

    // 备份恢复：一键直接恢复
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    expect(await screen.findByText(/恢复已完成/)).toBeTruthy();

    // 离愁轩文件 + 自动账号：选文件后「导入」立即可点，无需前置预览步骤
    const fileInput = screen.getByLabelText(/选择文件/) as HTMLInputElement;
    const importBtn = screen.getByRole("button", { name: "导入" }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);

    const lcxPayload = JSON.stringify({ list: [{ poolName: "x", itemName: "y", rarity: 6 }] });
    const lcxFile = {
      name: "lcx.json",
      size: lcxPayload.length,
      text: async () => lcxPayload,
    } as unknown as File;
    fireEvent.change(screen.getByLabelText(/导入到哪个账号/), { target: { value: "" } });
    fireEvent.change(fileInput, { target: { files: [lcxFile] } });

    await waitFor(() => {
      expect(importBtn.disabled).toBe(false);
    });
    expect(screen.queryByText(/必须先选择目标账号/)).toBeNull();

    // 上传 v1 JSON：一键点击「导入」直接执行并展示结果
    const v1Payload = JSON.stringify({ format: "better-endfield-gacha/v1", accounts: [] });
    const v1File = {
      name: "v1.json",
      size: v1Payload.length,
      text: async () => v1Payload,
    } as unknown as File;
    fireEvent.change(fileInput, { target: { files: [v1File] } });

    await waitFor(() => {
      expect(importBtn.disabled).toBe(false);
    });
    fireEvent.click(importBtn);
    expect(await screen.findByText(/导入已完成/)).toBeTruthy();
    expect(screen.getByText(/新增 12/)).toBeTruthy();
  });

  it("escapes untrusted XSS payloads in nickname, pool title, itemName, and notes (without global field)", async () => {
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

  it("handles Route B QR login: renders inline SVG, polls to confirmed, updates vault label, and auto-triggers sync", async () => {
    render(<App />);
    await screen.findByText("合成特许寻访二期");

    fireEvent.click(screen.getByRole("button", { name: "同步" }));
    fireEvent.click(screen.getByRole("tab", { name: "鹰角通行证" }));

    const vaultSelect = screen.getByLabelText("已保存的会话") as HTMLSelectElement;
    await waitFor(() => {
      expect(vaultSelect.value).toBe("aabbccdd");
    });
    expect(vaultSelect.options[0]?.textContent).toContain("bilibili服 · 1角色 · aabbccdd");

    fireEvent.click(screen.getByRole("button", { name: "扫码登录" }));

    const qrSvg = await screen.findByRole("img", { name: "扫码登录二维码" });
    const viewBox = qrSvg.getAttribute("viewBox") ?? "";
    const parts = viewBox.split(" ").map(Number);
    expect(parts.length).toBe(4);
    expect(parts[2]).toBeGreaterThanOrEqual(25);
    expect(parts[2]).toBe(parts[3]);
    expect(qrSvg.querySelectorAll("rect").length).toBe(1);
    expect(qrSvg.querySelector("rect")?.getAttribute("fill")).toBe("#ffffff");
    const paths = qrSvg.querySelectorAll("path");
    expect(paths.length).toBe(1);
    expect(paths[0]?.getAttribute("fill")).toBe("#000000");
    expect(paths[0]?.getAttribute("d")?.startsWith("M")).toBe(true);
    expect(screen.getByRole("dialog").querySelectorAll("img").length).toBe(0);

    // Wait for confirmed -> vault updated & selected -> auto-sync finishes
    expect(await screen.findByText(/绑定列表（共 1 项）/)).toBeTruthy();
    await waitFor(() => {
      expect(vaultSelect.value).toBe("eeff0011");
    });
    const selectedOpt = vaultSelect.options[vaultSelect.selectedIndex];
    expect(selectedOpt?.textContent).toContain("bilibili服 · 1角色 · eeff0011");
    expect(await screen.findByText(/✓ 特许寻访：拉取 10，新增 3/)).toBeTruthy();
  });

  it("handles Route A 40100 fallback button, QR error/expired + retry, and timer cleanup on cancel", async () => {
    history.replaceState(null, "", "/");
    setKey("qr-error-test-key");

    let qrPollCount = 0;
    let qrScan2Polls = 0;
    let qrCreateCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/accounts") return new Response("[]", { status: 200 });
      if (url === "/api/cache/scan") {
        return new Response(JSON.stringify({ locations: [], credentials: [], errors: [] }), { status: 200 });
      }
      if (url === "/api/passport/vault" && method === "GET") {
        return new Response("[]", { status: 200 });
      }
      if (url === "/api/sync" && method === "POST") {
        return new Response(JSON.stringify({ jobId: "j-expired" }), { status: 200 });
      }
      if (url === "/api/jobs/j-expired") {
        return new Response(
          JSON.stringify({
            id: "j-expired",
            kind: "sync",
            state: "error",
            progress: ["使用缓存凭据 11aa22bb"],
            error: "接口返回 code=40100 msg=token已过期",
            startedAt: 1760000000000,
          }),
          { status: 200 },
        );
      }
      if (url === "/api/passport/qr" && method === "POST") {
        qrCreateCount += 1;
        return new Response(
          JSON.stringify({
            scanId: `SCAN_${qrCreateCount}`,
            scanUrl: `hypergryph://scan_login?scanId=SCAN_${qrCreateCount}`,
          }),
          { status: 200 },
        );
      }
      if (url.startsWith("/api/passport/qr/") && method === "GET") {
        qrPollCount += 1;
        if (url.endsWith("/SCAN_1")) {
          return new Response(
            JSON.stringify({ error: "qr_expired", message: "扫码会话不存在或已过期，请重新生成二维码" }),
            { status: 404 },
          );
        }
        qrScan2Polls += 1;
        if (qrScan2Polls === 1) {
          return new Response(
            JSON.stringify({ status: "pending", consecutiveErrors: 1, transientError: "网络超时" }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ status: "error", error: "轮询异常，请重新生成二维码" }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "同步数据" }));

    // Route A error containing 40100 shows convenience button -> switches to passport tab
    fireEvent.click(screen.getByRole("button", { name: "开始同步" }));
    const fallbackBtn = await screen.findByRole("button", { name: "改用鹰角通行证扫码" });
    fireEvent.click(fallbackBtn);
    const passportTab = screen.getByRole("tab", { name: "鹰角通行证" });
    expect(passportTab.getAttribute("aria-selected")).toBe("true");

    // Test QR 404 expired, pending transientError, status==="error" stop polling + retry, and cancel cleans up timers
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(screen.getByRole("button", { name: "扫码登录" }));
      await screen.findByRole("img", { name: "扫码登录二维码" });

      // Advance 2000ms for poll -> gets 404 expired
      await vi.advanceTimersByTimeAsync(2100);
      expect(await screen.findByText(/扫码会话不存在或已过期/)).toBeTruthy();
      expect(qrPollCount).toBe(1);

      // Polling stopped after 404 (advancing another 5s triggers 0 more polls)
      await vi.advanceTimersByTimeAsync(5000);
      expect(qrPollCount).toBe(1);

      // Retry creates SCAN_2 -> poll 1 returns transientError -> keeps polling -> poll 2 returns status:"error" -> stops
      fireEvent.click(screen.getByRole("button", { name: "重新生成二维码" }));
      await screen.findByRole("img", { name: "扫码登录二维码" });
      expect(qrCreateCount).toBe(2);
      await vi.advanceTimersByTimeAsync(2100);
      expect(await screen.findByText(/网络波动，正在重试（第 1 次）：网络超时/)).toBeTruthy();
      expect(qrPollCount).toBe(2);

      await vi.advanceTimersByTimeAsync(2100);
      expect(await screen.findByText(/轮询异常，请重新生成二维码/)).toBeTruthy();
      expect(qrPollCount).toBe(3);
      await vi.advanceTimersByTimeAsync(5000);
      expect(qrPollCount).toBe(3);

      // Retry creates SCAN_3 -> clicking 取消扫码 cleans up timer so 0 polls occur
      fireEvent.click(screen.getByRole("button", { name: "重新生成二维码" }));
      await screen.findByRole("img", { name: "扫码登录二维码" });
      expect(qrCreateCount).toBe(3);

      fireEvent.click(screen.getByRole("button", { name: "取消扫码" }));
      expect(screen.queryByRole("img", { name: "扫码登录二维码" })).toBeNull();
      await vi.advanceTimersByTimeAsync(5000);
      expect(qrPollCount).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens AvatarPickerDialog, shows empty-pack note, persists preset/operator avatars per accountKey with privacy mask, and resets to initial", async () => {
    const { container } = render(<App />);
    await screen.findByText("合成特许寻访二期");

    // 1. Default state: privacy=true -> .header-avatar is a button showing "终" with 0 <img>
    const avatarBtn = screen.getByRole("button", { name: "更换头像" });
    expect(avatarBtn.textContent).toBe("终");
    expect(avatarBtn.querySelector("img")).toBeNull();

    // Open picker when asset pack is empty -> shows polite fallback note & disabled reset
    fireEvent.click(avatarBtn);
    const dialog = screen.getByRole("dialog", { name: "更换头像" });
    expect(
      within(dialog).getByText("当前未装入预设游戏头像资源包，可使用本地图片裁剪上传"),
    ).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "恢复默认" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭头像选择弹窗" }));
    expect(screen.queryByRole("dialog", { name: "更换头像" })).toBeNull();

    // 2. Load manifest presets + operators
    setMediaManifestForTest({
      version: 1,
      avatars: ["preset_endmin"],
      chars: ["chr_0016_laevat"],
      weapons: [],
      boxes: [],
      banners: {},
      itemAlias: {},
    });

    // Pick preset avatar for Account A while privacy=true -> persisted, yet Header remains masked as "终"
    fireEvent.click(screen.getByRole("button", { name: "更换头像" }));
    const pickerA = screen.getByRole("dialog", { name: "更换头像" });
    fireEvent.click(within(pickerA).getByRole("button", { name: /preset_endmin/ }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "更换头像" })).toBeNull();
    });
    expect(localStorage.getItem("beg.avatar.cn_2_SYNTHUID001_SYNTHROLE001")).toBe(
      "media/avatars/preset_endmin.webp",
    );
    const mockAccountsAfterA = await mockFetch<Array<{ accountKey: string; avatar?: string }>>("/api/accounts");
    expect(mockAccountsAfterA.find((a) => a.accountKey === "cn_2_SYNTHUID001_SYNTHROLE001")?.avatar).toBe(
      "media/avatars/preset_endmin.webp",
    );

    // Privacy still ON -> .header-avatar MUST NOT render <img>, must show "终"
    expect(container.querySelector(".header-avatar img")).toBeNull();
    expect(screen.getByRole("button", { name: "更换头像" }).textContent).toBe("终");

    // Toggle privacy OFF -> .header-avatar shows preset <img>
    fireEvent.click(screen.getByRole("button", { name: "切换隐私遮罩" }));
    const imgA = container.querySelector(".header-avatar img.header-avatar-img") as HTMLImageElement | null;
    expect(imgA).not.toBeNull();
    expect(imgA?.getAttribute("src")).toBe("./media/avatars/preset_endmin.webp");

    // Toggle privacy back ON -> <img> hidden back to "终", then OFF again -> <img> restored
    fireEvent.click(screen.getByRole("button", { name: "切换隐私遮罩" }));
    expect(container.querySelector(".header-avatar img")).toBeNull();
    expect(screen.getByRole("button", { name: "更换头像" }).textContent).toBe("终");
    fireEvent.click(screen.getByRole("button", { name: "切换隐私遮罩" }));
    expect(container.querySelector(".header-avatar img")?.getAttribute("src")).toBe(
      "./media/avatars/preset_endmin.webp",
    );

    // 3. Account switching isolation: Account B has no avatar yet -> shows initial char "合"
    fireEvent.change(screen.getByLabelText("切换账号"), {
      target: { value: "cn_1_SYNTHUID002_SYNTHROLE002" },
    });
    await screen.findByText("合成官服特许池");
    expect(container.querySelector(".header-avatar img")).toBeNull();
    expect(screen.getByRole("button", { name: "更换头像" }).textContent).toBe("合");

    // Set operator avatar on Account B
    fireEvent.click(screen.getByRole("button", { name: "更换头像" }));
    const pickerB = screen.getByRole("dialog", { name: "更换头像" });
    fireEvent.click(within(pickerB).getByRole("button", { name: /chr_0016_laevat/ }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "更换头像" })).toBeNull();
    });
    expect(localStorage.getItem("beg.avatar.cn_1_SYNTHUID002_SYNTHROLE002")).toBe(
      "media/chars/chr_0016_laevat.webp",
    );
    expect(container.querySelector(".header-avatar img")?.getAttribute("src")).toBe(
      "./media/chars/chr_0016_laevat.webp",
    );

    // Switch back to Account A -> Account A retains preset avatar
    fireEvent.change(screen.getByLabelText("切换账号"), {
      target: { value: "cn_2_SYNTHUID001_SYNTHROLE001" },
    });
    await screen.findByText("合成特许寻访二期");
    expect(container.querySelector(".header-avatar img")?.getAttribute("src")).toBe(
      "./media/avatars/preset_endmin.webp",
    );

    // 4. Reset Account A to default -> removes avatar & restores initial char "合"
    fireEvent.click(screen.getByRole("button", { name: "更换头像" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "更换头像" })).getByRole("button", { name: "恢复默认" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "更换头像" })).toBeNull();
    });
    expect(localStorage.getItem("beg.avatar.cn_2_SYNTHUID001_SYNTHROLE001")).toBeNull();
    expect(container.querySelector(".header-avatar img")).toBeNull();
    expect(screen.getByRole("button", { name: "更换头像" }).textContent).toBe("合");
  });

  it("crops uploaded image to <= 64 KB DataURL, rejects invalid/oversized payloads, and mirrors real-mode PUT safely", async () => {
    // Unit-check cropImageFileToDataUrl rejection on invalid MIME / SVG / empty
    await expect(cropImageFileToDataUrl(new File([], "empty.png", { type: "image/png" }))).rejects.toThrow(/非空/);
    await expect(cropImageFileToDataUrl(new File(["txt"], "a.txt", { type: "text/plain" }))).rejects.toThrow(/不支持/);
    await expect(
      cropImageFileToDataUrl(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" })),
    ).rejects.toThrow(/SVG/);

    // Mock PUT /api/accounts/:key/avatar validation checks
    await expect(
      mockFetch("/api/accounts/cn_2_SYNTHUID001_SYNTHROLE001/avatar", {
        method: "PUT",
        body: { avatar: "https://example.com/a.webp" },
      }),
    ).rejects.toThrow(/头像格式无效/);
    await expect(
      mockFetch("/api/accounts/cn_2_SYNTHUID001_SYNTHROLE001/avatar", {
        method: "PUT",
        body: { avatar: "data:image/svg+xml;base64,PHN2Zz4=" },
      }),
    ).rejects.toThrow(/头像格式无效/);
    await expect(
      mockFetch("/api/accounts/cn_2_SYNTHUID001_SYNTHROLE001/avatar", {
        method: "PUT",
        body: { avatar: "media/avatars/../secret.webp" },
      }),
    ).rejects.toThrow(/头像格式无效/);
    await expect(
      mockFetch("/api/accounts/cn_2_SYNTHUID001_SYNTHROLE001/avatar", {
        method: "PUT",
        body: { avatar: `data:image/webp;base64,${"A".repeat(64 * 1024)}` },
      }),
    ).rejects.toThrow(/64 KB/);

    // Mock 2D canvas + createImageBitmap to test center-square crop & quality step-down <= 64 KB
    const drawImage = vi.fn();
    const clearRect = vi.fn();
    const fillRect = vi.fn();
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          drawImage,
          clearRect,
          fillRect,
          fillStyle: "#ffffff",
        }) as unknown as CanvasRenderingContext2D,
    );

    const smallWebp = `data:image/webp;base64,${"A".repeat(120)}`;
    const oversizedWebp = `data:image/webp;base64,${"B".repeat(70 * 1024)}`;
    let toDataUrlCall = 0;
    const toDataUrlSpy = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
      toDataUrlCall += 1;
      // First attempt (128x128 q=0.88) oversized -> steps down to q=0.76 and succeeds
      return toDataUrlCall === 1 ? oversizedWebp : smallWebp;
    });

    const bmpClose = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 200, height: 100, close: bmpClose })),
    );

    const cropped = await cropImageFileToDataUrl(
      new File(["fake-png"], "wide.png", { type: "image/png" }),
    );
    expect(cropped).toBe(smallWebp);
    expect(Buffer.byteLength(cropped, "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(toDataUrlCall).toBe(2);
    // Center-square crop on 200x100: sx=50, sy=0, side=100 -> 128x128
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 50, 0, 100, 100, 0, 0, 128, 128);
    expect(bmpClose).toHaveBeenCalled();

    // Always oversized -> rejects cleanly
    toDataUrlSpy.mockImplementation(() => oversizedWebp);
    await expect(
      cropImageFileToDataUrl(new File(["fake-png"], "huge.png", { type: "image/png" })),
    ).rejects.toThrow(/超过 64 KB/);

    // Invalid non-raster DataURL -> rejects cleanly
    toDataUrlSpy.mockImplementation(() => "data:image/svg+xml;base64,PHN2Zz4=");
    await expect(
      cropImageFileToDataUrl(new File(["fake-png"], "svg.png", { type: "image/png" })),
    ).rejects.toThrow(/超过 64 KB/);

    // Now test full UI upload flow + real-mode PUT /api/accounts/:key/avatar + localStorage error tolerance
    toDataUrlCall = 0;
    toDataUrlSpy.mockImplementation(() => smallWebp);
    history.replaceState(null, "", "/");
    setKey("avatar-real-key");
    const putCalls: Array<{ url: string; body: string | null }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/accounts") {
        return new Response(
          JSON.stringify([
            {
              accountKey: "cn_2_SYNTHUID001_SYNTHROLE001",
              maskedKey: "cn_2_#11aa22bb",
              region: "cn",
              channelName: "bilibili服",
              nickname: "合成测试账号A",
              source: "cache",
              updatedAt: 1760000090000,
              avatar: "",
              counts: { total: 10, draws: 10 },
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes("/analysis")) {
        return new Response(
          JSON.stringify({
            accountKey: "cn_2_SYNTHUID001_SYNTHROLE001",
            generatedAt: 1760000100000,
            overview: {
              limited: { total: 0, count6: 0, offBanner: 0, upCount: 0, avgPity6: null, avgCostPerUp: null, badges: [], luckCounts: { ou: 0, fei: 0 } },
              weapon: { total: 0, count6: 0, offBanner: 0, upCount: 0, avgPity6: null, avgCostPerUp: null, badges: [], luckCounts: { ou: 0, fei: 0 } },
              standard: { total: 0, count6: 0, offBanner: 0, upCount: 0, avgPity6: null, avgCostPerUp: null, badges: [], luckCounts: { ou: 0, fei: 0 } },
              beginner: { total: 0, count6: 0, offBanner: 0, upCount: 0, avgPity6: null, avgCostPerUp: null, badges: [], luckCounts: { ou: 0, fei: 0 } },
            },
            groups: [],
            notes: [],
          }),
          { status: 200 },
        );
      }
      if (url === "/api/accounts/cn_2_SYNTHUID001_SYNTHROLE001/avatar" && method === "PUT") {
        putCalls.push({ url, body: typeof init?.body === "string" ? init.body : null });
        return new Response(
          JSON.stringify({ accountKey: "cn_2_SYNTHUID001_SYNTHROLE001", avatar: smallWebp }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const { container } = render(<App />);
    await screen.findByText("当前分类下暂无抽卡记录");

    // Toggle privacy off first
    fireEvent.click(screen.getByRole("button", { name: "切换隐私遮罩" }));
    fireEvent.click(screen.getByRole("button", { name: "更换头像" }));
    const fileInput = screen.getByLabelText(/本地图片裁剪上传/) as HTMLInputElement;

    // Upload invalid file first -> shows alert inside dialog and stays open
    fireEvent.change(fileInput, {
      target: { files: [new File(["bad"], "bad.txt", { type: "text/plain" })] },
    });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "更换头像" })).toBeTruthy();

    // Upload valid image -> crops, sends PUT, ignores localStorage throw, updates Header <img>
    fireEvent.change(fileInput, {
      target: { files: [new File(["ok"], "ok.png", { type: "image/png" })] },
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "更换头像" })).toBeNull();
    });
    expect(putCalls).toHaveLength(1);
    expect(JSON.parse(putCalls[0]!.body ?? "{}")).toEqual({ avatar: smallWebp });
    expect(container.querySelector(".header-avatar img")?.getAttribute("src")).toBe(smallWebp);

    // Privacy back on -> hides cropped DataURL <img> cleanly back to "终"
    fireEvent.click(screen.getByRole("button", { name: "切换隐私遮罩" }));
    expect(container.querySelector(".header-avatar img")).toBeNull();
    expect(screen.getByRole("button", { name: "更换头像" }).textContent).toBe("终");

    setItemSpy.mockRestore();
    getContextSpy.mockRestore();
    toDataUrlSpy.mockRestore();
  });
});
