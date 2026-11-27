import { analyzeAccount } from "../../core/analysis/index.js";
import { GachaStore } from "../../core/storage/store.js";
import { createApp } from "../../server/index.js";
import { openWindow } from "../../server/open-window.js";
import { resolveWebDir } from "../../server/web-dir.js";
import type { Command } from "../types.js";

export interface WaitForStopOptions {
  parentPid?: number;
  watchStdin?: boolean;
  stdin?: NodeJS.ReadableStream;
  pollMs?: number;
  isPidAlive?: (pid: number) => boolean;
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException | undefined)?.code !== "ESRCH";
  }
}

export function waitForStopSignal(opts: WaitForStopOptions = {}): Promise<void> {
  const parentPid = opts.parentPid;
  const watchStdin = opts.watchStdin ?? opts.stdin !== undefined;
  const stdin = watchStdin ? (opts.stdin ?? process.stdin) : undefined;
  const pollMs = opts.pollMs ?? 1000;
  const isPidAlive = opts.isPidAlive ?? defaultIsPidAlive;

  return new Promise<void>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      process.off("SIGINT", onStop);
      process.off("SIGTERM", onStop);
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      if (stdin) {
        stdin.off("end", onStop);
        stdin.off("close", onStop);
        stdin.off("error", onStop);
        if ("pause" in stdin && typeof stdin.pause === "function") {
          stdin.pause();
        }
      }
    };

    const onStop = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    process.once("SIGINT", onStop);
    process.once("SIGTERM", onStop);

    if (parentPid !== undefined) {
      if (!isPidAlive(parentPid)) {
        onStop();
        return;
      }
      const intervalMs = Math.max(1, Math.trunc(pollMs));
      timer = setInterval(() => {
        if (!isPidAlive(parentPid)) {
          onStop();
        }
      }, intervalMs);
      timer.unref();
    }

    if (stdin) {
      const s = stdin as NodeJS.ReadableStream & { readableEnded?: boolean; destroyed?: boolean };
      if (s.readableEnded || s.destroyed) {
        onStop();
        return;
      }
      stdin.once("end", onStop);
      stdin.once("close", onStop);
      stdin.once("error", onStop);
      stdin.resume();
    }
  });
}

export const serve: Command = {
  name: "serve",
  summary: "启动本地服务并打开界面（--port N，--no-open，--parent-pid PID，--watch-stdin）",
  async run(ctx) {
    const rawPort = ctx.str("port");
    let port = 0;
    if (rawPort !== undefined) {
      const parsed = Number(rawPort);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        console.error(`无效端口号：${rawPort}（应为 0..65535 整数）`);
        return 2;
      }
      port = parsed;
    }

    const rawParentPid = ctx.str("parent-pid");
    let parentPid: number | undefined;
    if (rawParentPid !== undefined) {
      const trimmed = rawParentPid.trim();
      const parsed = Number(trimmed);
      if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(parsed) || parsed <= 0) {
        console.error(`无效父进程 PID：${rawParentPid}（应为正整数）`);
        return 2;
      }
      parentPid = parsed;
    }

    const extraDirs = ctx.strs("cache-dir");
    const dataDir = ctx.dataDir();
    const store = GachaStore.open(dataDir);
    const app = createApp({
      dataDir,
      port,
      webDir: resolveWebDir(),
      deps: {
        store,
        ...(extraDirs.length > 0 ? { cacheDiscover: { extraDirs } } : {}),
        analysis: (k) =>
          analyzeAccount({
            accountKey: k,
            records: store.getRecords(k),
            pools: store.getAllPools(),
            rerunChar: store.getRerunCounts(k, "char"),
            rerunWeapon: store.getRerunCounts(k, "weapon"),
            dataDir,
          }),
      },
    });

    try {
      const url = await app.listen();
      console.log(`本地服务已启动：${url.replace(/#k=.*/, "#k=<隐藏>")}`);
      if (!ctx.bool("no-open")) {
        openWindow(url);
      } else {
        console.log(`（--no-open）完整地址（含密钥，勿分享）：${url}`);
      }

      await waitForStopSignal({
        parentPid,
        watchStdin: ctx.bool("watch-stdin"),
      });
    } finally {
      try {
        await app.close();
      } finally {
        store.close();
      }
    }
    return 0;
  },
};
