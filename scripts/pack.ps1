param(
  [string]$NodeVersion = "v24.15.0"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ReleaseDir = Join-Path $RepoRoot "release"
$CacheDir = Join-Path $ReleaseDir "_cache"
$StageDir = Join-Path $ReleaseDir "_stage"
$SmokeDir = Join-Path $ReleaseDir "_smoke_tmp"

function Invoke-Checked {
  param(
    [string]$Label,
    [scriptblock]$Action
  )
  Write-Host "==> $Label"
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
  [void]$sb.AppendLine("本清单由 ``pnpm licenses list --prod --json`` 自动核对生成，并随便携打包产物一并发布。")
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
  [void]$sb.AppendLine("## 2. Windows 便携版随包运行环境")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("Windows 便携压缩包额外内置官方原版 Node.js 运行时：")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("| 组件 | 版本 | 许可证 | 来源与校验 |")
  [void]$sb.AppendLine("|---|---|---|---|")
  [void]$sb.AppendLine("| Node.js (``node/node.exe``) | ``$NodeVer`` (win-x64) | MIT（含其内置 V8 / libuv / OpenSSL / SQLite 等组件各自开源许可） | 下载自 ``https://nodejs.org/dist/$NodeVer/``，打包前经官方 ``SHASUMS256.txt`` SHA256 强制校验 |")
  return $sb.ToString()
}

$smokeProc = $null
$hadWebDirEnv = Test-Path Env:BEG_WEB_DIR
$oldWebDirEnv = if ($hadWebDirEnv) { $env:BEG_WEB_DIR } else { $null }
$hadDataDirEnv = Test-Path Env:BEG_DATA_DIR
$oldDataDirEnv = if ($hadDataDirEnv) { $env:BEG_DATA_DIR } else { $null }

Push-Location $RepoRoot
try {
  New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null

  if (Test-Path (Join-Path $RepoRoot "dist")) {
    Remove-Item -Path (Join-Path $RepoRoot "dist") -Recurse -Force
  }
  if (Test-Path (Join-Path $RepoRoot "dist-web")) {
    Remove-Item -Path (Join-Path $RepoRoot "dist-web") -Recurse -Force
  }

  Invoke-Checked "pnpm install --frozen-lockfile" { pnpm install --frozen-lockfile }
  Invoke-Checked "pnpm typecheck" { pnpm typecheck }
  Invoke-Checked "pnpm test" { pnpm test }
  Invoke-Checked "pnpm build" { pnpm build }

  $pkgJson = Get-Content -Path (Join-Path $RepoRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  $version = [string]$pkgJson.version
  $pkgName = "better-endfield-gacha-$version-win-x64"
  $zipPath = Join-Path $ReleaseDir "$pkgName.zip"
  $shaPath = "$zipPath.sha256"

  $nodeZip = Get-NodeBinaryCached -Version $NodeVersion -CacheRoot $CacheDir

  if (Test-Path $StageDir) { Remove-Item -Path $StageDir -Recurse -Force }
  if (Test-Path $SmokeDir) { Remove-Item -Path $SmokeDir -Recurse -Force }

  $stagePkg = Join-Path $StageDir $pkgName
  $appDir = Join-Path $stagePkg "app"
  $nodeDir = Join-Path $stagePkg "node"
  New-Item -ItemType Directory -Path $appDir -Force | Out-Null
  New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null

  # 只提取 node.exe
  $zipArchive = [System.IO.Compression.ZipFile]::OpenRead($nodeZip)
  try {
    $nodeEntry = $zipArchive.Entries | Where-Object { $_.FullName -match "(^|/)node\.exe$" } | Select-Object -First 1
    if (-not $nodeEntry) {
      throw "node.exe not found inside $nodeZip"
    }
    $destNodeExe = Join-Path $nodeDir "node.exe"
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($nodeEntry, $destNodeExe, $true)
  } finally {
    $zipArchive.Dispose()
  }

  Copy-Item -Path (Join-Path $RepoRoot "dist") -Destination (Join-Path $appDir "dist") -Recurse -Force
  Copy-Item -Path (Join-Path $RepoRoot "dist-web") -Destination (Join-Path $appDir "dist-web") -Recurse -Force

  $requiredBuilt = @(
    (Join-Path $appDir "dist\cli\index.js"),
    (Join-Path $appDir "dist\core\data\up-map.json"),
    (Join-Path $appDir "dist-web\index.html")
  )
  foreach ($reqFile in $requiredBuilt) {
    if (-not (Test-Path $reqFile)) {
      throw "Missing required build artifact: $reqFile"
    }
  }

  $appPkgJson = @{
    name    = "better-endfield-gacha"
    version = $version
    private = $true
    type    = "module"
    engines = @{ node = ">=22.13" }
  } | ConvertTo-Json -Depth 4
  Write-Utf8NoBom -Path (Join-Path $appDir "package.json") -Content "$appPkgJson`n"

  $begCmd = @"
@echo off
setlocal
if not defined BEG_WEB_DIR set "BEG_WEB_DIR=%~dp0app\dist-web"
if not defined BEG_DATA_DIR set "BEG_DATA_DIR=%~dp0data"
if "%~1"=="" (
  "%~dp0node\node.exe" "%~dp0app\dist\cli\index.js" serve
) else (
  "%~dp0node\node.exe" "%~dp0app\dist\cli\index.js" %*
)
set "EC=%ERRORLEVEL%"
endlocal & exit /b %EC%
"@
  [System.IO.File]::WriteAllText((Join-Path $stagePkg "beg.cmd"), ($begCmd -replace "`r?`n", "`r`n"), [System.Text.Encoding]::ASCII)

  Copy-Item -Path (Join-Path $RepoRoot "LICENSE") -Destination (Join-Path $stagePkg "LICENSE") -Force
  Copy-Item -Path (Join-Path $RepoRoot "NOTICE.md") -Destination (Join-Path $stagePkg "NOTICE.md") -Force
  Copy-Item -Path (Join-Path $RepoRoot "QUICKSTART.md") -Destination (Join-Path $stagePkg "QUICKSTART.md") -Force

  $licJsonRaw = (& pnpm licenses list --prod --json) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm licenses list --prod --json failed"
  }
  $thirdPartyContent = New-ThirdPartyMarkdown -NodeVer $NodeVersion -RawLicenseJson $licJsonRaw
  Write-Utf8NoBom -Path (Join-Path $stagePkg "THIRD_PARTY.md") -Content $thirdPartyContent

  if (Test-Path $zipPath) { Remove-Item -Path $zipPath -Force }
  if (Test-Path $shaPath) { Remove-Item -Path $shaPath -Force }

  Write-Host "==> Archiving $zipPath"
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stagePkg,
    $zipPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )

  # 校验压缩包无敏感/运行期目录泄露
  $verifyZip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    foreach ($entry in $verifyZip.Entries) {
      $n = $entry.FullName.Replace("\", "/")
      if ($n -match "^data/" -or $n -match "(^|/)vault\.json$" -or $n -match "\.sqlite(-wal|-shm)?$" -or $n -match "(^|/)_local/") {
        throw "Forbidden runtime/sensitive entry detected in zip: $n"
      }
    }
  } finally {
    $verifyZip.Dispose()
  }

  $zipSha = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Utf8NoBom -Path $shaPath -Content "$zipSha  $pkgName.zip`n"

  # 真实解压冒烟（全部落 E: 盘 release/_smoke_tmp）
  Write-Host "==> Running portable unzip smoke test in $SmokeDir"
  $smokeExtract = Join-Path $SmokeDir "extract"
  $smokeData = Join-Path $SmokeDir "data"
  New-Item -ItemType Directory -Path $smokeExtract -Force | Out-Null
  New-Item -ItemType Directory -Path $smokeData -Force | Out-Null

  [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $smokeExtract)

  $smokeBegCmd = Join-Path $smokeExtract "beg.cmd"
  if (-not (Test-Path $smokeBegCmd)) {
    throw "Smoke check missing beg.cmd"
  }
  if (-not (Test-Path (Join-Path $smokeExtract "app\dist\core\data\up-map.json"))) {
    throw "Smoke check missing app/dist/core/data/up-map.json"
  }

  Remove-Item Env:BEG_WEB_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:BEG_DATA_DIR -ErrorAction SilentlyContinue

  $verOut = (& $smokeBegCmd version) | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Smoke 'beg.cmd version' failed with exit code $LASTEXITCODE"
  }
  if ($verOut.Trim() -ne $version) {
    throw "Smoke 'beg.cmd version' mismatch: expected '$version', got '$($verOut.Trim())'"
  }
  Write-Host "    beg.cmd version => $($verOut.Trim())"

  $stdoutLog = Join-Path $SmokeDir "serve.stdout.log"
  $stderrLog = Join-Path $SmokeDir "serve.stderr.log"
  $smokeProc = Start-Process -FilePath $smokeBegCmd `
    -ArgumentList @("serve", "--port", "0", "--no-open", "--data-dir", "`"$smokeData`"") `
    -WorkingDirectory $smokeExtract `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -WindowStyle Hidden `
    -PassThru

  $baseUrl = $null
  $apiKey = $null
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    if ($smokeProc.HasExited) {
      $errTxt = if (Test-Path $stderrLog) { Get-Content $stderrLog -Raw } else { "" }
      $outTxt = if (Test-Path $stdoutLog) { Get-Content $stdoutLog -Raw } else { "" }
      throw "Smoke serve exited early (code=$($smokeProc.ExitCode)). stdout=$outTxt stderr=$errTxt"
    }
    if (Test-Path $stdoutLog) {
      $outContent = Get-Content $stdoutLog -Raw -ErrorAction SilentlyContinue
      if ($outContent -match "(http://127\.0\.0\.1:\d+)/#k=([A-Za-z0-9_-]+)") {
        $baseUrl = $Matches[1]
        $apiKey = $Matches[2]
        break
      }
    }
    Start-Sleep -Milliseconds 150
  }

  if (-not $baseUrl -or -not $apiKey) {
    $errTxt = if (Test-Path $stderrLog) { Get-Content $stderrLog -Raw } else { "" }
    $outTxt = if (Test-Path $stdoutLog) { Get-Content $stdoutLog -Raw } else { "" }
    throw "Timed out waiting for serve URL. stdout=$outTxt stderr=$errTxt"
  }

  # 1) 验证静态前端首页 200
  $rootRes = Invoke-WebRequest -Uri "$baseUrl/" -UseBasicParsing -TimeoutSec 10
  if ($rootRes.StatusCode -ne 200 -or $rootRes.Content -notmatch "Better Endfield Gacha") {
    throw "Smoke GET / failed: status=$($rootRes.StatusCode)"
  }

  # 2) 验证无密钥访问 /api/health 被拒绝（401）
  try {
    $null = Invoke-WebRequest -Uri "$baseUrl/api/health" -UseBasicParsing -TimeoutSec 10
    throw "Smoke unauthenticated /api/health unexpectedly returned 200"
  } catch {
    $resp = $_.Exception.Response
    if (-not $resp -or [int]$resp.StatusCode -ne 401) {
      throw "Smoke unauthenticated /api/health expected 401, got: $($_.Exception.Message)"
    }
  }

  # 3) 验证携带 X-BEG-Key 访问 /api/health 返回 200 与正确 version
  $healthRes = Invoke-WebRequest -Uri "$baseUrl/api/health" -Headers @{ "X-BEG-Key" = $apiKey } -UseBasicParsing -TimeoutSec 10
  if ($healthRes.StatusCode -ne 200) {
    throw "Smoke /api/health status=$($healthRes.StatusCode)"
  }
  $healthJson = $healthRes.Content | ConvertFrom-Json
  if (-not $healthJson.ok -or $healthJson.version -ne $version) {
    throw "Smoke /api/health body mismatch: $($healthRes.Content)"
  }

  # 4) 验证数据落入指定的 --data-dir 而非解压根
  if (-not (Test-Path (Join-Path $smokeData "gacha.sqlite"))) {
    throw "Smoke expected gacha.sqlite inside $smokeData"
  }
  if (Test-Path (Join-Path $smokeExtract "data")) {
    throw "Smoke unexpected data directory inside $smokeExtract"
  }

  $zipItem = Get-Item $zipPath
  $zipMB = [math]::Round($zipItem.Length / 1MB, 2)
  Write-Host "==> Smoke PASSED! Portable zip ready:"
  Write-Host "    Path : $zipPath"
  Write-Host "    Size : $($zipItem.Length) bytes ($zipMB MB)"
  Write-Host "    SHA256: $zipSha"
} finally {
  if ($hadWebDirEnv) { $env:BEG_WEB_DIR = $oldWebDirEnv } else { Remove-Item Env:BEG_WEB_DIR -ErrorAction SilentlyContinue }
  if ($hadDataDirEnv) { $env:BEG_DATA_DIR = $oldDataDirEnv } else { Remove-Item Env:BEG_DATA_DIR -ErrorAction SilentlyContinue }

  if ($smokeProc -and -not $smokeProc.HasExited) {
    try {
      $smokeProc.Kill($true)
      [void]$smokeProc.WaitForExit(5000)
    } catch {
      Write-Warning "Failed to kill smoke process tree: $($_.Exception.Message)"
    }
    Start-Sleep -Milliseconds 250
  }

  if (Test-Path $StageDir) {
    Remove-Item -Path $StageDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $SmokeDir) {
    Remove-Item -Path $SmokeDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}
