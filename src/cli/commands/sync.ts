import { NoCredentialError, syncFromCache } from "../../core/route-a.js";
import { GachaStore } from "../../core/storage/store.js";
import type { Command } from "../types.js";
import { maskKey, maskName, printReport } from "../util.js";

export const sync: Command = {
  name: "sync",
  summary: "路线 A：从缓存取凭据 → 拉取全部卡池 → 增量入库",
  async run(ctx) {
    const store = GachaStore.open(ctx.dataDir());
    const show = ctx.bool("show-ids");
    const ch = ctx.str("channel");
    const filter = ch ? { channel: ch } : {};
    try {
      const res = await syncFromCache({
        store,
        extraDirs: ctx.strs("cache-dir"),
        filter,
        onProgress: (m) => console.log(`· ${m}`),
      });
      console.log(
        `账号 ${res.account.channelName || res.account.channelMasterId} / ${maskName(res.account.nickname, show)}  键=${maskKey(res.account.accountKey, show)}`,
      );
      printReport(res.report);
      return res.report.ok ? 0 : 4;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return err instanceof NoCredentialError ? 2 : 1;
    } finally {
      store.close();
    }
  },
};
