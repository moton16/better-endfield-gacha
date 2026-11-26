import type { CliContext } from "./context.js";

export interface Command {
  name: string;
  summary: string;
  /** 返回进程退出码 */
  run(ctx: CliContext): Promise<number>;
}
