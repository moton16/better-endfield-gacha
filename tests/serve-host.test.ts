import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serve, waitForStopSignal } from "../src/cli/commands/serve.js";
import { makeContext } from "../src/cli/context.js";
import { GachaStore } from "../src/core/storage/store.js";
import { buildAccountKey, type AccountRow, type GachaRecord } from "../src/core/types.js";

const tempDirs: string[] = [];
const openStores = new Set<GachaStore>();
const spawnedProcs = new Set<ChildProcess>();

function mkTempDir(prefix = "beg-serve-host-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function mkAccount(): AccountRow {
  const region = "cn";
  const channelMasterId = "2";
  const bindingUid = "SYNTH_HOST_UID_1";
  const roleId = "SYNTH_HOST_ROLE_1";
  return {
    region,
    channelMasterId,
    bindingUid,
    roleId,
    accountKey: buildAccountKey({ region, channelMasterId, bindingUid, roleId }),
    nickname: "SyntheticHostTester",
    serverId: "1",
    serverName: "China",
    channelName: "bilibili服",
    source: "cache",
    updatedAt: 1_760_000_000_000,
  };
}

function mkRecord(seq: number): GachaRecord {
  return {
    type: "char",
    feed: "char:E_CharacterGachaPoolType_Special",
    poolType: "E_CharacterGachaPoolType_Special",
    poolId: "special_1_0_1",
    poolName: "合成测试池",
    itemId: `chr_4_${seq}`,
    itemName: `合成角色${seq}`,
    itemSubType: "",
    rarity: 4,
    isFree: false,
    isNew: false,
    gachaTs: String(1_760_000_000_000 + seq * 1000),
    seqId: String(seq),
    kind: "draw",
  };
}

function httpGetJson(urlStr: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request(
      { host: u.hostname, port: Number(u.port), path: u.pathname + u.search, method: "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function spawnServeChild(args: string[], stdinMode: "pipe" | "ignore"): ChildProcess {
  const tsxLoader = pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href;
  const cliEntry = path.resolve("src/cli/index.ts");
  const child = spawn(process.execPath, ["--import", tsxLoader, cliEntry, "serve", ...args], {
    cwd: process.cwd(),
    stdio: [stdinMode, "pipe", "pipe"],
  });
  spawnedProcs.add(child);
  return child;
}

function waitForServeReady(child: ChildProcess, timeoutMs = 10_000): Promise<{ baseUrl: string; key: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for serve startup. stdout=${stdout} stderr=${stderr}`));
    }, timeoutMs);

    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const m = stdout.match(/(http:\/\/127\.0\.0\.1:\d+)\/#k=([A-Za-z0-9_-]+)/);
      if (m) {
        cleanup();
        resolve({ baseUrl: m[1]!, key: m[2]! });
      }
    };
    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`serve exited early code=${code} signal=${signal}. stdout=${stdout} stderr=${stderr}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
    };

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcess, timeoutMs = 10_000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error(`Timed out waiting for child pid=${child.pid} to exit`));
    }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    child.once("exit", onExit);
  });
}

