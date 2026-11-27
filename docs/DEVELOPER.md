# Better Endfield Gacha 开发者指南

> **阅读路由**：开发或修改本仓库，**通读本文档即可**（始终维护当前 HEAD 现态，禁止顶部叠补丁）。
> `docs/` 受 `.gitignore` 的 `docs/*` 保护，本地计划/审查/草稿请放 `docs/_local/`；历史技术流水在 `docs/dev_changelog/`（非溯源不读）。

---

## 1. 概况与设计红线

- **定位**：《明日方舟：终末地》抽卡凭据提取 + 记录拉取/本地持久化/保底分析/本地 Web UI/Tauri v2 桌面轻壳与便携分发工具。双模：
  - **路线 A（Windows PC 客户端）**：只读解析本机 Chromium 磁盘缓存取 `u8_token`，零绑定、游戏运行期可热读；首次验证后加密缓存至 `u8-cache.json` 并优先复用，仅在 `40100` 等凭据失效时被动回源重扫。
  - **路线 B（鹰角通行证）**：`hytoken → grant → binding_list → u8_token_by_uid`，跨平台、不开游戏即可同步全部可用绑定（扫码登录三接口已于 2026-11-26 真机实证，前端 SVG 二维码与 CLI 终端字符二维码均已就绪）。
- **非目标**：不做内存注入（AntiCheatExpert 风险）、不做抓包/中间人、不绑定 B 站账号直登（无公开可行路径）；仓库已在 `src/web/public/media/` 随包内置 241 个游戏衍生 `.webp` 资源及本地 `manifest.json`（构建输出至 `dist-web/media/`），须严格遵守 `NOTICE.md` 版权边界与 `< 10 MB` 静态媒体预算。
- **设计红线**（改动前必读）：
  1. **凭据永不外泄**：token/UID/roleId/昵称/抽卡记录/访问密钥不进仓库、日志、测试夹具、终端输出。统一用 `redact()` 的 `<LEN, SHA256_PREFIX>`；CLI 与 Server 默认脱敏（CLI 仅 `--show-ids` / `link --show`、API `/api/link` 仅 `reveal: true` 才输出明文）；桌面端 `#k=` 仅驻留内存并在诊断中经 `scrub_secrets` 脱敏。
  2. **缓存只读 + 全共享**：缓存文件只读打开；Windows 上游戏运行时 `PlatformProcess.exe` 持有 DELETE 句柄，必须带 `FILE_SHARE_READ|WRITE|DELETE` 打开。Node 的 `fs.openSync`（libuv）固定如此，`tests/win-lock.test.ts` 实证。**禁止**换成会丢失该语义的实现。
  3. **不因 `index.crash==1` 退出**；完整性依赖 magic + SuperFastHash（key 哈希 + EntryStore 自哈希，二者都过才算 `verified`）。
  4. **不读 `Session Storage\000003.log`**（非抽卡页面写入，关窗即 DEL）。
  5. **`server_id`**：国服（官服+B 服）请求 `ef-webview.hypergryph.com` 时恒为 `"1"`，`EfClient` 内强制；仅国际服（`ef-webview.gryphline.com`）取 `"2"/"3"`。
  6. **账号键必含渠道+角色维度**：`{region}_{channelMasterId}_{bindingUid}_{roleId}`。路线 B 换票必须用外层 `bindingList[].uid`，绝不用 `roles[].roleId`（会 `109`）。
  7. **feed 原子入库**：一条 feed 只有整条拉完才入库；否则增量游标会留下永久缺口（见 `sync.ts`）。
  8. **统计口径**：`kind != "draw"`（如 `gift_*` 寻访情报书）入库但不计入保底/抽数；稀有度为 1-based，6 星 = `rarity 6`。
  9. **本地服务与桌面壳安全边界**：`beg serve` 严格仅绑定 `127.0.0.1`（禁止 `0.0.0.0`），`/api/*` 校验随机密钥与 `Host`/同源 `Origin`/`Content-Type`，绝不输出 `Access-Control-Allow-*` CORS 允许头；Tauri 桌面壳启动前强制拦截 `%TEMP%` 与只读目录、检测 WebView2，并限制 `on_navigation` 仅放行 `about:blank` 与精确同端口回环页。

