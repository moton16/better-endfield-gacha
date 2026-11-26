# Better Endfield Gacha 开发者指南

> **阅读路由**：开发或修改本仓库，**通读本文档即可**（始终维护当前 HEAD 现态，禁止顶部叠补丁）。
> `docs/` 受 `.gitignore` 的 `docs/*` 保护，本地计划/审查/草稿请放 `docs/_local/`；历史技术流水在 `docs/dev_changelog/`（非溯源不读）。

---

## 1. 概况与设计红线

- **定位**：《明日方舟：终末地》抽卡凭据提取 + 记录拉取/本地持久化/保底分析/本地 Web UI/便携分发工具。双模：
  - **路线 A（Windows PC 客户端）**：只读解析本机 Chromium 磁盘缓存取 `u8_token`，零绑定、游戏运行期可热读。
  - **路线 B（鹰角通行证）**：`hytoken → grant → binding_list → u8_token_by_uid`，跨平台、不开游戏即可同步全部可用绑定（扫码登录三接口已于 2026-11-26 真机实证，见 §5）。
- **非目标**：不做内存注入（AntiCheatExpert 风险）、不做抓包/中间人、不绑定 B 站账号直登（无公开可行路径）；测试阶段暂未装入图标包（预留本地静态资源槽位），待上线收口时统一内置。
- **设计红线**（改动前必读）：
  1. **凭据永不外泄**：token/UID/roleId/昵称/抽卡记录不进仓库、日志、测试夹具、终端输出。统一用 `redact()` 的 `<LEN, SHA256_PREFIX>`；CLI 与 Server 默认脱敏（CLI 仅 `--show-ids` / `link --show`、API `/api/link` 仅 `reveal: true` 才输出明文）。
  2. **缓存只读 + 全共享**：缓存文件只读打开；Windows 上游戏运行时 `PlatformProcess.exe` 持有 DELETE 句柄，必须带 `FILE_SHARE_READ|WRITE|DELETE` 打开。Node 的 `fs.openSync`（libuv）固定如此，`tests/win-lock.test.ts` 实证。**禁止**换成会丢失该语义的实现。
  3. **不因 `index.crash==1` 退出**；完整性依赖 magic + SuperFastHash（key 哈希 + EntryStore 自哈希，二者都过才算 `verified`）。
  4. **不读 `Session Storage\000003.log`**（非抽卡页面写入，关窗即 DEL）。
  5. **`server_id`**：国服（官服+B 服）请求 `ef-webview.hypergryph.com` 时恒为 `"1"`，`EfClient` 内强制；仅国际服（`ef-webview.gryphline.com`）取 `"2"/"3"`。
  6. **账号键必含渠道+角色维度**：`{region}_{channelMasterId}_{bindingUid}_{roleId}`。路线 B 换票必须用外层 `bindingList[].uid`，绝不用 `roles[].roleId`（会 `109`）。
  7. **feed 原子入库**：一条 feed 只有整条拉完才入库；否则增量游标会留下永久缺口（见 `sync.ts`）。
  8. **统计口径**：`kind != "draw"`（如 `gift_*` 寻访情报书）入库但不计入保底/抽数；稀有度为 1-based，6 星 = `rarity 6`。
  9. **本地服务安全边界**：`beg serve` 严格仅绑定 `127.0.0.1`（禁止 `0.0.0.0`），`/api/*` 校验随机密钥与 `Host`/同源 `Origin`/`Content-Type`，绝不输出 `Access-Control-Allow-*` CORS 允许头。

## 2. 仓库地图

