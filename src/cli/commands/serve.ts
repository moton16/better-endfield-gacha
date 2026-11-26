import { analyzeAccount } from "../../core/analysis/index.js";
import { GachaStore } from "../../core/storage/store.js";
import { createApp } from "../../server/index.js";
import { openWindow } from "../../server/open-window.js";
import type { Command } from "../types.js";

export const serve: Command = {
  name: "serve",
  summary: "启动本地服务并打开界面（--port N，--no-open）",
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

    const extraDirs = ctx.strs("cache-dir");
    const dataDir = ctx.dataDir();
    const store = GachaStore.open(dataDir);
    const app = createApp({
      dataDir,
      port,
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
          }),
      },
    });

    const url = await app.listen();
    console.log(`本地服务已启动：${url.replace(/#k=.*/, "#k=<隐藏>")}`);
    if (!ctx.bool("no-open")) {
      openWindow(url);
    } else {
      console.log(`（--no-open）完整地址（含密钥，勿分享）：${url}`);
    }

    await new Promise<void>((resolve) => {
      const onStop = () => {
        process.off("SIGINT", onStop);
        process.off("SIGTERM", onStop);
        resolve();
      };
      process.once("SIGINT", onStop);
      process.once("SIGTERM", onStop);
    });

    await app.close();
    store.close();
    return 0;
  },
};
