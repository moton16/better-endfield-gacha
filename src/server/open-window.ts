import { spawn } from "node:child_process";
import fs from "node:fs";

const CANDIDATES = [
  process.env["ProgramFiles(x86)"] ? `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe` : "",
  process.env["ProgramFiles"] ? `${process.env["ProgramFiles"]}\\Microsoft\\Edge\\Application\\msedge.exe` : "",
  process.env["ProgramFiles"] ? `${process.env["ProgramFiles"]}\\Google\\Chrome\\Application\\chrome.exe` : "",
  process.env["ProgramFiles(x86)"] ? `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe` : "",
];

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
