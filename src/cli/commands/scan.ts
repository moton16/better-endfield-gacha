import { redact } from "../../core/redact.js";
import { scanCaches } from "../../core/route-a.js";
import type { Command } from "../types.js";
import { fmtTime } from "../util.js";

export const scan: Command = {
  name: "scan",
  summary: "脱敏列出缓存位置与凭据（不输出任何明文 token）",
  async run(ctx) {
    const scanRes = scanCaches({ extraDirs: ctx.strs("cache-dir") });
    const view = {
      locations: scanRes.locations,
      errors: scanRes.errors,
      credentials: scanRes.credentials.map(({ token, ...c }) => ({
        ...c,
        token: redact(token),
        sortTime: fmtTime(c.sortTimeMs),
      })),
    };
    if (ctx.bool("json")) console.log(JSON.stringify(view, null, 2));
    else {
      console.log(`缓存位置 ${scanRes.locations.length} 处：`);
      for (const l of scanRes.locations) console.log(`  [${l.origin}/${l.backend}] ${l.dir}`);
      if (scanRes.locations.length === 0) console.log("  （未发现。请先在游戏内打开一次寻访记录。）");
      console.log(`凭据 ${scanRes.credentials.length} 个（新→旧）：`);
      for (const c of scanRes.credentials) {
        console.log(
          `  ${c.tokenFingerprint} ${c.host} channel=${c.channel ?? "?"}/${c.subChannel ?? "?"} server=${c.serverId} ` +
            `time=${fmtTime(c.sortTimeMs)} paths=${c.paths.join(",")}`,
        );
      }
      for (const e of scanRes.errors) console.log(`  ! ${e.dir}: ${e.message}`);
    }
    return 0;
  },
};
