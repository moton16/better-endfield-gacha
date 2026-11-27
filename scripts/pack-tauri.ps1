param(
  [string]$NodeVersion = "v24.15.0",
  [switch]$PrepareOnly,
  [switch]$KeepStaged,
  [switch]$AllowUnsignedNode,
  [switch]$WithTests,
  [switch]$SkipChecks
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ReleaseDir = Join-Path $RepoRoot "release"
$CacheDir = Join-Path $ReleaseDir "_cache"
$StageDir = Join-Path $ReleaseDir "_tauri_stage"
$TempDir = Join-Path $ReleaseDir "_tauri_tmp"
$TauriDir = Join-Path $RepoRoot "src-tauri"
$ResourcesDir = Join-Path $TauriDir "resources"

function Invoke-Checked {
  param(
    [string]$Label,
    [scriptblock]$Action
  )
  Write-Host "==> $Label"
  $global:LASTEXITCODE = 0
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Content
  )
  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Get-NodeBinaryCached {
  param(
    [string]$Version,
    [string]$CacheRoot
  )
  New-Item -ItemType Directory -Path $CacheRoot -Force | Out-Null

  $archiveName = "node-$Version-win-x64.zip"
  $shasumUrl = "https://nodejs.org/dist/$Version/SHASUMS256.txt"
  $archiveUrl = "https://nodejs.org/dist/$Version/$archiveName"

  $shasumCache = Join-Path $CacheRoot "node-$Version-SHASUMS256.txt"
  $archiveCache = Join-Path $CacheRoot $archiveName

  if (-not (Test-Path $shasumCache)) {
    $shasumPart = "$shasumCache.part"
    if (Test-Path $shasumPart) { Remove-Item $shasumPart -Force }
    Write-Host "==> Downloading $shasumUrl -> $shasumCache"
    try {
      Invoke-WebRequest -Uri $shasumUrl -OutFile $shasumPart -UseBasicParsing -TimeoutSec 30
      Move-Item -Path $shasumPart -Destination $shasumCache -Force
    } catch {
      if (Test-Path $shasumPart) { Remove-Item $shasumPart -Force }
      throw "Failed to download SHASUMS256.txt from ${shasumUrl}: $($_.Exception.Message)"
    }
  }

  $shasumLines = Get-Content -Path $shasumCache -Encoding UTF8
  $pattern = "^([0-9a-fA-F]{64})\s+\*?" + [regex]::Escape($archiveName) + "$"
  $expectedSha = $null
  foreach ($line in $shasumLines) {
    $m = [regex]::Match($line.Trim(), $pattern)
    if ($m.Success) {
      $expectedSha = $m.Groups[1].Value.ToLowerInvariant()
      break
    }
  }
  if (-not $expectedSha) {
    throw "SHA256 entry for $archiveName not found in $shasumCache"
  }

  if (Test-Path $archiveCache) {
    $actualSha = (Get-FileHash -Path $archiveCache -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha -eq $expectedSha) {
      Write-Host "==> Cache hit & SHA256 verified: $archiveName ($expectedSha)"
      return $archiveCache
    }
    Write-Warning "Cached archive SHA256 mismatch ($actualSha != $expectedSha), deleting and re-downloading."
    Remove-Item -Path $archiveCache -Force
  }

  $archivePart = "$archiveCache.part"
  if (Test-Path $archivePart) { Remove-Item $archivePart -Force }
  Write-Host "==> Downloading $archiveUrl -> $archiveCache"
  try {
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePart -UseBasicParsing -TimeoutSec 180
    $downloadSha = (Get-FileHash -Path $archivePart -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($downloadSha -ne $expectedSha) {
      throw "SHA256 verification failed for ${archiveName}: expected=$expectedSha actual=$downloadSha"
    }
    Move-Item -Path $archivePart -Destination $archiveCache -Force
    Write-Host "==> Downloaded & SHA256 verified: $archiveName ($expectedSha)"
    return $archiveCache
  } catch {
    if (Test-Path $archivePart) { Remove-Item $archivePart -Force }
    throw
  }
}

function New-ThirdPartyMarkdown {
  param(
    [string]$NodeVer,
    [string]$RawLicenseJson
  )
  $parsed = $RawLicenseJson | ConvertFrom-Json
  $rows = [System.Collections.Generic.List[string]]::new()
  foreach ($prop in $parsed.PSObject.Properties) {
    foreach ($item in $prop.Value) {
      $ver = ($item.versions -join ", ")
      $desc = ([string]$item.description).Replace("|", "\|").Replace("`r", "").Replace("`n", " ")
      $hp = [string]$item.homepage
      $lic = [string]$item.license
      $rows.Add("| ``$($item.name)`` | ``$ver`` | $lic | $desc | $hp |")
    }
  }
  $rows.Sort()

  $sb = [System.Text.StringBuilder]::new()
  [void]$sb.AppendLine("# 第三方开源组件清单（THIRD_PARTY）")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("本清单由 ``pnpm licenses list --prod --json`` 自动核对生成，并随桌面安装版 / 便携版打包产物一并发布。")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("## 1. 应用运行时 npm 依赖")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("核心解析、本地数据库、本地服务与命令行模块均基于 Node.js 内置能力实现，**零第三方 npm 运行时依赖**；仅前端图形界面使用了以下构建入静态资源包的运行时依赖：")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("| 包名 | 版本 | 许可证 | 说明 | 主页 |")
  [void]$sb.AppendLine("|---|---|---|---|---|")
  if ($rows.Count -eq 0) {
    [void]$sb.AppendLine("| （无） | - | - | - | - |")
  } else {
    foreach ($r in $rows) {
      [void]$sb.AppendLine($r)
    }
  }
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("## 2. Windows 桌面版随包运行环境")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("Windows 桌面安装版与桌面便携包额外内置官方原版 Node.js 运行时：")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("| 组件 | 版本 | 许可证 | 来源与校验 |")
  [void]$sb.AppendLine("|---|---|---|---|")
  [void]$sb.AppendLine("| Node.js (``node/node.exe``) | ``$NodeVer`` (win-x64) | MIT（含其内置 V8 / libuv / OpenSSL / SQLite 等组件各自开源许可） | 下载自 ``https://nodejs.org/dist/$NodeVer/``，打包前经官方 ``SHASUMS256.txt`` SHA256 及 Authenticode 数字签名强制校验 |")
  return $sb.ToString()
}

function Clear-StagedTauriResources {
  param(
    [string]$Root
  )
  if (-not (Test-Path $Root)) {
    return
  }
  $transientDirs = @("node", "dist", "dist-web")
  foreach ($dirName in $transientDirs) {
    $dirPath = Join-Path $Root $dirName
    if (Test-Path $dirPath) {
      Remove-Item -Path $dirPath -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  $transientFiles = @("LICENSE", "NOTICE.md", "QUICKSTART.md", "THIRD_PARTY.md")
  foreach ($fileName in $transientFiles) {
    $filePath = Join-Path $Root $fileName
    if (Test-Path $filePath) {
      Remove-Item -Path $filePath -Force -ErrorAction SilentlyContinue
    }
  }
  Get-ChildItem -Path $Root -Filter "*.md" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
  }
}

function Get-TauriBinaryName {
  param(
    [string]$TauriRoot
  )
  $confPath = Join-Path $TauriRoot "tauri.conf.json"
  if (Test-Path $confPath) {
    $conf = Get-Content -Path $confPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($conf.PSObject.Properties.Name -contains "mainBinaryName" -and -not [string]::IsNullOrWhiteSpace([string]$conf.mainBinaryName)) {
      return [string]$conf.mainBinaryName
    }
  }

  $cargoPath = Join-Path $TauriRoot "Cargo.toml"
  if (-not (Test-Path $cargoPath)) {
    throw "Missing $cargoPath"
  }
  $cargoText = Get-Content -Path $cargoPath -Raw -Encoding UTF8
  $binMatch = [regex]::Match($cargoText, "(?ms)^\[\[bin\]\]\s.*?^name\s*=\s*""([^""]+)""")
  if ($binMatch.Success) {
    return $binMatch.Groups[1].Value
  }
  $pkgMatch = [regex]::Match($cargoText, "(?ms)^\[package\]\s.*?^name\s*=\s*""([^""]+)""")
  if ($pkgMatch.Success) {
    return $pkgMatch.Groups[1].Value
  }
  throw "Could not determine Tauri binary name from $confPath or $cargoPath"
}

function Invoke-TauriNsisBuild {
  param(
    [string]$RootDir
  )
  $customCli = if (Test-Path Env:BEG_TAURI_CLI) { $env:BEG_TAURI_CLI } else { $null }
  if (-not [string]::IsNullOrWhiteSpace($customCli)) {
    $trimmedCli = $customCli.Trim()
    $resolvedCustom = if (Test-Path -Path $trimmedCli -PathType Leaf) {
      (Resolve-Path -Path $trimmedCli).Path
    } else {
      $cmd = Get-Command $trimmedCli -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($cmd) { $cmd.Source } else { $null }
    }
    if (-not $resolvedCustom) {
      throw "BEG_TAURI_CLI points to a missing executable or command: $trimmedCli"
    }
    Invoke-Checked "$resolvedCustom build --bundles nsis" { & $resolvedCustom build --bundles nsis }
    return
  }

  $cargoTauri = Get-Command "cargo-tauri" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cargoTauri) {
    Invoke-Checked "cargo tauri build --bundles nsis" { cargo tauri build --bundles nsis }
    return
  }

  $candidatePaths = @(
    (Join-Path $RootDir "node_modules\.bin\tauri.cmd"),
    "D:\dependency\tauri-cli\bin\cargo-tauri.exe",
    "D:\dependency\tauri-cli\node_modules\.bin\tauri.cmd"
  )
  foreach ($candidate in $candidatePaths) {
    if (Test-Path -Path $candidate -PathType Leaf) {
      Invoke-Checked "$candidate build --bundles nsis" { & $candidate build --bundles nsis }
      return
    }
  }

  foreach ($tauriName in @("tauri.cmd", "tauri")) {
    $globalTauri = Get-Command $tauriName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($globalTauri) {
      Invoke-Checked "$($globalTauri.Source) build --bundles nsis" { & $globalTauri.Source build --bundles nsis }
      return
    }
  }

  foreach ($npxName in @("npx.cmd", "npx")) {
    $npxCmd = Get-Command $npxName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($npxCmd) {
      Write-Host "==> Tauri CLI not found locally; falling back to npx --yes @tauri-apps/cli@2"
      Invoke-Checked "npx --yes @tauri-apps/cli@2 build --bundles nsis" {
        & $npxCmd.Source --yes "@tauri-apps/cli@2" build --bundles nsis
      }
      return
    }
  }

  throw "Tauri CLI not found (checked BEG_TAURI_CLI, cargo-tauri, node_modules\.bin\tauri.cmd, D:\dependency\tauri-cli, tauri, and npx). Install with 'cargo install tauri-cli --version ^2' or install '@tauri-apps/cli@^2' into D:\dependency\tauri-cli."
}

$hadTempEnv = Test-Path Env:TEMP
$oldTempEnv = if ($hadTempEnv) { $env:TEMP } else { $null }
$hadTmpEnv = Test-Path Env:TMP
$oldTmpEnv = if ($hadTmpEnv) { $env:TMP } else { $null }
$hadNpmCacheEnv = Test-Path Env:npm_config_cache
$oldNpmCacheEnv = if ($hadNpmCacheEnv) { $env:npm_config_cache } else { $null }

Push-Location $RepoRoot
try {
  New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
  New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $CacheDir "npm") -Force | Out-Null

  # Redirect process temp and npm fallback cache dirs to same-drive release/
  $env:TEMP = $TempDir
  $env:TMP = $TempDir
  $env:npm_config_cache = Join-Path $CacheDir "npm"

  if (-not (Test-Path (Join-Path $TauriDir "Cargo.toml")) -or -not (Test-Path (Join-Path $TauriDir "tauri.conf.json"))) {
    throw "Tauri shell project not found under $TauriDir"
  }

  if (Test-Path (Join-Path $RepoRoot "dist")) {
    Remove-Item -Path (Join-Path $RepoRoot "dist") -Recurse -Force
  }
  if (Test-Path (Join-Path $RepoRoot "dist-web")) {
    Remove-Item -Path (Join-Path $RepoRoot "dist-web") -Recurse -Force
  }

  $isRelease = $env:BEG_RELEASE -in @("1", "true")
  if ($isRelease -and $SkipChecks) {
    throw "BEG_RELEASE=1 forbids -SkipChecks"
  }
  if (-not $SkipChecks) {
    Invoke-Checked "pnpm install --frozen-lockfile" { pnpm install --frozen-lockfile }
    Invoke-Checked "pnpm typecheck" { pnpm typecheck }
    if ($isRelease -or $WithTests) {
      Invoke-Checked "pnpm test" { pnpm test }
    } else {
      Write-Host "Non-release build: skipping full pnpm test (only runs when BEG_RELEASE=1 or -WithTests)"
    }
  } else {
    Write-Host "SkipChecks: 跳过 install / typecheck / test（仅构建，非发布流程）"
  }
  Invoke-Checked "pnpm build" { pnpm build }

  $builtCli = Join-Path $RepoRoot "dist\cli\index.js"
  $builtUpMap = Join-Path $RepoRoot "dist\core\data\up-map.json"
  $builtWebIndex = Join-Path $RepoRoot "dist-web\index.html"
  foreach ($reqFile in @($builtCli, $builtUpMap, $builtWebIndex)) {
    if (-not (Test-Path $reqFile)) {
      throw "Missing required build artifact: $reqFile"
    }
  }

  $pkgJson = Get-Content -Path (Join-Path $RepoRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  $version = [string]$pkgJson.version
  if ([string]::IsNullOrWhiteSpace($version)) {
    throw "Missing version in package.json"
  }

  $nodeZip = Get-NodeBinaryCached -Version $NodeVersion -CacheRoot $CacheDir

  Clear-StagedTauriResources -Root $ResourcesDir
  New-Item -ItemType Directory -Path (Join-Path $ResourcesDir "node") -Force | Out-Null

  # Extract node.exe to src-tauri/resources/node/node.exe and verify Authenticode signature
  $destNodeExe = Join-Path $ResourcesDir "node\node.exe"
  $zipArchive = [System.IO.Compression.ZipFile]::OpenRead($nodeZip)
  try {
    $nodeEntry = $zipArchive.Entries | Where-Object { $_.FullName -match "(^|/)node\.exe$" } | Select-Object -First 1
    if (-not $nodeEntry) {
      throw "node.exe not found inside $nodeZip"
    }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($nodeEntry, $destNodeExe, $true)
  } finally {
    $zipArchive.Dispose()
  }

  $sig = Get-AuthenticodeSignature -FilePath $destNodeExe
  if ($sig.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    $signer = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { "<none>" }
    $sigMsg = "node.exe Authenticode signature check failed (Status=$($sig.Status), Signer=$signer)"
    if (-not $AllowUnsignedNode) {
      throw "$sigMsg. Re-run with -AllowUnsignedNode only for local non-release debugging."
    }
    Write-Warning "$sigMsg (bypassed via -AllowUnsignedNode)"
  } else {
    Write-Host "==> Verified node.exe Authenticode signature: $($sig.SignerCertificate.Subject)"
  }

  # Stage dist/, dist-web/ (with media/ if built), LICENSE, NOTICE.md, QUICKSTART.md, THIRD_PARTY.md
  Copy-Item -Path (Join-Path $RepoRoot "dist") -Destination (Join-Path $ResourcesDir "dist") -Recurse -Force
  Copy-Item -Path (Join-Path $RepoRoot "dist-web") -Destination (Join-Path $ResourcesDir "dist-web") -Recurse -Force
  Copy-Item -Path (Join-Path $RepoRoot "LICENSE") -Destination (Join-Path $ResourcesDir "LICENSE") -Force
  Copy-Item -Path (Join-Path $RepoRoot "NOTICE.md") -Destination (Join-Path $ResourcesDir "NOTICE.md") -Force
  Copy-Item -Path (Join-Path $RepoRoot "QUICKSTART.md") -Destination (Join-Path $ResourcesDir "QUICKSTART.md") -Force

  $licJsonRaw = (& pnpm licenses list --prod --json) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm licenses list --prod --json failed with exit code $LASTEXITCODE"
  }
  $thirdPartyContent = New-ThirdPartyMarkdown -NodeVer $NodeVersion -RawLicenseJson $licJsonRaw
  Write-Utf8NoBom -Path (Join-Path $ResourcesDir "THIRD_PARTY.md") -Content $thirdPartyContent

  $stagedRequired = @(
    (Join-Path $ResourcesDir "node\node.exe"),
    (Join-Path $ResourcesDir "dist\cli\index.js"),
    (Join-Path $ResourcesDir "dist\core\data\up-map.json"),
    (Join-Path $ResourcesDir "dist-web\index.html"),
    (Join-Path $ResourcesDir "LICENSE"),
    (Join-Path $ResourcesDir "NOTICE.md"),
    (Join-Path $ResourcesDir "QUICKSTART.md"),
    (Join-Path $ResourcesDir "THIRD_PARTY.md")
  )
  foreach ($reqStaged in $stagedRequired) {
    if (-not (Test-Path $reqStaged)) {
      throw "Missing staged Tauri resource: $reqStaged"
    }
  }

  if ($PrepareOnly) {
    $nodeSha = (Get-FileHash -Path $destNodeExe -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host "==> PrepareOnly PASSED: staged Tauri resources & verified node.exe ($nodeSha)"
    return
  }

  # Build NSIS + desktop binary via Tauri CLI
  Invoke-TauriNsisBuild -RootDir $RepoRoot

  $binName = Get-TauriBinaryName -TauriRoot $TauriDir
  $targetReleaseDir = Join-Path $TauriDir "target\release"
  $builtExePath = Join-Path $targetReleaseDir "$binName.exe"
  if (-not (Test-Path $builtExePath)) {
    throw "Expected Tauri desktop binary not found: $builtExePath"
  }

  $nsisDir = Join-Path $targetReleaseDir "bundle\nsis"
  if (-not (Test-Path $nsisDir)) {
    throw "Expected NSIS bundle directory not found: $nsisDir"
  }
  $nsisSetup = Get-ChildItem -Path $nsisDir -Filter "*-setup.exe" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $nsisSetup) {
    throw "Expected NSIS installer (*-setup.exe) not found inside $nsisDir"
  }

  # Copy NSIS installer to release/ + .sha256
  $setupName = "better-endfield-gacha-$version-win-x64-setup.exe"
  $setupOutPath = Join-Path $ReleaseDir $setupName
  $setupShaPath = "$setupOutPath.sha256"
  Copy-Item -Path $nsisSetup.FullName -Destination $setupOutPath -Force
  $setupSha = (Get-FileHash -Path $setupOutPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Utf8NoBom -Path $setupShaPath -Content "$setupSha  $setupName`n"

  # Assemble Desktop Portable zip + .sha256
  if (Test-Path $StageDir) { Remove-Item -Path $StageDir -Recurse -Force }
  $desktopStage = Join-Path $StageDir "desktop"
  $desktopResources = Join-Path $desktopStage "resources"
  New-Item -ItemType Directory -Path $desktopResources -Force | Out-Null

  Copy-Item -Path $builtExePath -Destination (Join-Path $desktopStage "$binName.exe") -Force
  Copy-Item -Path (Join-Path $ResourcesDir "node") -Destination (Join-Path $desktopResources "node") -Recurse -Force
  Copy-Item -Path (Join-Path $ResourcesDir "dist") -Destination (Join-Path $desktopResources "dist") -Recurse -Force
  Copy-Item -Path (Join-Path $ResourcesDir "dist-web") -Destination (Join-Path $desktopResources "dist-web") -Recurse -Force
  Copy-Item -Path (Join-Path $ResourcesDir "LICENSE") -Destination (Join-Path $desktopStage "LICENSE") -Force
  Copy-Item -Path (Join-Path $ResourcesDir "NOTICE.md") -Destination (Join-Path $desktopStage "NOTICE.md") -Force
  Copy-Item -Path (Join-Path $ResourcesDir "QUICKSTART.md") -Destination (Join-Path $desktopStage "QUICKSTART.md") -Force
  Copy-Item -Path (Join-Path $ResourcesDir "THIRD_PARTY.md") -Destination (Join-Path $desktopStage "THIRD_PARTY.md") -Force

  $desktopZipName = "better-endfield-gacha-$version-win-x64-desktop.zip"
  $desktopZipPath = Join-Path $ReleaseDir $desktopZipName
  $desktopShaPath = "$desktopZipPath.sha256"
  if (Test-Path $desktopZipPath) { Remove-Item -Path $desktopZipPath -Force }
  if (Test-Path $desktopShaPath) { Remove-Item -Path $desktopShaPath -Force }

  Write-Host "==> Archiving $desktopZipPath"
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $desktopStage,
    $desktopZipPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )

  # Verify no runtime/sensitive paths leaked into Desktop Portable zip and required entries exist
  $verifyZip = [System.IO.Compression.ZipFile]::OpenRead($desktopZipPath)
  try {
    $entrySet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $verifyZip.Entries) {
      $n = $entry.FullName.Replace("\", "/")
      [void]$entrySet.Add($n)
      if (
        $n -match "^(?:resources/)?data/" -or
        $n -match "(^|/)vault\.json$" -or
        $n -match "\.sqlite(-wal|-shm)?$" -or
        $n -match "(^|/)_local/"
      ) {
        throw "Forbidden runtime/sensitive entry detected in desktop zip: $n"
      }
    }
    $expectedEntries = @(
      "$binName.exe",
      "resources/node/node.exe",
      "resources/dist/cli/index.js",
      "resources/dist/core/data/up-map.json",
      "resources/dist-web/index.html",
      "LICENSE",
      "NOTICE.md",
      "QUICKSTART.md",
      "THIRD_PARTY.md"
    )
    foreach ($reqEntry in $expectedEntries) {
      if (-not $entrySet.Contains($reqEntry)) {
        throw "Missing required entry in desktop zip: $reqEntry"
      }
    }
  } finally {
    $verifyZip.Dispose()
  }

  $desktopSha = (Get-FileHash -Path $desktopZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Utf8NoBom -Path $desktopShaPath -Content "$desktopSha  $desktopZipName`n"

  Write-Host "==> Tauri desktop packaging PASSED:"
  Write-Host "    NSIS Installer : $setupOutPath ($setupSha)"
  Write-Host "    Desktop Zip    : $desktopZipPath ($desktopSha)"
} finally {
  if ($hadTempEnv) { $env:TEMP = $oldTempEnv } else { Remove-Item Env:TEMP -ErrorAction SilentlyContinue }
  if ($hadTmpEnv) { $env:TMP = $oldTmpEnv } else { Remove-Item Env:TMP -ErrorAction SilentlyContinue }
  if ($hadNpmCacheEnv) { $env:npm_config_cache = $oldNpmCacheEnv } else { Remove-Item Env:npm_config_cache -ErrorAction SilentlyContinue }

  if (-not $KeepStaged) {
    Clear-StagedTauriResources -Root $ResourcesDir
  }
  if (Test-Path $StageDir) {
    Remove-Item -Path $StageDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $TempDir) {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}
