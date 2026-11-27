import { spawn } from "node:child_process";
import fs from "node:fs";

const CANDIDATES = [
  process.env["ProgramFiles(x86)"] ? `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe` : "",
  process.env["ProgramFiles"] ? `${process.env["ProgramFiles"]}\\Microsoft\\Edge\\Application\\msedge.exe` : "",
  process.env["ProgramFiles"] ? `${process.env["ProgramFiles"]}\\Google\\Chrome\\Application\\chrome.exe` : "",
  process.env["ProgramFiles(x86)"] ? `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe` : "",
];

/** 在系统文件管理器中打开目录（仅用于服务端拼出的固定子目录，不接受外部路径）。 */
export function openFolder(dir: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["explorer.exe", [dir]]
      : process.platform === "darwin"
        ? ["open", [dir]]
        : ["xdg-open", [dir]];
  const child = spawn(cmd!, args as string[], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

/** 优先 Edge/Chrome 的 --app 模式（无地址栏，像桌面应用）；找不到就用系统默认浏览器 */
export function openWindow(url: string): void {
  const exe = CANDIDATES.find((p) => p && fs.existsSync(p));
  if (exe) {
    spawn(exe, [`--app=${url}`, "--window-size=480,900"], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("pwsh", ["-NoProfile", "-Command", `Start-Process '${url.replace(/'/g, "''")}'`], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }
}
