import type { Command } from "../types.js";
import { accounts } from "./accounts.js";
import { exportCmd } from "./export.js";
import { link } from "./link.js";
import { login } from "./login.js";
import { logout } from "./logout.js";
import { scan } from "./scan.js";
import { stats } from "./stats.js";
import { sync } from "./sync.js";
import { importCmd } from "./import.js";
import { backup } from "./backup.js";
import { serve } from "./serve.js";

/** 追加新命令：import 一行 + 数组里加一项（别重排别人的行）。 */
export const COMMANDS: Command[] = [scan, link, sync, login, logout, accounts, stats, exportCmd, importCmd, backup, serve];
