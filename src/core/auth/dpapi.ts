/**
 * Windows DPAPI（CurrentUser）加解密。优先通过 pwsh 7 调 .NET ProtectedData，
 * 若未安装 pwsh（ENOENT），则自动回退到 Windows 自带的 PowerShell 5.1（powershell.exe）。
 * 明文只经 stdin（base64）传递，绝不出现在命令行参数里。
 * 局限：同一 Windows 用户下的任何进程都能解密——这是 DPAPI 的威胁模型，README 需明示。
 */
import { spawnSync } from "node:child_process";

export interface SecretCrypto {
  encrypt(plain: string): string;
  decrypt(cipherB64: string): string;
}

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$mode = [Console]::In.ReadLine()
$b = [Convert]::FromBase64String([Console]::In.ReadLine())
if ($mode -eq 'e') { $r = [Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser') }
else { $r = [Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser') }
[Console]::Out.Write([Convert]::ToBase64String($r))
`;

function candidates(): string[] {
  return ["pwsh", "powershell"];
}

function run(mode: "e" | "d", payloadB64: string): string {
  if (process.platform !== "win32") throw new Error("DPAPI 仅支持 Windows");
  let lastErr = "";
  for (const exe of candidates()) {
    const r = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", SCRIPT], {
      input: `${mode}\n${payloadB64}\n`,
      encoding: "utf8",
      windowsHide: true,
    });
    if (r.error) {
      const code = (r.error as NodeJS.ErrnoException).code;
      lastErr = r.error.message;
      if (code === "ENOENT") continue;
      break;
    }
    if (r.status === 0 && r.stdout) return r.stdout.trim();
    lastErr = (r.stderr || "").split("\n")[0]?.trim() || `exit=${String(r.status)}`;
    break;
  }
  throw new Error(`DPAPI 调用失败：${lastErr}`);
}

export const dpapi: SecretCrypto = {
  encrypt: (plain) => run("e", Buffer.from(plain, "utf8").toString("base64")),
  decrypt: (c) => Buffer.from(run("d", c), "base64").toString("utf8"),
};