## 2. 仓库地图

```text
├── src/
│   ├── core/
│   │   ├── analysis/        # 保底/歪/UP/徽章/分组纯函数分析引擎；up.ts 支持 <dataDir>/up-map.override.json
│   │   ├── api/             # ef-webview 客户端 + 响应归一化
│   │   ├── auth/            # role.ts / passport.ts / dpapi.ts / vault.ts / u8-store.ts（u8-cache.json）
│   │   ├── cache/           # 路线 A：blockfile 解析、simplecache(前瞻)、目录发现、凭据提取
│   │   ├── data/            # 静态 UP 回退映射（up-map.json）与离愁轩内置映射（lcx-catalog.ts）
│   │   ├── io/              # v1 导入、离愁轩救援解析、CSV 导出、校验与 VACUUM INTO 备份
│   │   ├── storage/         # SQLite 持久化（node:sqlite：accounts/records/pools/rerun_counts/account_prefs/meta）
│   │   ├── sync/            # 全卡池拉取与增量入库
│   │   ├── qr.ts            # 零 Node 依赖 ISO/IEC 18004 二维码编码器（CLI 与 Web 共用）
│   │   ├── route-a.ts       # 路线 A 编排（U8Store 优先复用 + 40100 被动回源）
│   │   ├── route-b.ts       # 路线 B 编排
│   │   ├── mask.ts          # 账号键/昵称脱敏（CLI 与 Server 共用）
│   │   ├── redact.ts        # 凭据脱敏与 URL scrub 工具
│   │   └── types.ts
│   ├── version.ts           # 单一版本号真源（与 package.json 同步）
│   ├── cli/                 # 命令注册表（index.ts / context.ts / types.ts / util.ts / commands/*）
│   ├── server/              # 本地 127.0.0.1 HTTP API + 静态托管 + web-dir 解析 + 任务管理 + 窗口启动
│   └── web/                 # Preact + Vite 前端（public/media/manifest.json、lib/media.ts、AvatarPickerDialog 等）
├── src-tauri/               # Tauri v2 Windows 桌面轻壳（guards/webview2/sidecar/lib/main + NSIS 配置与图标）
├── scripts/
│   ├── pack.ps1             # Windows CLI 免安装便携 zip 构建、Node SHA256 校验与真机解压冒烟
│   └── pack-tauri.ps1       # Tauri NSIS 安装包 + Desktop Portable zip 构建、Node 签名校验与 .sha256
├── .github/workflows/
│   └── ci.yml               # Windows + Ubuntu CI 矩阵（typecheck / test / build / 产物校验）
├── tests/                   # vitest（含 qr/route-a-persist/serve-host/up-override/web-media/tauri-shell 等）
└── docs/                    # DEVELOPER.md（本文）+ dev_changelog/（v0.1.md / unreleased.md）；其余被 gitignore
```

## 3. 架构分层与核心数据流

```text
Tauri v2 桌面壳 (src-tauri: guards → webview2 → sidecar spawn --parent-pid --watch-stdin)
                                                │ [#k= 仅内存传递]
CLI (src/cli) ──────────────────────────────────┼──► route-a / route-b / core/analysis / core/io
Web UI (src/web) ──[X-BEG-Key]──► Server (src/server, 127.0.0.1) ──┘
                                                │
       ┌────────────────────────────────────────┴────────────────────────────────────────┐
       ▼                                                                                 ▼
  路线 A: U8Store(u8-cache.json) → [40100 回源] cache/(locations→blockfile→extract)   路线 B: passport.ts + dpapi/vault
       └────────────────────────────────────────┬────────────────────────────────────────┘
                                                ▼
                                     sync/sync.ts → api/ef-client.ts → ef-webview.*
                                                ▼
                                     storage/store.ts (accounts / records / pools / rerun_counts / account_prefs)
```