afterEach(() => {
  for (const s of openStores) {
    try {
      s.close();
    } catch {
      /* ignore */
    }
  }
  openStores.clear();

  for (const p of spawnedProcs) {
    if (p.exitCode === null && p.signalCode === null) {
      try {
        p.kill();
      } catch {
        /* ignore */
      }
    }
  }
  spawnedProcs.clear();

  for (const d of tempDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("serve host lifecycle & WAL checkpoint", () => {
  it("waitForStopSignal: 模拟 parentPid 在第 2 次轮询退出时干净结束并清理监听与定时器", async () => {
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");
    let checks = 0;
    const isPidAlive = vi.fn(() => {
      checks += 1;
      return checks < 2;
    });

    await waitForStopSignal({ parentPid: 424242, pollMs: 10, isPidAlive });

    expect(isPidAlive).toHaveBeenCalledTimes(2);
    expect(isPidAlive).toHaveBeenCalledWith(424242);
    await new Promise((r) => setTimeout(r, 40));
    expect(isPidAlive).toHaveBeenCalledTimes(2);
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
  });

  it("waitForStopSignal: parentPid 初始即不可达时立即结束", async () => {
    const start = Date.now();
    const isPidAlive = vi.fn(() => false);
    await waitForStopSignal({ parentPid: 999999, pollMs: 60_000, isPidAlive });
    expect(Date.now() - start).toBeLessThan(200);
    expect(isPidAlive).toHaveBeenCalledTimes(1);
  });

  it("waitForStopSignal: 注入 stdin PassThrough 关闭时立即结束", async () => {
    const beforeSigint = process.listenerCount("SIGINT");
    const stdin = new PassThrough();
    let resolved = false;
    const p = waitForStopSignal({ stdin }).then(() => {
      resolved = true;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);

    stdin.end();
    await p;
    expect(resolved).toBe(true);
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
  });

  it("waitForStopSignal: 已提前结束的 stdin 流立即触发退出", async () => {
    const stdin = new PassThrough();
    stdin.resume();
    stdin.end();
    await new Promise((r) => setTimeout(r, 10));
    await waitForStopSignal({ stdin });
  });

  it("waitForStopSignal: watchStdin=false 时忽略 stdin EOF", async () => {
    const stdin = new PassThrough();
    let alive = true;
    let resolved = false;
    const p = waitForStopSignal({
      watchStdin: false,
      stdin,
      parentPid: 12345,
      pollMs: 10,
      isPidAlive: () => alive,
    }).then(() => {
      resolved = true;
    });

    stdin.end();
    await new Promise((r) => setTimeout(r, 40));
    expect(resolved).toBe(false);

    alive = false;
    await p;
    expect(resolved).toBe(true);
  });

  it("GachaStore.close(): 关闭前执行 WAL checkpoint 并截断 -wal，数据完整落入主库", () => {
    const dataDir = mkTempDir();
    const store = GachaStore.open(dataDir);
    openStores.add(store);

    const acc = mkAccount();
    store.upsertAccount(acc);
    const records = Array.from({ length: 50 }, (_, idx) => mkRecord(idx + 1));
    expect(store.insertRecords(acc.accountKey, records)).toBe(50);

    const walPath = path.join(dataDir, "gacha.sqlite-wal");
    expect(fs.existsSync(walPath)).toBe(true);
    expect(fs.statSync(walPath).size).toBeGreaterThan(0);

    store.close();
    openStores.delete(store);

    if (fs.existsSync(walPath)) {
      expect(fs.statSync(walPath).size).toBe(0);
    }

    // 仅复制主数据库文件到隔离目录验证所有记录已 checkpoint 落盘
    const verifyDir = mkTempDir();
    fs.copyFileSync(path.join(dataDir, "gacha.sqlite"), path.join(verifyDir, "gacha.sqlite"));
    const reopened = GachaStore.open(verifyDir);
    openStores.add(reopened);
    expect(reopened.countRecords(acc.accountKey).draws).toBe(50);
    reopened.close();
    openStores.delete(reopened);
  });

  it("CLI context 与 serve 参数校验: 非法 --parent-pid 返回退出码 2", async () => {
    const ctx = makeContext(["serve", "--parent-pid", "1234", "--watch-stdin"]);
    expect(ctx.str("parent-pid")).toBe("1234");
    expect(ctx.bool("watch-stdin")).toBe(true);

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const badArgs: string[][] = [
      ["serve", "--parent-pid", "0"],
      ["serve", "--parent-pid=-1"],
      ["serve", "--parent-pid", "1.5"],
      ["serve", "--parent-pid", "abc"],
      ["serve", "--parent-pid", ""],
      ["serve", "--parent-pid", "123abc"],
      ["serve", "--parent-pid", "1e3"],
    ];
    for (const argv of badArgs) {
      const code = await serve.run(makeContext(argv));
      expect(code).toBe(2);
    }
    expect(errSpy).toHaveBeenCalledTimes(badArgs.length);
  });

  it("子进程 serve --watch-stdin: 关闭 stdin 后优雅退出 (code 0) 并截断 WAL", async () => {
    const dataDir = mkTempDir();
    const child = spawnServeChild(["--port", "0", "--no-open", "--data-dir", dataDir, "--watch-stdin"], "pipe");

    const { baseUrl, key } = await waitForServeReady(child);
    const health = await httpGetJson(`${baseUrl}/api/health`, { "X-BEG-Key": key });
    expect(health.status).toBe(200);
    expect(health.body?.ok).toBe(true);

    child.stdin!.end();
    const exit = await waitForExit(child);
    expect(exit.code).toBe(0);

    const walPath = path.join(dataDir, "gacha.sqlite-wal");
    if (fs.existsSync(walPath)) {
      expect(fs.statSync(walPath).size).toBe(0);
    }
  }, 15_000);

  it("子进程 serve --parent-pid (stdin=ignore): 不误退，父进程退出后以 code 0 优雅退出", async () => {
    const dataDir = mkTempDir();
    const dummyParent = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    spawnedProcs.add(dummyParent);
    expect(dummyParent.pid).toBeGreaterThan(0);

    const child = spawnServeChild(
      ["--port", "0", "--no-open", "--data-dir", dataDir, "--parent-pid", String(dummyParent.pid)],
      "ignore",
    );

    const { baseUrl, key } = await waitForServeReady(child);
    const health = await httpGetJson(`${baseUrl}/api/health`, { "X-BEG-Key": key });
    expect(health.status).toBe(200);
    expect(health.body?.ok).toBe(true);

    dummyParent.kill();
    await waitForExit(dummyParent);

    const exit = await waitForExit(child);
    expect(exit.code).toBe(0);

    const walPath = path.join(dataDir, "gacha.sqlite-wal");
    if (fs.existsSync(walPath)) {
      expect(fs.statSync(walPath).size).toBe(0);
    }
  }, 15_000);
});