```text
├── src/
│   ├── core/
│   │   ├── analysis/        # 保底/歪/UP/徽章/分组纯函数分析引擎（部分文件零 Node 依赖供前端复用）
│   │   ├── api/             # ef-webview 客户端 + 响应归一化
│   │   ├── auth/            # 路线 A 反查（role.ts）；路线 B 通行证/DPAPI/保险库（passport/dpapi/vault）
│   │   ├── cache/           # 路线 A：blockfile 解析、simplecache(前瞻)、目录发现、凭据提取
│   │   ├── data/            # 静态 UP 回退映射（up-map.json）
│   │   ├── io/              # v1 导入、离愁轩救援解析、CSV 导出、校验与 VACUUM INTO 备份
│   │   ├── storage/         # SQLite 持久化（node:sqlite）
│   │   ├── sync/            # 全卡池拉取与增量入库
│   │   ├── route-a.ts       # 路线 A 编排
│   │   ├── route-b.ts       # 路线 B 编排
│   │   ├── mask.ts          # 账号键/昵称脱敏（CLI 与 Server 共用）
│   │   ├── redact.ts        # 凭据脱敏与 URL scrub 工具
│   │   └── types.ts
│   ├── version.ts           # 单一版本号真源（与 package.json 同步）
│   ├── cli/                 # 命令注册表（index.ts / context.ts / types.ts / util.ts / commands/*）
│   ├── server/              # 本地 127.0.0.1 HTTP API + 静态托管 + web-dir 解析 + 任务管理 + 窗口启动
│   └── web/                 # Preact + Vite 前端（小黑盒风格、?mock=1 合成预览）
├── scripts/
│   └── pack.ps1             # Windows 免安装便携 zip 构建、Node v24 SHA256 校验与真机解压冒烟
├── .github/workflows/
│   └── ci.yml               # Windows + Ubuntu CI 矩阵（typecheck / test / build / 产物校验）
├── tests/                   # vitest；helpers/ 含合成夹具构造器与假服务端；fixtures/ 含合成夹具
└── docs/                    # DEVELOPER.md（本文）+ dev_changelog/（v0.1.md / unreleased.md）；其余被 gitignore
```

## 3. 架构分层与核心数据流

```text
CLI (src/cli) ──────────────────────────────────┐
                                                ├──► route-a / route-b / core/analysis / core/io
Web UI (src/web) ──[X-BEG-Key]──► Server (src/server, 127.0.0.1) ──┘
                                                │
       ┌────────────────────────────────────────┴────────────────────────────────────────┐
       ▼                                                                                 ▼
  路线 A: cache/(locations → blockfile|simplecache → extract) → role.ts            路线 B: passport.ts + dpapi/vault
       └────────────────────────────────────────┬────────────────────────────────────────┘
                                                ▼
                                     sync/sync.ts → api/ef-client.ts → ef-webview.*
                                                ▼
                                     storage/store.ts (accounts / records / pools / rerun_counts)
```

- **路线 A**：`discoverCacheLocations` → `BlockfileCache.entries()` → `collectCredentials`（按 token 聚合，`max(creation, last_used)` 排序）→ `pickBestCredential` → `queryRoleList` → `syncAccount`。
- **路线 B**：`parseHyTokenInput` → `grantOAuth` → `listBindings` →（按外层 `binding.uid`）`u8TokenByUid` → `queryRoleList`（失败时回退 `binding.roles[0]`）→ `syncAccount`。

## 4. 模块职责与改动坑位

