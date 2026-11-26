import { Vault } from "../../core/auth/vault.js";
import type { Command } from "../types.js";

export const logout: Command = {
  name: "logout",
  summary: "清除已保存的通行证会话（vault.json）",
  async run(ctx) {
    const n = new Vault(ctx.dataDir()).clear();
    console.log(`已清除 ${n} 个会话。服务端会话仍需到 user.hypergryph.com 的登录设备里手动退出。`);
    return 0;
  },
};
