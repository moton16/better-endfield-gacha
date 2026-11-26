import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

import { dpapi } from "../src/core/auth/dpapi.js";

describe.skipIf(process.platform !== "win32")("dpapi shell 回退（mock child_process）", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it("pwsh 报 ENOENT 时自动回退到 Windows PowerShell 5.1 并携带 System.Security", () => {
    const fakeCipherB64 = Buffer.from("ENCRYPTED_PAYLOAD").toString("base64");
    const plain = "SYNTH_DPAPI_FALLBACK_TOKEN";

    spawnSyncMock.mockImplementation((exe: string, args: string[], opts: { input?: string }) => {
      if (exe === "pwsh") {
        return {
          status: null,
          stdout: "",
          stderr: "",
          error: Object.assign(new Error("spawnSync pwsh ENOENT"), { code: "ENOENT" }),
        };
      }
      if (exe === "powershell") {
        const script = args[args.indexOf("-Command") + 1] ?? "";
        expect(script).toContain("Add-Type -AssemblyName System.Security");
        const mode = (opts.input ?? "").split("\n")[0];
        return {
          status: 0,
          stdout: mode === "e" ? `${fakeCipherB64}\n` : `${Buffer.from(plain, "utf8").toString("base64")}\n`,
          stderr: "",
        };
      }
      throw new Error(`unexpected exe: ${exe}`);
    });

    const encrypted = dpapi.encrypt(plain);
    expect(encrypted).toBe(fakeCipherB64);
    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
    expect(spawnSyncMock.mock.calls[0]?.[0]).toBe("pwsh");
    expect(spawnSyncMock.mock.calls[1]?.[0]).toBe("powershell");
    expect(spawnSyncMock.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["-NoProfile", "-NonInteractive", "-Command"]),
    );

    const decrypted = dpapi.decrypt(encrypted);
    expect(decrypted).toBe(plain);
    expect(spawnSyncMock).toHaveBeenCalledTimes(4);
    expect(spawnSyncMock.mock.calls[2]?.[0]).toBe("pwsh");
    expect(spawnSyncMock.mock.calls[3]?.[0]).toBe("powershell");
  });

  it("pwsh 与 powershell 均不可用时抛出明确错误且不泄露明文", () => {
    const secret = "SYNTH_SUPER_SECRET_NEVER_LEAK";
    spawnSyncMock.mockImplementation((exe: string) => ({
      status: null,
      stdout: "",
      stderr: "",
      error: Object.assign(new Error(`spawnSync ${exe} ENOENT`), { code: "ENOENT" }),
    }));

    expect(() => dpapi.encrypt(secret)).toThrow(/DPAPI 调用失败.*ENOENT/);
    try {
      dpapi.encrypt(secret);
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
    }
  });
});

describe.skipIf(process.platform === "win32")("dpapi 非 Windows 平台拦截", () => {
  it("非 Windows 平台调用抛出不支持错误", () => {
    expect(() => dpapi.encrypt("SYNTH")).toThrow(/Windows/);
  });
});
