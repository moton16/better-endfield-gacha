import { VERSION } from "../../version.js";
import type { Command } from "../types.js";

export const version: Command = {
  name: "version",
  summary: "显示当前版本号",
  async run(ctx) {
    if (ctx.bool("json")) {
      console.log(JSON.stringify({ version: VERSION }));
    } else {
      console.log(VERSION);
    }
    return 0;
  },
};
