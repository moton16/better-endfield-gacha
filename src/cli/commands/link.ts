import { spawnSync } from "node:child_process";
import { buildGachaLink, pickBestCredential } from "../../core/cache/extract.js";
import { redact } from "../../core/redact.js";
import { NoCredentialError, scanCaches } from "../../core/route-a.js";
import type { Command } from "../types.js";

export const link: Command = {
  name: "link",
  summary: "构造完整抽卡链接（默认只输出脱敏预览）",
  async run(ctx) {
    const scanRes = scanCaches({ extraDirs: ctx.strs("cache-dir") });
    const ch = ctx.str("channel");
    const cred = pickBestCredential(scanRes.credentials, ch ? { channel: ch } : {});
    if (!cred) {
      console.error(new NoCredentialError(scanRes).message);
      return 2;
    }
    const gachaLink = buildGachaLink(cred, ctx.str("page") === "weapon" ? "gacha_weapon" : "gacha_char");
    if (ctx.bool("copy")) {
      const r = spawnSync("clip", { input: gachaLink, encoding: "utf8" });
      if (r.status !== 0) {
        console.error("复制到剪贴板失败（clip.exe 不可用）。");
        return 3;
      }
      console.log("已复制完整抽卡链接到剪贴板（含 u8_token，请勿公开分享）。");
    }
    if (ctx.bool("show")) console.log(gachaLink);
    else console.log(gachaLink.replace(/(u8_token=)[^&]+/, `$1${redact(cred.token)}`));
    return 0;
  },
};