| 模块 | 职责 | 关键入口 | 改动时的坑 / 不变量 |
|---|---|---|---|
| `cache/blockfile.ts` | Chromium blockfile 只读解析 | `BlockfileCache`, `superFastHash`, `extractUrlFromKey` | 块文件用定位读取不整体载入；key 可能带 `1/0/_dk_… <url>` 前缀，URL 取最后 http 片段；异常条目仅跳过 |
| `cache/simplecache.ts` | CEF SimpleCache 前瞻解析 | `readSimpleCacheEntries` | ⚠️ 仅合成夹具验证，未对真实 CEF 缓存实测；时间用文件 birth/mtime 近似 |
| `cache/locations.ts` | 缓存目录发现 | `discoverCacheLocations`, `cefCacheDirName` | CEF 目录名 = `md5(appCode+channel+subChannel)`；对 CEF 根深度 ≤3 探测 |
| `cache/extract.ts` | URL → 凭据 | `parseCredentialUrl`, `collectCredentials`, `buildGachaLink` | page 取 `u8_token`、api 取 `token`；**不用 `searchParams` 解 token**（`+` 会变空格），手动切分 + `decodeURIComponent` |
| `api/ef-client.ts` | 官方 webview API | `EfClient` | 带业务 `code` 的错误不重试；错误消息经 `scrubUrl` 抹掉 token |
| `api/normalize.ts` | 响应归一化 | `normalizeCharRecord/WeaponRecord/PoolContent` | `kind` 缺失视为 `draw`；`seqId` 一律字符串 + `compareSeqId` |
| `sync/sync.ts` | 全池拉取 | `syncAccount` | 角色池 = meta ∪ 5 枚举（meta 缺失池失败记 skipped）；武器重构池单池失败回退 `pool_ids` 合并 |
| `storage/store.ts` | SQLite 存储 | `GachaStore` | 主键 `(account_key, feed, seq_id)`；永不删记录；区块标记 `// ==== Wx BEGIN/END` |
| `analysis/*`、`data/up-map.json` | 抽卡分析与静态 UP 回退 | `analyzeAccount`, `makeUpResolver`, `RULES`, `DISPLAY` | ⚠️ 保底/共享规则参考 `bhaoo/endfield-gacha`（MIT），非官方；暂缺 `poolVersion`；`config/types/common` 保持零 Node 依赖；输出含同周期 5★ `subHits5`/`pendingSubHits5`、武器十连聚合 `weaponTenRolls` 与全账号汇总 `global`；`up.ts` 依赖 `resolveJsonModule` |
| `auth/role.ts` | u8 token 反查角色 | `queryRoleList` | 返回的 `uid` 与路线 B `bindingList[].uid` 同值（2026-11-26 实证）；国服（含 B 服）`serverId` 恒传 `"1"`；`status: 101`＝该渠道无角色，需与真正的接口异常区分 |
| `auth/passport.ts` | 通行证接口与扫码登录 | `grantOAuth`, `listBindings`, `u8TokenByUid`, `parseHyTokenInput` | 业务状态字段严格为 `status === 0`（非 `code`）；扫码三接口已实证（`scanUrl` 为 `hypergryph://` 自定义 scheme，`scanCode` 为 120 字符 base64，无需 `dId`）；`call()` 在 `!res.ok` 时直接抛 `HTTP <code>` 会丢掉服务端 `msg`；错误消息 `scrubUrl` |
| `auth/dpapi.ts`、`auth/vault.ts` | 通行证加密保险库 | `dpapi`, `Vault` | Windows 下优先 `pwsh`、`ENOENT` 回退 `powershell`（5.1，脚本显式 `Add-Type -AssemblyName System.Security`），stdin base64 传参；`list()` 不返回 `cipher`；损坏或版本不匹配视为空 |
| `route-b.ts` | 路线 B 编排 | `inspectPassport`, `syncFromPassport` | 换票必须传外层 `binding.uid`（非 `roleId`）；每次换票按需重 grant；单绑定失败不中断其它绑定；⚠️ `roles.length === 0` 的空绑定（如只玩 B 服的通行证挂了官服）反查必返 `101` 且回退取不到角色，应按 warning 跳过而非记为失败 |
| `io/*` | 导入 / 导出 / 离愁轩 / CSV / 备份 | `validateRecord`, `parseV1`, `parseLcx`, `planImport`, `applyImport`, `toCsv` | 官方优先不覆盖；`kind==="draw"` 强约束 `rarity 1..6` 与非空 `itemId`，非 draw 允许 `rarity=0` 与空 `itemId`；`lcx` 保守映射与 `lcx:unknown4` 占位；`backupTo` 使用 `VACUUM INTO` 同秒自动加后缀 |
| `server/*`、`web-dir.ts`、`core/mask.ts`、`cli/commands/serve.ts` | 本地 HTTP API + 静态托管 + 任务管理 + 窗口启动 | `createApp`, `resolveWebDir`, `JobManager`, `serveStatic`, `openWindow`, `serve` | 仅监听 `127.0.0.1`；`/api/*` 校验 `X-BEG-Key`/`Host`/同源 `Origin`/`Content-Type`，无 CORS；body 上限 64 KB（`/api/import` 60 MB）；`resolveWebDir()` 兼容 `BEG_WEB_DIR`/源码 `src/`/`dist/`/便携包 `app/dist/`+`app/dist-web/`/`web/`；`JobManager` 单活 `sync` 并对错误脱敏 |
| `web/*`、`vite.config.ts`、`tsconfig.web.json` | Preact + Vite 前端与 `?mock=1` | `App`, `bootstrapKey`, `api`, `SyncDialog`, `DataDialog` | 参考成熟抽卡卡片视觉模板设计语言，纯 CSS + Inline SVG 自主实现；支持全局评分/徽章汇总、`展示五星` 开关、武器十连条与 `barWidth` 70 抽视觉缩放；`iconFor`/`bannerFor` 预留本地静态槽位；仅引用零 Node 依赖的 `core/analysis/{types,common,config}`；`#k=` 提取后立即 `history.replaceState` 抹除；下载走 `fetch`+Blob；零外部 CDN/字体/图片 URL；Vite dev `/api` 代理改写 `origin` |
| `version.ts`、`cli/commands/version.ts`、`scripts/pack.ps1` | 版本真源、版本命令与便携打包 | `VERSION`, `version`, `pack.ps1` | `src/version.ts` 与 `package.json` 一致；`tests/version-guard.test.ts` 在 `BEG_RELEASE=1` 时拦截 `-dev`；`pack.ps1` 下载缓存/staging/冒烟全部落 `release/` 同盘目录 |

