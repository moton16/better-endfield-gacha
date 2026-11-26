#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildGachaLink, pickBestCredential } from "../core/cache/extract.js";
import { fingerprint, redact } from "../core/redact.js";
import { NoCredentialError, scanCaches, syncFromCache } from "../core/route-a.js";
import { GachaStore } from "../core/storage/store.js";

const HELP = `用法: beg <命令> [选项]

命令:
  scan                 脱敏列出缓存位置与凭据（不输出任何明文 token）
  link                 构造完整抽卡链接（默认只输出脱敏预览）
  sync                 路线 A：从缓存取凭据 → 拉取全部卡池 → 增量入库
  accounts             列出本地账号
  stats                各卡池抽数/星级统计
  export               导出为 JSON（不含任何凭据）

通用选项:
  --data-dir <dir>     数据目录（默认 $BEG_DATA_DIR 或 ./data）
  --cache-dir <dir>    额外缓存目录（可重复）
  --channel <1|2>      只用官服(1)/B 服(2) 的凭据
  --account <key>      指定账号键（stats/export）
  --page <char|weapon> link 的页面（默认 char）
  --copy               link：复制完整链接到剪贴板
  --show               link：明文输出完整链接（含 u8_token，谨慎使用）
  --show-ids           明文显示账号键/UID/昵称（默认脱敏）
  --out <file>         export 输出文件
  --json               scan/stats 输出 JSON
`;

function dataDir(v?: string): string {
  return path.resolve(v ?? process.env.BEG_DATA_DIR ?? path.join(process.cwd(), "data"));
}

/** 终端默认不显示 UID/角色 ID/昵称（防止截图泄露），--show-ids 才明文 */
function maskKey(key: string, show: boolean): string {
  if (show) return key;
  const [region, channel, ...rest] = key.split("_");
  return `${region}_${channel}_#${fingerprint(rest.join("_"))}`;
}

function fmtTime(ms: number): string {
  return ms > 0 ? new Date(ms).toISOString() : "-";
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "data-dir": { type: "string" },
      "cache-dir": { type: "string", multiple: true },
      channel: { type: "string" },
      account: { type: "string" },
      page: { type: "string" },
      out: { type: "string" },
      copy: { type: "boolean" },
      show: { type: "boolean" },
      "show-ids": { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const cmd = positionals[0];
  if (!cmd || values.help) {
    process.stdout.write(HELP);
    return cmd ? 0 : 1;
  }
  const extraDirs = values["cache-dir"] ?? [];
  const filter = values.channel ? { channel: values.channel } : {};

  switch (cmd) {
    case "scan": {
      const scan = scanCaches({ extraDirs });
      const view = {
        locations: scan.locations,
        errors: scan.errors,
        credentials: scan.credentials.map(({ token, ...c }) => ({
          ...c,
          token: redact(token),
          sortTime: fmtTime(c.sortTimeMs),
        })),
      };
      if (values.json) console.log(JSON.stringify(view, null, 2));
      else {
        console.log(`缓存位置 ${scan.locations.length} 处：`);
        for (const l of scan.locations) console.log(`  [${l.origin}/${l.backend}] ${l.dir}`);
        if (scan.locations.length === 0) console.log("  （未发现。请先在游戏内打开一次寻访记录。）");
        console.log(`凭据 ${scan.credentials.length} 个（新→旧）：`);
        for (const c of scan.credentials) {
          console.log(
            `  ${c.tokenFingerprint} ${c.host} channel=${c.channel ?? "?"}/${c.subChannel ?? "?"} server=${c.serverId} ` +
              `time=${fmtTime(c.sortTimeMs)} paths=${c.paths.join(",")}`,
          );
        }
        for (const e of scan.errors) console.log(`  ! ${e.dir}: ${e.message}`);
      }
      return 0;
    }

    case "link": {
      const scan = scanCaches({ extraDirs });
      const cred = pickBestCredential(scan.credentials, filter);
      if (!cred) {
        console.error(new NoCredentialError(scan).message);
        return 2;
      }
      const link = buildGachaLink(cred, values.page === "weapon" ? "gacha_weapon" : "gacha_char");
      if (values.copy) {
        const r = spawnSync("clip", { input: link, encoding: "utf8" });
        if (r.status !== 0) {
          console.error("复制到剪贴板失败（clip.exe 不可用）。");
          return 3;
        }
        console.log("已复制完整抽卡链接到剪贴板（含 u8_token，请勿公开分享）。");
      }
      if (values.show) console.log(link);
      else console.log(link.replace(/(u8_token=)[^&]+/, `$1${redact(cred.token)}`));
      return 0;
    }

    case "sync": {
      const store = GachaStore.open(dataDir(values["data-dir"]));
      try {
        const res = await syncFromCache({ store, extraDirs, filter, onProgress: (m) => console.log(`· ${m}`) });
        console.log(
          `账号 ${res.account.channelName || res.account.channelMasterId} / ${values["show-ids"] ? res.account.nickname || "?" : "***"}  键=${maskKey(res.account.accountKey, !!values["show-ids"])}`,
        );
        for (const f of res.report.feeds) {
          const tag = f.status === "ok" ? "✓" : f.status === "skipped" ? "–" : "✗";
          console.log(`  ${tag} ${f.label.padEnd(10)} 拉取 ${f.fetched} 条，新增 ${f.added}${f.error ? `  (${f.error})` : ""}`);
        }
        for (const w of res.report.warnings) console.log(`  ! ${w}`);
        console.log(`共新增 ${res.report.totalAdded} 条。`);
        return res.report.ok ? 0 : 4;
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        return err instanceof NoCredentialError ? 2 : 1;
      } finally {
        store.close();
      }
    }

    case "accounts": {
      const store = GachaStore.open(dataDir(values["data-dir"]));
      for (const a of store.listAccounts()) {
        const c = store.countRecords(a.accountKey);
        console.log(`${maskKey(a.accountKey, !!values["show-ids"])}  ${a.channelName || "-"}  ${values["show-ids"] ? a.nickname || "-" : "***"}  抽卡 ${c.draws} 条 (含非抽卡共 ${c.total})`);
      }
      store.close();
      return 0;
    }

    case "stats": {
      const store = GachaStore.open(dataDir(values["data-dir"]));
      const accounts = values.account ? store.listAccounts().filter((a) => a.accountKey === values.account) : store.listAccounts();
      const out: unknown[] = [];
      for (const a of accounts) {
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
        if (!values.json) {
          console.log(`# ${maskKey(a.accountKey, !!values["show-ids"])}`);
          for (const [feed, s] of byFeed) console.log(`  ${feed}: ${s.draws} 抽  6★${s.r6} 5★${s.r5} 4★${s.r4}`);
        }
      }
      if (values.json) console.log(JSON.stringify(out, null, 2));
      store.close();
      return 0;
    }

    case "export": {
      const store = GachaStore.open(dataDir(values["data-dir"]));
      const accounts = values.account ? store.listAccounts().filter((a) => a.accountKey === values.account) : store.listAccounts();
      const doc = {
        format: "better-endfield-gacha/v1",
        exportedAt: new Date().toISOString(),
        accounts: accounts.map((a) => ({
          ...a,
          records: store.getRecords(a.accountKey),
        })),
      };
      const text = JSON.stringify(doc, null, 2);
      if (values.out) {
        fs.mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
        fs.writeFileSync(values.out, text, "utf8");
        console.log(`已导出 ${accounts.length} 个账号 → ${values.out}`);
      } else console.log(text);
      store.close();
      return 0;
    }

    default:
      console.error(`未知命令：${cmd}\n`);
      process.stdout.write(HELP);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
