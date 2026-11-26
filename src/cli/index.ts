#!/usr/bin/env node
import { COMMANDS } from "./commands/index.js";
import { makeContext } from "./context.js";

function help(): string {
  const w = Math.max(...COMMANDS.map((c) => c.name.length));
  return (
    "用法: beg <命令> [选项]\n\n命令:\n" +
    COMMANDS.map((c) => `  ${c.name.padEnd(w)}  ${c.summary}`).join("\n") +
    "\n\n通用选项: --data-dir <dir> --cache-dir <dir> --channel <1|2> --account <key> --show-ids --json\n" +
    "各命令专有选项见 docs（README）。\n"
  );
}

async function main(argv: string[]): Promise<number> {
  let ctx;
  try {
    ctx = makeContext(argv);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  const cmd = COMMANDS.find((c) => c.name === ctx.command);
  if (ctx.command && !cmd) {
    console.error(`未知命令：${ctx.command}\n`);
    process.stdout.write(help());
    return 1;
  }
  if (!ctx.command || ctx.bool("help")) {
    process.stdout.write(help());
    return ctx.bool("help") ? 0 : 1;
  }
  return cmd!.run(ctx);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
