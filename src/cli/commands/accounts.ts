import { GachaStore } from "../../core/storage/store.js";
import type { Command } from "../types.js";
import { maskKey } from "../util.js";

export const accounts: Command = {
  name: "accounts",
  summary: "列出本地账号",
  async run(ctx) {
    const store = GachaStore.open(ctx.dataDir());
    const show = ctx.bool("show-ids");
    try {
      for (const a of store.listAccounts()) {
        const c = store.countRecords(a.accountKey);
        console.log(
          `${maskKey(a.accountKey, show)}  ${a.channelName || "-"}  ${show ? a.nickname || "-" : "***"}  抽卡 ${c.draws} 条 (含非抽卡共 ${c.total})`,
        );
      }
      return 0;
    } finally {
      store.close();
    }
  },
};