- **路线 A**：优先 `U8Store.pick` 复用 `u8-cache.json` 中已验证 `u8_token` → `queryRoleList` → `syncAccount` → `u8Store.touch`；仅在 `40100`（或非 `101` `RoleQueryError`）时清除旧条目并回源 `discoverCacheLocations` → `BlockfileCache.entries()` → `collectCredentials` → `pickBestCredential` → `u8Store.save`。
- **路线 B**：`qrCreate/qrPollStatus/qrExchange` 或 `parseHyTokenInput` → `grantOAuth` → `listBindings` →（按外层 `binding.uid`）`u8TokenByUid` → `queryRoleList`（失败时回退 `binding.roles[0]`）→ `syncAccount`。

## 4. 模块职责与改动坑位

| 模块 | 职责 | 关键入口 | 改动时的坑 / 不变量 |
|---|---|---|---|
| `core/qr.ts` | 零依赖二维码编码 | `encodeQr`, `renderQrTerminal` | ISO/IEC 18004 Byte 模式（UTF-8，EC `L`/`M`，Version 1..20）；**严禁引入 Node 依赖**；已纳入 `tsconfig.web.json` `include`，供 CLI 半高块终端码与 Web SVG 共用 |
| `cache/blockfile.ts` | Chromium blockfile 只读解析 | `BlockfileCache`, `superFastHash`, `extractUrlFromKey` | 块文件用定位读取不整体载入；key 可能带 `1/0/_dk_… <url>` 前缀，URL 取最后 http 片段；异常条目仅跳过 |
| `cache/simplecache.ts` | CEF SimpleCache 前瞻解析 | `readSimpleCacheEntries` | ⚠️ 仅合成夹具验证，未对真实 CEF 缓存实测；时间用文件 birth/mtime 近似 |
| `cache/locations.ts` | 缓存目录发现 | `discoverCacheLocations`, `cefCacheDirName` | CEF 目录名 = `md5(appCode+channel+subChannel)`；对 CEF 根深度 ≤3 探测 |
| `cache/extract.ts` | URL → 凭据 | `parseCredentialUrl`, `collectCredentials`, `buildGachaLink` | page 取 `u8_token`、api 取 `token`；**不用 `searchParams` 解 token**（`+` 会变空格），手动切分 + `decodeURIComponent` |
| `api/ef-client.ts` | 官方 webview API | `EfClient` | 带业务 `code` 的错误不重试；错误消息经 `scrubUrl` 抹掉 token |
| `api/normalize.ts` | 响应归一化 | `normalizeCharRecord/WeaponRecord/PoolContent` | `kind` 缺失视为 `draw`；`seqId` 一律字符串 + `compareSeqId` |
| `sync/sync.ts` | 全池拉取 | `syncAccount` | 角色池 = meta ∪ 5 枚举（meta 缺失池失败记 skipped）；武器重构池单池失败回退 `pool_ids` 合并；遇到 `40100` 直接透传供路线 A 回源 |
| `storage/store.ts` | SQLite 存储 | `GachaStore` | 主键 `(account_key, feed, seq_id)`；永不删记录；新增 `account_prefs` 表与 `getAccountAvatar`/`getAccountAvatars`/`setAccountAvatar`（空串删行，兼容旧库）；`close()` 先执行 `PRAGMA wal_checkpoint(TRUNCATE);` 再关闭句柄 |
| `analysis/*`、`data/up-map.json` | 抽卡分析与 UP 解析 | `analyzeAccount`, `makeUpResolver`, `loadUpMapOverride`, `RULES` | ⚠️ 保底/共享规则参考 `bhaoo/endfield-gacha`（MIT）；`up.ts` 解析优先级：`_` 前缀未知 < DB `pools`（`up6Ids` 非空）> `<dataDir>/up-map.override.json` / `opts.override` > 内置 `up-map.json`；`server/index.ts` 与 `cli/commands/{serve,stats}.ts` 均透传 `dataDir`；输出含 `prevPoolDiff`、`freeBatches`、`subHits5`/`pendingSubHits5`、`weaponTenRolls` 与 `global` |
| `auth/role.ts` | u8 token 反查角色 | `queryRoleList`, `RoleQueryError` | 返回 `uid` 与路线 B `bindingList[].uid` 同值（2026-11-26 实证）；国服（含 B 服）`serverId` 恒传 `"1"`；`RoleQueryError.isNoRole` 区分 `status: 101` |
| `auth/u8-store.ts`、`route-a.ts` | 路线 A 凭据持久化与回源 | `U8Store`, `u8EntryId`, `syncFromCache`, `CredentialExpiredError` | `u8-cache.json` 按 `${region}:${channel ?? ""}` 分键并以 DPAPI 加密（非 Windows 无自定义 `SecretCrypto` 或 `:memory:` 优雅禁用）；**不做客户端 TTL 猜测**，仅在 `40100` 或非 `101` `RoleQueryError` 时清除旧条目并回源重扫（排除失效 token），无新凭据抛 `CredentialExpiredError` |
| `auth/passport.ts` | 通行证接口与扫码登录 | `grantOAuth`, `listBindings`, `u8TokenByUid`, `qrCreate`, `qrPollStatus`, `formatBindingsLabel` | `status === 0` 为成功；`call()` 在 `!res.ok` 经 `readHttpErrorMessage` 保留 JSON `msg`/`message`；`qrPollStatus` 区分 `pending`/`confirmed`/网络或 HTTP 错误（保留 `qrPoll` 兼容）；`formatBindingsLabel` 生成脱敏渠道摘要（如 `bilibili服 · 1角色`）；2026-11-26 真机实证 |
| `auth/dpapi.ts`、`auth/vault.ts` | 通行证加密保险库 | `dpapi`, `Vault` | Windows 优先 `pwsh`、`ENOENT` 回退 `powershell` 5.1，stdin base64 传参；`Vault.save` 持久化 `label` 语义标签，`list()` 不返 `cipher` |
| `route-b.ts` | 路线 B 编排 | `inspectPassport`, `syncFromPassport` | 换票必须传外层 `binding.uid`（非 `roleId`）；按需重 grant；单绑定失败不中断其它；`roles.length === 0`（及无回退 `status=101`）记 warning 跳过 |
| `io/*`、`data/lcx-catalog.ts` | 导入 / 导出 / 离愁轩 / 备份 | `validateRecord`, `parseV1`, `parseLcx`, `planImport`, `applyImport`, `toCsv`, `LCX_BUILTIN_POOLS` | 官方优先不覆盖；`lcx` 卡池优先级 `--pool-map` > 本地库 > `LCX_BUILTIN_POOLS`，物品 ID 本地库 > `LCX_BUILTIN_ITEMS` > `lcx:<name>`；`allowTruncatedMs` 将截断 `000` 毫秒同秒同物归入 `duplicates`；`backupTo` 使用 `VACUUM INTO` |
| `server/*`、`web-dir.ts`、`cli/commands/{serve,login,sync}.ts` | 本地 API + 静态托管 + CLI 宿主 | `createApp`, `resolveWebDir`, `waitForStopSignal`, `serve`, `login` | 仅监听 `127.0.0.1`；`routes/passport.ts` 新增 `POST /api/passport/qr`（仅国服、`QR_SESSION_TTL_MS = 5m`、`QR_MAX_SESSIONS = 32`）与 `GET /api/passport/qr/:scanId`（`confirmPromise` 防并发重复换票，连续错误 `>= 3` 置 `error`），vault 返回 `label`；`routes/accounts.ts` 返回 `avatar` 并提供 `PUT /api/accounts/:key/avatar`（`AVATAR_BODY_LIMIT = 128 KB` 以容纳 64 KB DataURL，仅放行空串、`media/(avatars\|chars)/*.webp`（禁 `..`）与 `<= 64 KB` 光栅 DataURL，拒 SVG/HTTP 返 `400 bad_avatar`）；`login --qr` / `sync --passport --qr` 输出终端 QR；`serve` 支持 `--parent-pid` 与显式 `--watch-stdin`（避免 `stdio: "ignore"` 误退）并在 `finally` 顺序 `app.close()` + `store.close()` |
| `web/*`、`tsconfig.web.json` | Preact + Vite 前端与媒体/头像 | `App`, `Header`, `Avatar`, `PoolSection`, `SyncDialog`, `AvatarPickerDialog`, `media.ts` | `SyncDialog.tsx` 用 `encodeQr` 本地渲染 Inline SVG QR，确认后自动触发同步，显示 vault `label` 与 `40100` 一键切扫码按钮；`src/web/public/media/manifest.json` + `src/web/lib/media.ts` 静默加载并先验存在性（防 404），`iconFor` 优先 `itemAlias`、默认互换 `wpn_funnel_0008` ↔ `wpn_funnel_0010`（显式 alias 不二次反转）、双向回退 `wpn_sword_0021` ↔ `wpn_sword_0021_ink`、`chars→weapons→boxes`，`PoolSection.tsx` 对无横幅池保持渐变回退；`AvatarPickerDialog.tsx` 支持预设/干员/Canvas 居中裁剪（`<= 64 KB` WebP/JPEG/PNG，拒 SVG），经 `PUT` + `localStorage` 按 `accountKey` 持久化，且在 `Header.tsx` `privacy === true` 时隐藏自定义头像并显示「终」 |
| `src-tauri/*` | Tauri v2 Windows 桌面轻壳 | `lib.rs`, `guards.rs`, `webview2.rs`, `sidecar.rs` | 单实例插件聚焦主窗（`496×900`，初始 `about:blank`）；`guards.rs` 拦截 `%TEMP%`/`%TMP%`/`AppData\Local\Temp`（仅 `BEG_ALLOW_TEMP=1` 放行）并以 `create_new` 探针实测写删权限；`webview2.rs` 查注册表 `{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` `pv` 或 `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` 并弹窗引导；`sidecar.rs` 以 `CREATE_NO_WINDOW` 启动 `node serve --port 0 --no-open --parent-pid --watch-stdin --data-dir`，内存解析 `#k=`（15s 超时，诊断经 `scrub_secrets` 脱敏），`on_navigation` 仅放行 `about:blank` 与精确同端口 `127.0.0.1`/`localhost` 且 `on_new_window` 拒绝弹窗外开，退出先 `drop(stdin)` 等 1500ms 再 `kill()` |
| `version.ts`、`scripts/pack*.ps1` | 版本真源与便携/桌面打包 | `VERSION`, `pack.ps1`, `pack-tauri.ps1` | `src/version.ts` 与 `package.json` 同步；`BEG_RELEASE=1` 拦截 `-dev`；`pack.ps1` 产出 CLI 便携 zip；`pack-tauri.ps1` 校验 `node.exe` SHA256 + Authenticode `Valid`（`-AllowUnsignedNode` 仅非发布调试），暂存资源至 `src-tauri/resources/`（`finally` 自动清理，支持 `-PrepareOnly`/`-KeepStaged`），产出 NSIS 安装包与 Desktop Portable zip + `.sha256`，临时目录全落 `release/` |