## 5. 数据布局与安全边界

- **数据目录**：`--data-dir` / `BEG_DATA_DIR` / `./data`（便携版 `beg.cmd` 默认设为同目录 `data\`，`.gitignore` 已忽略，**默认不落系统盘用户目录**）。内含 `gacha.sqlite`（WAL）与可选 `vault.json`。
- **数据库表**：`accounts`、`records`、`pools`、`rerun_counts`、`meta(schema_version)`。
- **`vault.json` 威胁模型**：`hytoken` 经 Windows DPAPI（`CurrentUser`）加密存储，仅防离线泄露或其他 Windows 账户读取；**同一登录用户下的任意进程均可解密**。因此禁用 CLI 明文传参（仅 `--token-stdin` / `--qr` / `BEG_HYTOKEN`），提供 `beg logout` 删除本地文件，并提示到 `user.hypergryph.com` 手动踢出设备会话。
- **本地 HTTP 服务安全模型（`beg serve`）**：
  1. 仅绑定 `127.0.0.1`（不绑 `0.0.0.0`），`headersTimeout = 10_000`、`requestTimeout = 120_000`；
  2. 每次启动生成 24B `base64url` 随机密钥，经 URL fragment（`/#k=<key>`）交前端，`/api/*` 使用等长保护 `crypto.timingSafeEqual` 校验 `X-BEG-Key`；
  3. 严格校验 `Host`（`127.0.0.1:<port>` / `localhost:<port>`）、同源 `Origin`（拦截 `null` Origin）与变更请求 `Content-Type: application/json`，绝不返回 `Access-Control-Allow-*`；
  4. 响应统一附带 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`，静态资源加严格 `Content-Security-Policy`；
  5. `serveStatic` 以 `path.resolve` + `fs.realpathSync` 双重校验防止路径/符号链接穿越；错误不泄露 `stack`。
- **便携 zip 布局**：`beg.cmd` + `node/node.exe` + `app/{package.json, dist/, dist-web/}` + `LICENSE` / `NOTICE.md` / `THIRD_PARTY.md` / `QUICKSTART.md`，运行期生成 `data/`（升级时保留 `data/` 替换其余文件即可）。
- **已实证 vs 未实证（W6 待办）**：
  - ✅ 已实证：2026-11-25 本机 B 服 QtWebEngine 缓存 42/42 条目哈希通过（`u8_token` 328 字符，23h+ 可用，`channel=2&subChannel=2`）、实机全池拉取 613 条（610 抽 + 3 条 gift）、Windows `SharedReadFile` 锁实证、Windows 真实 DPAPI（`pwsh` 与 `powershell` 5.1）往返、便携 zip 解压 `beg.cmd` 真实服务冒烟。
  - ✅ 已实证（2026-11-26，W6 V2，样本 1 个通行证 / B 服 1 绑定 1 角色 + 官服空绑定）：`query_role_list.uid` 与 `bindingList[].uid` **完全同值**（长度 9、指纹一致，`uidExactMatch=true`）；由此组出的 `accountKey` 与 `beg_smoke` 中路线 A 落库行（`source=cache`）**逐字节相等**（`matchesExistingSmokeAccountKey=true`）→ 路线 A/B 天然共用同一账号，无需合并或迁移逻辑。B 服角色反查同样要传 `serverId="1"`（响应 `roles[].serverId` 亦为 `"1"`）。⚠️ `binding.roles[].isDefault` 在单角色账号上是 `false`（不是“唯一角色自动为默认”），**不得用它判定官网默认角色**，一律以 `query_role_list` 返回为准。
  - ✅ 已实证（2026-11-26，W6 V3）：扫码三接口全链路可用，`passport.ts` 现有实现与真实协议一致。`gen_scan/login` → HTTP 200 / `status: 0` / `data:{scanId(32 字符), scanUrl, enableScanAppList[]}`；**不需要 `dId` / `Origin` / `Referer` 等设备指纹头**（加与不加响应一致）。`scan_status` 仅接受 GET：未扫码 HTTP 200 / `status: 100` / `msg: "未扫码"` 且无 `data`；确认后 `status: 0` + `data.scanCode`（**120 字符 base64**，与 `scanId` 不是同一值，正好对应 `token_by_scan_code` 服务端 `base64` 校验）。`token_by_scan_code` 用 `{scanCode}` POST 换出**24 字符 token**，可直接喂 `grantOAuth`，随后 `binding_list` 正常返回（本次 2 个绑定）。`scanUrl` 形态是**自定义 scheme** `hypergryph://scan_login?scanId=<32>`（63 字符，非 http URL），只能由森空岛 App 扫码消费 → W3 的 `/api/passport/qr` 必须由**前端本地渲染二维码**，不得依赖外部二维码服务或外链 CDN。
  - ❓ 未实测（留待 W6）：① ~~`query_role_list.uid` 与 `bindingList[].uid` 是否同值~~（已实证，见上）；② ~~扫码登录三接口真实响应~~（已实证，见上）；③ 真实 CEF（`QCefView`）缓存目录；④ **单绑定多角色**时 `u8_token_by_uid` 落到哪个角色（当前样本每个绑定仅 1 角色，未覆盖）；⑤ 武器重构池单池 `pool_id=` 与历史 `/api/content` 过期表现；⑥ 真实离愁轩导出文件样本。
  - ⚠️ 待修（V2 副产物，未提交改动）：官服绑定 `roles.length === 0` 时 `query_role_list` 返回 `status: 101 / "区服角色不存在"`，`syncFromPassport` 的回退链 `b.roles.find(...) ?? b.roles[0]` 取不到角色会 `throw`，导致“只玩 B 服但通行证挂了官服空绑定”的玩家每次同步都出现一条失败项（`beg sync --passport` 退出码 4，但 B 服记录已入库，非阻断）。建议对 0 角色绑定按 warning 跳过，并单独识别 `status === 101`。
  - ⚠️ 待修（V3 副产物，非阻断）：`beg login --qr` / `beg sync --passport --qr` 目前把 `hypergryph://scan_login?scanId=<32>` **原样打印**，终端没有二维码，用户无法直接用森空岛扫；而该 URL 又不能交给外部二维码服务（会把一次性会话外传）。需在 CLI 侧引入本地二维码渲染（零依赖库），与 W3 前端同一套结论。

