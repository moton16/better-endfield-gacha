import fs from "node:fs";
import path from "node:path";
import { applyRestore, listBackups, planRestore, resolveBackupFile } from "../../core/io/restore.js";
import { GachaStore } from "../../core/storage/store.js";
import type { Command } from "../types.js";
import { maskKey } from "../util.js";

export const restore: Command = {
  name: "restore",
  summary: "从数据库备份合并恢复（--in <备份文件名或路径>；默认干跑，--apply 才写入；不带 --in 列出备份）",
  async run(ctx) {
    const dataDir = ctx.dataDir();
    const inArg = ctx.str("in");
    if (!inArg) {
      const files = listBackups(dataDir);
      if (files.length === 0) console.log("暂无备份（先执行 beg backup）。");
      for (const f of files) console.log(`${f.file}  ${f.size} 字节  ${new Date(f.mtime).toLocaleString()}`);
      return 0;
    }

    let file: string;
    try {
      file = /[\\/]/.test(inArg) ? path.resolve(inArg) : resolveBackupFile(dataDir, inArg);
      if (!fs.statSync(file).isFile()) throw new Error("不是文件");
    } catch (e) {
      console.error(`无法读取备份：${(e as Error).message}`);
      return 1;
    }

    const show = ctx.bool("show-ids");
    const store = GachaStore.open(dataDir);
    try {
      let plan;
      try {
        plan = planRestore(store, dataDir, file);
      } catch (e) {
        console.error(`备份校验失败：${(e as Error).message}`);
        return 1;
      }
      for (const { plan: p } of plan.accounts) {
        console.log(
          `账号 ${maskKey(p.accountKey, show)}：备份 ${p.total} 条 | 本地缺失将补回 ${p.newRecords.length} | 已有 ${p.duplicates} | 冲突 ${p.conflicts.length}`,
        );
      }
      if (plan.accounts.length === 0) console.log("该备份中没有任何账号。");
      if (!ctx.bool("apply")) {
        console.log("干跑模式：未写入数据库（添加 --apply 执行恢复）。");
        return 0;
      }
      const res = applyRestore(store, dataDir, plan);
      console.log(`已恢复：新增 ${res.added} 条（恢复前已自动备份：${res.backup}）`);
      return 0;
    } finally {
      store.close();
    }
  },
};
