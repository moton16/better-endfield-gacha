/**
 * Windows DPAPI（CurrentUser）加解密。通过 pwsh 调 .NET ProtectedData；
 * 明文只经 stdin（base64）传递，绝不出现在命令行参数里。
 * 局限：同一 Windows 用户下的任何进程都能解密——这是 DPAPI 的威胁模型，README 需明示。
 */
import { spawnSync } from "node:child_process";

export interface SecretCrypto {
  encrypt(plain: string): string;
  decrypt(cipherB64: string): string;
}

const SCRIPT = `
$mode = [Console]::In.ReadLine()
$b = [Convert]::FromBase64String([Console]::In.ReadLine())
if ($mode -eq 'e') { $r = [Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser') }
else { $r = [Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser') }
[Console]::Out.Write([Convert]::ToBase64String($r))
`;

function run(mode: "e" | "d", payloadB64: string): string {
  if (process.platform !== "win32") throw new Error("DPAPI 仅支持 Windows");
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", SCRIPT], {
    input: `${mode}\n${payloadB64}\n`,
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0 || !r.stdout) throw new Error(`DPAPI 调用失败（需要 pwsh 7）：${(r.stderr || "").split("\n")[0] ?? ""}`);
  return r.stdout.trim();
}

export const dpapi: SecretCrypto = {
  encrypt: (plain) => run("e", Buffer.from(plain, "utf8").toString("base64")),
  decrypt: (c) => Buffer.from(run("d", c), "base64").toString("utf8"),
};
