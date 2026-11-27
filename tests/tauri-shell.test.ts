import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const TAURI_DIR = path.join(ROOT, "src-tauri");

interface TauriConf {
  productName?: string;
  version?: string;
  identifier?: string;
  app?: {
    security?: {
      capabilities?: string[];
    };
    windows?: Array<{
      label?: string;
      url?: string;
      title?: string;
    }>;
  };
  bundle?: {
    active?: boolean;
    targets?: string | string[];
    icon?: string[];
    resources?: string[] | Record<string, string>;
    windows?: {
      webviewInstallMode?: {
        type?: string;
      };
      nsis?: {
        installMode?: string;
        languages?: string[];
      };
    };
  };
}

interface CapabilityConf {
  identifier?: string;
  windows?: string[];
  permissions?: string[];
}

function findPowerShellBinary(): string | null {
  const candidates = process.platform === "win32" ? ["pwsh", "powershell"] : ["pwsh"];
  for (const bin of candidates) {
    const probe = spawnSync(bin, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"], {
      encoding: "utf8",
    });
    if (!probe.error && probe.status === 0) {
      return bin;
    }
  }
  return null;
}

const POWERSHELL_BIN = findPowerShellBinary();

describe("Tauri v2 桌面壳结构与打包配置校验", () => {
  it("src-tauri/Cargo.toml 包含 tauri v2 与 tauri-plugin-single-instance", () => {
    const cargoPath = path.join(TAURI_DIR, "Cargo.toml");
    expect(fs.existsSync(cargoPath)).toBe(true);
    const cargo = fs.readFileSync(cargoPath, "utf8");

    expect(cargo).toMatch(/^\s*tauri\s*=\s*(?:"2(?:\.[^"]*)?"|\{[^}]*version\s*=\s*"2(?:\.[^"]*)?")/m);
    expect(cargo).toMatch(
      /^\s*tauri-plugin-single-instance\s*=\s*(?:"2(?:\.[^"]*)?"|\{[^}]*version\s*=\s*"2(?:\.[^"]*)?")/m,
    );
    expect(cargo).toMatch(/^\s*tauri-build\s*=\s*(?:"2(?:\.[^"]*)?"|\{[^}]*version\s*=\s*"2(?:\.[^"]*)?")/m);
  });

  it("src-tauri/tauri.conf.json 合法且配置了 nsis、downloadBootstrapper、resources 与图标", () => {
    const confPath = path.join(TAURI_DIR, "tauri.conf.json");
    expect(fs.existsSync(confPath)).toBe(true);
    const conf = JSON.parse(fs.readFileSync(confPath, "utf8")) as TauriConf;

    expect(conf.productName).toBe("Better Endfield Gacha");
    expect(conf.identifier).toBeTruthy();
    expect(conf.app?.security?.capabilities).toContain("default");
    expect(conf.app?.windows?.length).toBeGreaterThanOrEqual(1);
    expect(conf.app?.windows?.[0]?.url).toBe("about:blank");

    expect(conf.bundle?.active).toBe(true);
    const targets = conf.bundle?.targets;
    if (Array.isArray(targets)) {
      expect(targets).toContain("nsis");
    } else {
      expect(targets).toBe("nsis");
    }
    expect(conf.bundle?.windows?.webviewInstallMode?.type).toBe("downloadBootstrapper");

    const resources = conf.bundle?.resources;
    expect(resources).toBeDefined();
    if (Array.isArray(resources)) {
      expect(resources.some((r) => r.includes("resources"))).toBe(true);
    } else {
      expect(Object.keys(resources ?? {}).length).toBeGreaterThan(0);
    }

    const icons = conf.bundle?.icon ?? [];
    expect(icons.length).toBeGreaterThanOrEqual(1);
    for (const relIcon of icons) {
      const iconPath = path.join(TAURI_DIR, relIcon);
      expect(fs.existsSync(iconPath), `missing icon listed in tauri.conf.json: ${relIcon}`).toBe(true);
      expect(fs.statSync(iconPath).size).toBeGreaterThan(0);
    }
  });

  it("src-tauri/capabilities/default.json 与图标/资源占位文件存在且格式正确", () => {
    const capPath = path.join(TAURI_DIR, "capabilities", "default.json");
    expect(fs.existsSync(capPath)).toBe(true);
    const cap = JSON.parse(fs.readFileSync(capPath, "utf8")) as CapabilityConf;
    expect(cap.identifier).toBe("default");
    expect(cap.windows).toContain("main");
    expect(cap.permissions).toContain("core:default");

    const iconsDir = path.join(TAURI_DIR, "icons");
    expect(fs.existsSync(iconsDir)).toBe(true);
    const iconFiles = fs.readdirSync(iconsDir);
    expect(iconFiles.length).toBeGreaterThan(0);

    for (const reqIcon of ["32x32.png", "128x128.png", "128x128@2x.png", "icon.ico", "icon.png"]) {
      const full = path.join(iconsDir, reqIcon);
      expect(fs.existsSync(full), `missing required icon: ${reqIcon}`).toBe(true);
      const buf = fs.readFileSync(full);
      expect(buf.length).toBeGreaterThan(0);
      if (reqIcon.endsWith(".png")) {
        expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      } else if (reqIcon === "icon.ico") {
        expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x00, 0x01, 0x00]));
      }
    }

    expect(fs.existsSync(path.join(TAURI_DIR, "resources", ".gitkeep"))).toBe(true);
  });

  it(".gitignore 忽略 Tauri 构建与暂存产物并保留 resources/.gitkeep", () => {
    const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    const lines = gitignore.split(/\r?\n/).map((l) => l.trim());

    for (const pattern of [
      "src-tauri/target/",
      "src-tauri/gen/",
      "src-tauri/resources/node/",
      "src-tauri/resources/dist/",
      "src-tauri/resources/dist-web/",
      "src-tauri/resources/*.md",
      "src-tauri/resources/LICENSE",
      "!src-tauri/resources/.gitkeep",
    ]) {
      expect(lines, `.gitignore missing rule: ${pattern}`).toContain(pattern);
    }
  });

  it("package.json 注册 pack:tauri 脚本且 scripts/pack-tauri.ps1 具备安全边界", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["pack:tauri"]).toBe("pwsh -NoProfile -File scripts/pack-tauri.ps1");

    const scriptPath = path.join(ROOT, "scripts", "pack-tauri.ps1");
    expect(fs.existsSync(scriptPath)).toBe(true);
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(script).toContain("Set-StrictMode -Version Latest");
    expect(script).toContain('$ErrorActionPreference = "Stop"');
    expect(script).toContain("[switch]$PrepareOnly");
    expect(script).toContain("Get-AuthenticodeSignature");
    expect(script).toContain("SHASUMS256.txt");
    expect(script).toContain("Clear-StagedTauriResources");
    expect(script).not.toMatch(/\[System\.IO\.Path\]::GetTempPath/);
  });

  it.skipIf(process.platform !== "win32" && POWERSHELL_BIN === null)(
    "scripts/pack-tauri.ps1 通过 PowerShell AST 零语法错误校验",
    () => {
      expect(POWERSHELL_BIN).not.toBeNull();
      const scriptPath = path.join(ROOT, "scripts", "pack-tauri.ps1");
      const psCmd =
        "$t=$null; $e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:BEG_PS_TARGET, [ref]$t, [ref]$e); " +
        "if ($e.Count -gt 0) { $e | ForEach-Object { [Console]::Error.WriteLine($_.ToString()) }; exit 1 }";
      const res = spawnSync(POWERSHELL_BIN!, ["-NoProfile", "-NonInteractive", "-Command", psCmd], {
        encoding: "utf8",
        env: { ...process.env, BEG_PS_TARGET: scriptPath },
      });
      expect(res.error).toBeUndefined();
      expect(res.status, `PowerShell parse errors:\n${res.stderr}`).toBe(0);
    },
  );
});