## 6. 开发约定与测试运行

```pwsh
pnpm install
pnpm typecheck        # tsc -p tsconfig.json && tsc -p tsconfig.web.json
pnpm test             # vitest run（含 Windows 共享锁、DPAPI 回退与真机往返、版本守卫等）
pnpm build            # tsc -p tsconfig.build.json && vite build --config vite.config.ts
pnpm pack             # pwsh -NoProfile -File scripts/pack.ps1 → release/better-endfield-gacha-<ver>-win-x64.zip
pnpm cli <命令>       # 开发期跑 CLI（若 pnpm tsx 报 ignored-builds，改用 .\node_modules\.bin\tsx.CMD）
pnpm web:dev          # 启动 Vite 前端开发服务（需先启动 beg serve）
```

- **版本守卫**：开发期维持 `0.1.0-dev`；设 `BEG_RELEASE=1` 时 `tests/version-guard.test.ts` 会拦截预发布后缀并校验 `package.json`、`src/version.ts`、`README.md` 徽章与 `CHANGELOG.md` 顶部条目严格一致。
- **测试隔离**：测试一律使用 `:memory:` 或 `os.tmpdir()` 与合成夹具（`tests/helpers/`、`tests/fixtures/`），**禁止**读写真实 `%LOCALAPPDATA%` 或真实 token；打包缓存与冒烟临时目录一律放在仓库同盘 `release/` 下，禁止写 `C:\` 或系统 `$env:TEMP`。
- **许可证规范**：MIT 致谢登记在 `NOTICE.md`，运行期依赖清单由 `pnpm licenses list --prod --json` 生成至 `THIRD_PARTY.md`；`mon3tr-dev/endprotocol` 为 **AGPL-3.0，仅参考公开协议描述，严禁拷贝代码**。
- **文档规范**：架构/接口变更须同批次原地更新本文档（保持 ≤ 800 行、7 节现态）；技术流水按次版本号归档在 `docs/dev_changelog/`（非溯源不读）；`README.md` / `QUICKSTART.md` / `CHANGELOG.md` 禁止泄露内部代码细节。

## 7. 常见任务食谱（How-to）

### 新增一种缓存后端
1. 在 `src/core/cache/` 新增解析器，输出 `CacheUrlEntry[]`（`verified` 必须有真实校验依据）。
2. 在 `locations.ts` 的 `classify` 里加探测；在 `extract.ts` 的 `scanLocations` 里分发。
3. 用合成夹具补测试（`tests/extract.test.ts`）。

### 新增一个 API 接口或 CLI 命令
- **ef-webview 接口**：`ef-client.ts` 加方法（遵守 `server_id` 与 `scrubUrl`）→ `normalize.ts` 归一化 → `sync.ts` 编排 → `tests/helpers/fake-ef-server.ts` 补假端点。
- **CLI 命令**：在 `src/cli/commands/` 新增命令文件，按需在 `src/cli/context.ts` 的 `OPTIONS` 末尾追加选项，并在 `src/cli/commands/index.ts` 末尾追加注册。

### 正式发版流程
1. 完成 W6 真机验证并回写本文档 §5「已实证 vs 未实证」。
2. 原子更新 `package.json`、`src/version.ts`、`README.md` 版本徽章与 `CHANGELOG.md` 正式版本条目，并将 `docs/dev_changelog/unreleased.md` 归档至对应版本文件。
3. 运行 `BEG_RELEASE=1` 下的 `pnpm typecheck && pnpm test && pnpm build` 与 `pnpm pack`，在干净无 Node/pwsh 7 的 Windows 环境中冒烟通过后再打 Tag。
