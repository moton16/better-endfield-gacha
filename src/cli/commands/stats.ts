import { GachaStore } from "../../core/storage/store.js";
import type { Command } from "../types.js";
import { maskKey } from "../util.js";

export const stats: Command = {
  name: "stats",
  summary: "各卡池抽数/星级统计",
  async run(ctx) {
    const store = GachaStore.open(ctx.dataDir());
    const show = ctx.bool("show-ids");
    const targetAccount = ctx.str("account");
    try {
      const list = targetAccount ? store.listAccounts().filter((a) => a.accountKey === targetAccount) : store.listAccounts();
      const out: unknown[] = [];
      for (const a of list) {
        const byFeed = new Map<string, { draws: number; r6: number; r5: number; r4: number }>();
        for (const r of store.getRecords(a.accountKey)) {
          if (r.kind !== "draw") continue;
          const s = byFeed.get(r.feed) ?? { draws: 0, r6: 0, r5: 0, r4: 0 };
          s.draws++;
          if (r.rarity === 6) s.r6++;
          else if (r.rarity === 5) s.r5++;
          else if (r.rarity === 4) s.r4++;
          byFeed.set(r.feed, s);
        }
        out.push({ account: a.accountKey, feeds: Object.fromEntries(byFeed) });
        if (!ctx.bool("json")) {
          console.log(`# ${maskKey(a.accountKey, show)}`);
          for (const [feed, s] of byFeed) console.log(`  ${feed}: ${s.draws} 抽  6★${s.r6} 5★${s.r5} 4★${s.r4}`);
        }
      }
      if (ctx.bool("json")) console.log(JSON.stringify(out, null, 2));
      return 0;
    } finally {
      store.close();
    }
  },
};
