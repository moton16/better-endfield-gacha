import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ResolveWebDirOptions {
  envDir?: string;
  moduleDir?: string;
  cwd?: string;
}

/**
 * 解析前端静态目录（dist-web / web），兼容源码运行、dist 编译产物与便携包布局。
 * 优先级：BEG_WEB_DIR > 与当前模块同根的 dist-web / web > 当前工作目录下的 dist-web / app/dist-web / web。
 */
export function resolveWebDir(opts: ResolveWebDirOptions = {}): string {
  const envDir = opts.envDir !== undefined ? opts.envDir : process.env.BEG_WEB_DIR;
  if (envDir && envDir.trim() !== "") {
    return path.resolve(envDir.trim());
  }

  const here = opts.moduleDir ?? path.dirname(fileURLToPath(import.meta.url));
  const cwd = opts.cwd ?? process.cwd();
  const candidates = [
    path.resolve(here, "../../dist-web"),
    path.resolve(here, "../../web"),
    path.resolve(here, "../../../web"),
    path.resolve(cwd, "dist-web"),
    path.resolve(cwd, "app/dist-web"),
    path.resolve(cwd, "web"),
  ];

  const found = candidates.find((p) => fs.existsSync(path.join(p, "index.html")));
  return found ?? candidates[0]!;
}
