/**
 * 仅 Windows：实证「别的进程持有 DELETE 句柄时，缺少 FILE_SHARE_DELETE 的打开方式会失败，
 * 而本项目的只读打开（Node/libuv 全共享）可以成功」——对应 PlatformProcess.exe 运行期的真实场景。
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SharedReadFile } from "../src/core/cache/blockfile.js";

const isWin = process.platform === "win32";

describe.skipIf(!isWin)("Windows 共享锁", () => {
  it("他方持有 DELETE 访问句柄时：缺 FILE_SHARE_DELETE 的打开失败，SharedReadFile 成功", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beg-lock-"));
    const target = path.join(dir, "data_1");
    fs.writeFileSync(target, "hello-cache");
    const ready = path.join(dir, "ready.flag");
    const holder = spawn(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        // DeleteOnClose => 句柄带 DELETE 访问；共享标志放开 R/W/D（与 Chromium disk_cache 一致）
        `$fs=[IO.FileStream]::new('${target}',[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]'ReadWrite,Delete',4096,[IO.FileOptions]::DeleteOnClose); ` +
          `Set-Content '${ready}' 'x'; Start-Sleep -Seconds 20; $fs.Dispose()`,
      ],
      { stdio: "ignore" },
    );
    try {
      for (let i = 0; i < 100 && !fs.existsSync(ready); i++) await new Promise((r) => setTimeout(r, 100));
      expect(fs.existsSync(ready)).toBe(true);

      // 与 Python open() 等价的共享模式：FILE_SHARE_READ|WRITE，缺 DELETE
      const naive = spawnSync(
        "pwsh",
        ["-NoProfile", "-Command", `try { $f=[IO.File]::Open('${target}','Open','Read','ReadWrite'); $f.Dispose(); 'OK' } catch { 'FAIL' }`],
        { encoding: "utf8" },
      );
      expect(naive.stdout.trim()).toBe("FAIL");

      const f = new SharedReadFile(target);
      expect(f.read(0, 5).toString()).toBe("hello");
      f.close();
    } finally {
      holder.kill();
      await new Promise((r) => setTimeout(r, 300));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
