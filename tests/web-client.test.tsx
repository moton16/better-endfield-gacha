// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/web/App.js";
import { ApiError, api, bootstrapKey, clearKey, download, getKey, setKey } from "../src/web/api/client.js";
import accountsFixture from "./fixtures/server/accounts.json" with { type: "json" };
import analysisFixture from "./fixtures/server/analysis.json" with { type: "json" };

beforeEach(() => {
  clearKey();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearKey();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

describe("API client & key bootstrap", () => {
  it("extracts #k= from location.hash, scrubs URL, and persists across calls", () => {
    history.replaceState(null, "", "/#k=synth_secret_key%2B1");
    expect(location.hash).toBe("#k=synth_secret_key%2B1");

    const k1 = bootstrapKey();
    expect(k1).toBe("synth_secret_key+1");
    expect(location.hash).toBe("");
    expect(getKey()).toBe("synth_secret_key+1");

    const k2 = bootstrapKey();
    expect(k2).toBe("synth_secret_key+1");
  });

  it("sends X-BEG-Key and Content-Type headers and throws ApiError(401) on unauthorized", async () => {
    setKey("test-key-123");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, version: "0.1.0-dev" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "unauthorized", message: "bad key" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const ok = await api<{ ok: boolean }>("/api/health");
    expect(ok.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/health", {
      method: "GET",
      headers: {
        "X-BEG-Key": "test-key-123",
        "Content-Type": "application/json",
      },
      body: undefined,
    });

    await expect(api("/api/accounts")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "unauthorized",
    } satisfies Partial<ApiError>);
  });

  it("attaches X-BEG-Key on download()", async () => {
    setKey("dl-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["id\n"], { type: "text/csv" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const createUrl = vi.fn(() => "blob:mock-url");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await download("/api/export?format=csv", "beg-export.csv");
    expect(fetchMock).toHaveBeenCalledWith("/api/export?format=csv", {
      headers: { "X-BEG-Key": "dl-key" },
    });
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith("blob:mock-url");
    clickSpy.mockRestore();
  });
});

describe("App KeyPrompt & 401 recovery", () => {
  it("prompts for key when missing and recovers after entering #k= URL or raw key", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers["X-BEG-Key"] !== "valid-key") {
        return new Response(JSON.stringify({ error: "unauthorized", message: "bad key" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/accounts") {
        return new Response(JSON.stringify(accountsFixture), { status: 200 });
      }
      if (url.includes("/analysis")) {
        return new Response(JSON.stringify(analysisFixture), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByText("需要访问密钥")).toBeTruthy();

    const input = screen.getByLabelText(/粘贴启动密钥/);
    fireEvent.input(input, { target: { value: "http://127.0.0.1:17890/#k=valid-key" } });
    fireEvent.click(screen.getByRole("button", { name: "解锁并加载" }));

    expect(await screen.findByText("合成特许寻访二期")).toBeTruthy();
    expect(getKey()).toBe("valid-key");
  });

  it("opens KeyPrompt when server returns 401 on an existing key", async () => {
    setKey("expired-key");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "unauthorized", message: "expired" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByText("需要访问密钥")).toBeTruthy();
    expect(getKey()).toBeNull();
  });
});