## 5. 数据布局与安全边界

- **数据目录**：`--data-dir` / `BEG_DATA_DIR` / `./data`（便携版 `beg.cmd` 与 Tauri 桌面便携模式默认同级 `data\`，`.gitignore` 已忽略，**默认不落系统盘用户目录**）。内含 `gacha.sqlite`（WAL）、可选 `vault.json`、可选 `u8-cache.json`、可选 `up-map.override.json` 与 `backups/`。
- **数据库表**：`accounts`、`records`、`pools`、`rerun_counts`、`account_prefs`、`meta(schema_version)`。
- **`vault.json` 与 `u8-cache.json` 威胁模型**：`hytoken` 与路线 A 复用的 `u8_token` 均经 Windows DPAPI（`CurrentUser`）加密存储，仅防离线泄露或其他 Windows 账户读取；**同一登录用户下的任意进程均可解密**。因此禁用 CLI 明文传参（仅 `--token-stdin` / `--qr` / `BEG_HYTOKEN`），提供 `beg logout` 删除 `vault.json`，并提示到 `user.hypergryph.com` 手动踢出设备会话。
- **本地 HTTP 服务与桌面壳安全模型**：
  1. `beg serve` 仅绑定 `127.0.0.1`（不绑 `0.0.0.0`），`headersTimeout = 10_000`、`requestTimeout = 120_000`；
  2. 每次启动生成 24B `base64url` 随机密钥，经 URL fragment（`/#k=<key>`）交前端（Tauri 桌面壳仅在内存解析并导航，绝不写盘），`/api/*` 使用等长保护 `crypto.timingSafeEqual` 校验 `X-BEG-Key`；
  3. 严格校验 `Host`（`127.0.0.1:<port>` / `localhost:<port>`）、同源 `Origin`（拦截 `null` Origin）与变更请求 `Content-Type: application/json`，绝不返回 `Access-Control-Allow-*`；
  4. 响应统一附带 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`，静态资源加严格 `Content-Security-Policy`；
  5. `serveStatic` 以 `path.resolve` + `fs.realpathSync` 双重校验防止路径/符号链接穿越；Tauri `on_navigation` 白名单拦截任何非同端口回环页外跳；错误不泄露 `stack` 或 `#k=`/`token=`。
