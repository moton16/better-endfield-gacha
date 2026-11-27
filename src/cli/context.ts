import path from "node:path";
import { parseArgs } from "node:util";

/** 全部命令共用的选项超集。后续模块需要新选项时在此追加一行（只追加）。 */
export const OPTIONS = {
  "data-dir": { type: "string" },
  "cache-dir": { type: "string", multiple: true },
  channel: { type: "string" },
  account: { type: "string" },
  page: { type: "string" },
  out: { type: "string" },
  in: { type: "string" },
  format: { type: "string" },
  provider: { type: "string" },
  "vault-id": { type: "string" },
  port: { type: "string" },
  copy: { type: "boolean" },
  show: { type: "boolean" },
  "show-ids": { type: "boolean" },
  json: { type: "boolean" },
  passport: { type: "boolean" },
  qr: { type: "boolean" },
  "token-stdin": { type: "boolean" },
  save: { type: "boolean" },
  "no-open": { type: "boolean" },
  "dry-run": { type: "boolean" },
  analysis: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  apply: { type: "boolean" },
  "pool-map": { type: "string" },
  "include-gifts": { type: "boolean" },
  "parent-pid": { type: "string" },
  "watch-stdin": { type: "boolean" },
  "new-account": { type: "boolean" },
} as const;

export interface CliContext {
  positionals: string[];
  str(name: keyof typeof OPTIONS): string | undefined;
  strs(name: keyof typeof OPTIONS): string[];
  bool(name: keyof typeof OPTIONS): boolean;
  /** 解析后的数据目录（--data-dir > $BEG_DATA_DIR > ./data），绝对路径 */
  dataDir(): string;
}

export function makeContext(argv: string[]): CliContext & { command?: string } {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  const v = values as Record<string, unknown>;
  return {
    command: positionals[0],
    positionals: positionals.slice(1),
    str: (n) => (typeof v[n] === "string" ? (v[n] as string) : undefined),
    strs: (n) => (Array.isArray(v[n]) ? (v[n] as string[]) : []),
    bool: (n) => v[n] === true,
    dataDir() {
      const d = (typeof v["data-dir"] === "string" ? (v["data-dir"] as string) : undefined) ?? process.env.BEG_DATA_DIR ?? path.join(process.cwd(), "data");
      return path.resolve(d);
    },
  };
}
