import { formatBindingsLabel, parseHyTokenInput, qrCreate, qrWait, type Provider } from "../../core/auth/passport.js";
import { Vault } from "../../core/auth/vault.js";
import { renderQrTerminal } from "../../core/qr.js";
import { fingerprint } from "../../core/redact.js";
import { inspectPassport } from "../../core/route-b.js";
import type { CliContext } from "../context.js";
import type { Command } from "../types.js";
import { readStdin } from "../util.js";

export const RISK_NOTE =
  "⚠ 通行证 token 权限很高：已用 Windows DPAPI 加密保存在数据目录 vault.json，同一 Windows 用户下的程序都能解密。\n" +
  "  不再使用时请执行 `beg logout` 清除，并到 user.hypergryph.com 的登录设备里手动退出会话。";

export function parseProvider(raw?: string): Provider | null {
  const p = raw ?? "hypergryph";
  return p === "hypergryph" || p === "gryphline" ? p : null;
}

export async function resolveHyToken(ctx: CliContext): Promise<string | null> {
  if (ctx.bool("qr")) {
    const session = await qrCreate();
    console.log("请用森空岛/鹰角 App 扫码确认登录：");
    if (session.scanUrl) {
      console.log(renderQrTerminal(session.scanUrl));
      console.log(session.scanUrl);
    } else {
      console.log(`(scanId=${fingerprint(session.scanId)})`);
    }
    return qrWait(session);
  }
  if (ctx.bool("token-stdin")) return parseHyTokenInput(await readStdin());
  return process.env.BEG_HYTOKEN ? parseHyTokenInput(process.env.BEG_HYTOKEN) : null;
}

export const login: Command = {
  name: "login",
  summary: "校验鹰角通行证并列出终末地绑定（--token-stdin | --qr，--save 加密保存）",
  async run(ctx) {
    const provider = parseProvider(ctx.str("provider"));
    if (!provider) {
      console.error(`不支持的 provider：${ctx.str("provider")}（仅支持 hypergryph | gryphline）`);
      return 2;
    }
    if (ctx.bool("qr") && ctx.bool("token-stdin")) {
      console.error("--qr 与 --token-stdin 不能同时使用。");
      return 2;
    }
    let token: string | null;
    try {
      token = await resolveHyToken(ctx);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
    if (!token) {
      console.error("未提供有效 token。用法：Get-Clipboard | pnpm cli login --token-stdin --save");
      return 2;
    }
    try {
      const bindings = await inspectPassport(token, provider);
      const show = ctx.bool("show-ids");
      if (bindings.length === 0) console.log("（未发现终末地绑定。）");
      for (const b of bindings) {
        console.log(
          `  ${b.channelName || "?"} (channelMasterId=${b.channelMasterId || "?"}) uid=${show ? b.uid : "#" + fingerprint(b.uid)} 角色 ${b.roles.length}${b.isDefault ? " [默认]" : ""}${b.isDeleted ? " [已删除]" : ""}`,
        );
      }
      if (provider === "hypergryph" && !bindings.some((b) => b.channelMasterId === "2" && !b.isDeleted)) {
        console.log("提示：没有 B 服绑定。B 服玩家请先在 user.hypergryph.com 绑定 B 服角色。");
      }
      if (ctx.bool("save")) {
        const id = fingerprint(token);
        const label = formatBindingsLabel(bindings);
        new Vault(ctx.dataDir()).save(id, provider, token, label);
        console.log(`已保存（vault-id=${id}，${label}）。\n${RISK_NOTE}`);
      }
      return 0;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  },
};
