import { createBackup } from "../../core/io/importer.js";
import { GachaStore } from "../../core/storage/store.js";
import type { Command } from "../types.js";

export const backup: Command = {
  name: "backup",
  summary: "将本地数据库一致性备份到 backups/ 目录",
  async run(ctx) {
    const dataDir = ctx.dataDir();
    const store = GachaStore.open(dataDir);
    try {
      const file = createBackup(store, dataDir);
      console.log(`已备份数据库 → ${file}`);
      return 0;
    } finally {
      store.close();
    }
  },
};
