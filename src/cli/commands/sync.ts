import type { Provider } from "../../core/auth/passport.js";
import { Vault } from "../../core/auth/vault.js";
import { NoCredentialError, syncFromCache } from "../../core/route-a.js";
import { syncFromPassport } from "../../core/route-b.js";
import { GachaStore } from "../../core/storage/store.js";
import type { Command } from "../types.js";
import { maskKey, maskName, printReport } from "../util.js";
import { parseProvider, resolveHyToken } from "./login.js";

export const sync: Command = {
  name: "sync",
  summary: "拉取全部卡池并增量入库（默认路线 A 缓存；--passport 走路线 B 通行证）",
  async run(ctx) {
    const show = ctx.bool("show-ids");
    const ch = ctx.str("channel");

    if (ctx.bool("passport")) {
      const provider = parseProvider(ctx.str("provider"));
      if (!provider) {
        console.error(`不支持的 provider：${ctx.str("provider")}（仅支持 hypergryph | gryphline）`);
        return 2;
      }
      if (ctx.bool("qr") && ctx.bool("token-stdin")) {
        console.error("--qr 与 --token-stdin 不能同时使用。");
        return 2;
      }
      const vault = new Vault(ctx.dataDir());
      let entries: Array<{ provider: Provider; token: string; id: string }> = [];
      if (ctx.bool("token-stdin") || ctx.bool("qr")) {
        let t: string | null;
        try {
          t = await resolveHyToken(ctx);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          return 1;
        }
        if (!t) {
          console.error("未提供有效 token。");
          return 2;
        }
        entries = [{ provider, token: t, id: "(临时)" }];
      } else {
        const wanted = ctx.str("vault-id");
        const metas = vault.list();
        for (const m of metas) {
          if (wanted && m.id !== wanted) continue;
          const e = vault.load(m.id);
          if (e) entries.push({ ...e, id: m.id });
        }
        if (entries.length === 0 && !wanted && process.env.BEG_HYTOKEN) {
          const t = await resolveHyToken(ctx);
          if (t) entries = [{ provider, token: t, id: "(临时)" }];
        }
        if (entries.length === 0) {
          console.error(wanted ? `未找到 vault-id=${wanted} 的会话。` : "vault 为空：先执行 `beg login --save`。");
          return 2;
        }
      }

      const store = GachaStore.open(ctx.dataDir());
      let exit = 0;
      try {
        for (const e of entries) {
          const items = await syncFromPassport({
            store,
            hytoken: e.token,
            provider: e.provider,
            channel: ch,
            onProgress: (m) => console.log(`· ${m}`),
          });
          for (const it of items) {
            const chName = it.binding.channelName || it.binding.channelMasterId || "?";
            if (it.account) {
              console.log(
                `账号 ${it.account.channelName || chName} / ${maskName(it.account.nickname, show)}  键=${maskKey(it.account.accountKey, show)}`,
              );
            } else {
              console.log(`绑定 ${chName} (channel=${it.binding.channelMasterId})`);
            }
            if (it.report) {
              printReport(it.report, it.warnings);
              if (!it.report.ok) exit = 4;
            } else {
              for (const w of it.warnings) console.log(`  ! ${w}`);
            }
            if (it.error) {
              console.error(`  ✗ 失败：${it.error}`);
              exit = 4;
            }
          }
        }
        return exit;
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        return 1;
      } finally {
        store.close();
      }
    }

    const store = GachaStore.open(ctx.dataDir());
    const filter = ch ? { channel: ch } : {};
    try {
      const res = await syncFromCache({
        store,
        extraDirs: ctx.strs("cache-dir"),
        filter,
        onProgress: (m) => console.log(`· ${m}`),
      });
      console.log(
        `账号 ${res.account.channelName || res.account.channelMasterId} / ${maskName(res.account.nickname, show)}  键=${maskKey(res.account.accountKey, show)}`,
      );
      printReport(res.report);
      return res.report.ok ? 0 : 4;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return err instanceof NoCredentialError ? 2 : 1;
    } finally {
      store.close();
    }
  },
};
