import fs from "node:fs";
import path from "node:path";
import { GachaStore } from "../../core/storage/store.js";
import type { Command } from "../types.js";

export const exportCmd: Command = {
  name: "export",
  summary: "导出为 JSON（不含任何凭据）",
  async run(ctx) {
    const store = GachaStore.open(ctx.dataDir());
    const targetAccount = ctx.str("account");
    const outPath = ctx.str("out");
    try {
      const list = targetAccount ? store.listAccounts().filter((a) => a.accountKey === targetAccount) : store.listAccounts();
      const doc = {
        format: "better-endfield-gacha/v1",
        exportedAt: new Date().toISOString(),
        accounts: list.map((a) => ({
          ...a,
          records: store.getRecords(a.accountKey),
        })),
      };
      const text = JSON.stringify(doc, null, 2);
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, text, "utf8");
        console.log(`已导出 ${list.length} 个账号 → ${outPath}`);
      } else console.log(text);
      return 0;
    } finally {
      store.close();
    }
  },
};
