import fs from "node:fs";
import path from "node:path";
import { toCsv } from "../../core/io/csv.js";
import { GachaStore } from "../../core/storage/store.js";
import type { Command } from "../types.js";

export const exportCmd: Command = {
  name: "export",
  summary: "导出为 JSON 或 CSV（不含任何凭据）",
  async run(ctx) {
    const format = ctx.str("format") ?? "json";
    if (format !== "json" && format !== "csv") {
      console.error(`不支持的导出格式：${format}（可选 json|csv）`);
      return 1;
    }
    const outPath = ctx.str("out");
    if (format === "csv" && !outPath) {
      console.error("导出 CSV 格式必须指定 --out <文件路径>");
      return 1;
    }

    const store = GachaStore.open(ctx.dataDir());
    const targetAccount = ctx.str("account");
    const includeGifts = ctx.bool("include-gifts");
    try {
      const list = targetAccount ? store.listAccounts().filter((a) => a.accountKey === targetAccount) : store.listAccounts();

      if (format === "csv") {
        const records = list.flatMap((a) => store.getRecords(a.accountKey));
        const csv = toCsv(records, { includeGifts });
        const exportedCount = records.filter((r) => includeGifts || r.kind === "draw").length;
        fs.mkdirSync(path.dirname(path.resolve(outPath!)), { recursive: true });
        fs.writeFileSync(outPath!, csv, "utf8");
        console.log(`已导出 ${exportedCount} 条记录（${list.length} 个账号） → ${outPath}`);
        return 0;
      }

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