- **分发包布局**：
  - CLI 便携 zip（`better-endfield-gacha-<ver>-win-x64.zip`）：`beg.cmd` + `node/node.exe` + `app/{package.json, dist/, dist-web/}` + 声明文档。
  - 桌面 NSIS 安装包（`better-endfield-gacha-<ver>-win-x64-setup.exe`）与桌面便携 zip（`better-endfield-gacha-<ver>-win-x64-desktop.zip`）：`better-endfield-gacha.exe` + `resources/{node/node.exe, dist/, dist-web/}` + 声明文档（均附 `.sha256`，运行期生成同级 `data/`）。
- **已实证 vs 未实证**：
  - ✅ 已实证（2026-11-25/26/27）：本机 B 服 QtWebEngine 缓存 42/42 条目校验、Windows `SharedReadFile` 锁、`pwsh`/`powershell 5.1` 真实 DPAPI 往返、`query_role_list.uid === bindingList[].uid`（同 `accountKey` 共用）、扫码三接口真实全链路（`scanUrl` 为自定义 `hypergryph://scan_login?scanId=<32>`，支持前端 SVG 与终端半高块 QR）、`rerun` 池与下线池 `/api/content` `40402`、离愁轩 1645 条真实导出兼容与 `allowTruncatedMs` / `lcx-catalog.ts` 收口、空绑定 `status=101` 跳过、CLI 便携 zip 解压冒烟，以及 Windows 11 本机 Tauri 桌面便携包（`better-endfield-gacha.exe`）启动、`\\?\` 长路径前缀剥离、WebView2 连通与 `WM_CLOSE` WAL 截断优雅退出冒烟。
  - ❓ 未实测 / 待覆盖：① 真实 CEF（`QCefView`）缓存目录（国服当前仍未启用）；② **单绑定多角色**时 `u8_token_by_uid` 落到哪个角色；③ 武器 `rerun` 池非空分页；④ 干净 Windows 实体机（无 Node / pwsh 7 / WebView2 预装）端到端测试与 NSIS 安装器实装卸载流程。

## 6. 开发约定与测试运行

```pwsh
pnpm install
pnpm typecheck        # tsc -p tsconfig.json && tsc -p tsconfig.web.json
pnpm test             # vitest run（含 Windows 共享锁、DPAPI、QR、Route A 持久化、serve 宿主、媒体与构建预算、Tauri 结构等）
pnpm build            # tsc -p tsconfig.build.json && vite build --config vite.config.ts
pnpm pack             # pwsh -NoProfile -File scripts/pack.ps1 → release/better-endfield-gacha-<ver>-win-x64.zip
pnpm pack:tauri       # pwsh -NoProfile -File scripts/pack-tauri.ps1 → NSIS setup.exe + desktop.zip（支持 -PrepareOnly）
pnpm cli <命令>       # 开发期跑 CLI（若 pnpm tsx 报 ignored-builds，改用 .\node_modules\.bin\tsx.CMD）
pnpm web:dev          # 启动 Vite 前端开发服务（需先启动 beg serve）
```

- **Rust 桌面壳测试**：在 `src-tauri/` 下执行 `cargo check --all-targets && cargo test`（覆盖 `%TEMP%`/只读目录守卫、`#k=` 内存解析与脱敏、`on_navigation` 白名单、WebView2 注册表版本校验）。
- **构建预算与零外链**：`tests/web-build.test.ts` 拆分校验构建体积——除 `media/` 外的代码与字体 `< 200 KB`，`media/` 静态媒体资源 `< 10 MB`，且 HTML/CSS/JSON 零外链 HTTP URL（`manifest.json` 同步产出至 `dist-web/media/manifest.json`）。
- **版本守卫**：开发与候选阶段使用 `-dev` / `-rc.1` 预发布后缀（当前 `0.1.0-rc.1`）；设 `BEG_RELEASE=1` 时 `tests/version-guard.test.ts` 会拦截预发布后缀并校验 `package.json`、`src/version.ts`、`README.md` 徽章与 `CHANGELOG.md` 顶部条目严格一致。
- **测试隔离**：测试一律使用 `:memory:` 或 `os.tmpdir()` 与合成夹具（`tests/helpers/`、`tests/fixtures/`），**禁止**读写真实 `%LOCALAPPDATA%` 或真实 token；打包缓存与冒烟临时目录一律放在仓库同盘 `release/` 下，禁止写 `C:\` 或系统 `$env:TEMP`。
- **许可证与版权边界**：MIT 致谢登记在 `NOTICE.md`，运行期依赖清单由 `pnpm licenses list --prod --json` 生成至 `THIRD_PARTY.md`；`mon3tr-dev/endprotocol` 为 **AGPL-3.0，仅参考公开协议描述，严禁拷贝代码**；`NOTICE.md` 明确声明 **MIT 仅适用项目源码，置于 `src/web/public/media/` 与 `dist-web/media/` 的游戏衍生美术资产版权归鹰角网络所有、不适用 MIT 许可**。
- **文档规范**：架构/接口变更须同批次原地更新本文档（保持 ≤ 800 行、7 节现态）；技术流水按次版本号归档在 `docs/dev_changelog/`（非溯源不读，每次 commit 须按 `GitHub用户名,YYYY-MM-DD,Agent[,模型]` 口径在 `docs/dev_changelog/unreleased.md` 追加记录）；`README.md` / `QUICKSTART.md` / `CHANGELOG.md` 禁止泄露内部代码细节。

## 7. 常见任务食谱（How-to）

### 新增一种缓存后端
1. 在 `src/core/cache/` 新增解析器，输出 `CacheUrlEntry[]`（`verified` 必须有真实校验依据）。
2. 在 `locations.ts` 的 `classify` 里加探测；在 `extract.ts` 的 `scanLocations` 里分发。
3. 用合成夹具补测试（`tests/extract.test.ts`）。

### 新增一个 API 接口或 CLI 命令
- **ef-webview 接口**：`ef-client.ts` 加方法（遵守 `server_id` 与 `scrubUrl`）→ `normalize.ts` 归一化 → `sync.ts` 编排 → `tests/helpers/fake-ef-server.ts` 补假端点。
- **CLI 命令**：在 `src/cli/commands/` 新增命令文件，按需在 `src/cli/context.ts` 的 `OPTIONS` 末尾追加选项，并在 `src/cli/commands/index.ts` 末尾追加注册。

### 正式发版流程
1. 完成真机验证并回写本文档 §5「已实证 vs 未实证」。
2. 原子更新 `package.json`、`src/version.ts`、`src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json`、`README.md` 版本徽章与 `CHANGELOG.md` 正式版本条目，并将 `docs/dev_changelog/unreleased.md` 归档至对应版本文件。
3. 运行 `BEG_RELEASE=1` 下的 `pnpm typecheck && pnpm test && pnpm build`、`cargo test` 与 `pnpm pack` / `pnpm pack:tauri`，在干净无 Node/pwsh 7 的 Windows 环境中冒烟通过后再打 Tag。
