# Better Endfield Gacha 开发者指南

> **阅读路由**：开发或修改本仓库，**通读本文档即可**（始终维护当前 HEAD 现态，禁止顶部叠补丁）。
> `docs/` 受 `.gitignore` 的 `docs/*` 保护，本地计划/审查/草稿请放 `docs/_local/`；历史技术流水在 `docs/dev_changelog/`（非溯源不读）。

---

## 1. 概况与设计红线

- **定位**：终末地抽卡凭据提取 + 记录拉取/本地持久化/分析。双模：
  - **路线 A**（已实现，M1）：Windows PC 客户端，只读解析本机 Chromium 缓存取 `u8_token`，零绑定。
  - **路线 B**（已实现，M2/W0）：鹰角通行证 `hytoken → grant → binding_list → u8_token_by_uid`，跨平台、不开游戏（扫码登录三接口待真机实测）。
- **非目标**：不做内存注入（AntiCheatExpert 风险）、不做抓包/中间人、不绑定 B 站账号直登（无公开可行路径）、不内置第三方 Wiki 图片（版权风险，头像后续以仓库内置资源 + 独立工作流处理）。
- **设计红线**（改动前必读）：
  1. **凭据永不外泄**：token/UID/昵称/抽卡记录不进仓库、日志、测试夹具、终端输出。统一用 `redact()` 的 `<LEN, SHA256_PREFIX>`；CLI 账号键默认脱敏（`--show-ids` 才明文）。
  2. **缓存只读 + 全共享**：缓存文件只读打开；Windows 上游戏运行时 `PlatformProcess.exe` 持有 DELETE 句柄，必须用带 `FILE_SHARE_READ|WRITE|DELETE` 的打开方式。Node 的 `fs.openSync`（libuv）固定如此，`tests/win-lock.test.ts` 实证。**禁止**换成会丢失该语义的实现（如 Python 的 `open()` 等价物）。
  3. **不因 `index.crash==1` 退出**；完整性依赖 magic + SuperFastHash（key 哈希 + EntryStore 自哈希，二者都过才算 `verified`）。
  4. **不读 `Session Storage\000003.log`**（非抽卡页面写入，关窗即 DEL）。
  5. **`server_id`**：国服（官服+B 服）请求 `ef-webview.hypergryph.com` 时恒为 `"1"`，`EfClient` 内强制；仅国际服（`ef-webview.gryphline.com`）取 `"2"/"3"`。
  6. **账号键必含渠道+角色维度**：`{region}_{channelMasterId}_{bindingUid}_{roleId}`。路线 B 换票必须用外层 `bindingList[].uid`，绝不用 `roles[].roleId`（会 `109`）。
  7. **feed 原子入库**：一条 feed 只有整条拉完才入库；否则增量游标会留下永久缺口（见 `sync.ts` 头注释与对应测试）。
  8. **统计口径**：`kind != "draw"`（如 `gift_*` 寻访情报书）入库但不计入保底/抽数；稀有度为 1-based，6 星 = `rarity 6`。

## 2. 仓库地图

```text
├── src/
│   ├── core/
│   │   ├── analysis/     # W1：保底/歪/UP/徽章/分组纯函数分析引擎
│   │   ├── cache/        # 路线 A：blockfile 解析、simplecache(前瞻)、目录发现、凭据提取
│   │   ├── api/          # ef-webview 客户端 + 响应归一化
│   │   ├── auth/         # 路线 A 反查（role.ts）；路线 B 通行证/DPAPI/保险库（passport.ts/dpapi.ts/vault.ts）
│   │   ├── data/         # 静态回退映射（up-map.json）
│   │   ├── io/           # W2：v1 导入、离愁轩救援解析、CSV 导出与一致性备份
│   │   ├── storage/      # SQLite（node:sqlite）
│   │   ├── sync/         # 全卡池拉取与增量入库
│   │   ├── route-a.ts    # 路线 A 编排
│   │   ├── route-b.ts    # 路线 B 编排
│   │   ├── mask.ts       # 账号键脱敏（CLI 与 Server 共用）
│   │   ├── redact.ts     # 脱敏工具
│   │   └── types.ts
│   ├── cli/              # 命令注册表（index.ts / context.ts / util.ts / commands/*）
│   ├── server/           # W3：本地 127.0.0.1 HTTP API + 静态托管 + 任务管理 + 窗口启动
│   └── web/              # （待建）Preact + Vite 前端，小黑盒风格
├── tests/                # vitest；helpers/ 含合成 blockfile、ef-server 与 fake-passport；fixtures/ 含合成夹具
└── docs/                 # DEVELOPER.md（本文）+ dev_changelog/；其余被 gitignore
```

## 3. 架构分层与核心数据流

```text
CLI / (未来)本地 HTTP + Web UI
        │
   route-a.ts ──► cache/(locations → blockfile|simplecache → extract) ──► CachedCredential
        │                                                                    │
        │            auth/role.ts (u8 query_role_list 反查 uid/roleId) ◄──────┘
        ▼
   sync/sync.ts ──► api/ef-client.ts ──► ef-webview.*  /api/record/*
        │
        ▼
   storage/store.ts  (accounts / records / pools / rerun_counts)
```

路线 A 链路：`discoverCacheLocations` → `BlockfileCache.entries()`（遍历哈希桶链 → EntryStore → RankingsNode.last_used）→ `collectCredentials`（按 token 聚合，`max(creation, last_used)` 排序）→ `pickBestCredential`（可按渠道过滤）→ `queryRoleList` → `syncAccount`。

## 4. 模块职责与改动坑位

| 模块 | 职责 | 关键入口 | 改动时的坑 / 不变量 |
|---|---|---|---|
| `cache/blockfile.ts` | Chromium blockfile 只读解析 | `BlockfileCache`, `superFastHash`, `extractUrlFromKey` | 块文件用定位读取，不整体载入（data_3 可达百 MB）；key 可能带 `1/0/_dk_… <url>` 前缀，URL 取最后一个 http 片段；单条解析异常只跳过该条 |
| `cache/simplecache.ts` | CEF SimpleCache 前瞻解析 | `readSimpleCacheEntries` | ⚠️ 仅合成夹具验证，未对真实 CEF 缓存实测；时间用文件 birth/mtime 近似 |
| `cache/locations.ts` | 缓存目录发现 | `discoverCacheLocations`, `cefCacheDirName` | CEF 目录名 = `md5(appCode+channel+subChannel)`，测试断言与逆向报告两个 md5 一致；对 CEF 根深度 ≤3 探测 |
| `cache/extract.ts` | URL→凭据 | `parseCredentialUrl`, `collectCredentials`, `buildGachaLink` | page 取 `u8_token`、api 取 `token`；**不用 `searchParams` 解 token**（`+` 会变空格），手动切分 + `decodeURIComponent`；API-only 的 token 渠道未知，靠同 token 页面条目补全 |
| `api/ef-client.ts` | 官方 webview API | `EfClient` | 带业务 `code` 的错误不重试；错误消息经 `scrubUrl` 去掉 token |
| `api/normalize.ts` | 响应归一化 | `normalizeCharRecord/WeaponRecord/PoolContent` | `kind` 缺失视为 `draw`；`seqId` 一律字符串 + `compareSeqId` |
| `sync/sync.ts` | 全池拉取 | `syncAccount` | 角色池 = meta ∪ 5 枚举（meta 未提供的池失败记为 skipped）；武器先 `/weapon/pool` 再逐池，重构池单池失败回退 `pool_ids` 合并 |
| `storage/store.ts` | SQLite | `GachaStore` | 主键 `(account_key, feed, seq_id)`；永不删除记录（90 天窗口之外的旧数据靠本地保留） |
| `analysis/*`、`data/up-map.json` | 抽卡分析引擎与静态 UP 回退 | `analyzeAccount`, `badges`, `makeUpResolver`, `RULES`, `DISPLAY` | ⚠️ 保底/共享规则来自社区实现（`bhaoo/endfield-gacha`，MIT），非官方且**可能随版本变化**；`GachaRecord` 暂缺 `poolVersion`（重构申领按版本重置小保底本期未实现）；十连批次（同 `gachaTs`）/徽章（`十连双金`、`九蓝一紫`）及展示阈值均为实机截图**推断**；`config.ts`/`types.ts`/`common.ts` 保持零 Node 依赖；`up.ts` 使用静态 JSON import（需 `resolveJsonModule`） |
| `auth/role.ts` | u8 token 反查角色 | `queryRoleList` | ⚠️ 返回的 `uid` 与路线 B `bindingList[].uid` 是否同值 **未实测**，若不同则 A/B 同一角色会落成两个账号键，需在 M2 做关联迁移 |
| `auth/passport.ts` | 鹰角通行证接口与扫码登录 | `grantOAuth`, `listBindings`, `u8TokenByUid`, `parseHyTokenInput` | 业务状态字段严格为 `status === 0`（不是 `code`）；扫码三接口来自社区协议描述 **未实测**；错误消息经 `scrubUrl` 抹掉 token |
| `auth/dpapi.ts`、`auth/vault.ts` | 通行证加密保险库 | `dpapi`, `Vault` | Windows 下用 `pwsh` 调 DPAPI（`CurrentUser`），明文走 stdin base64 传递；`list()` 不返回 `cipher`；损坏或版本不匹配文件视为空 |
| `route-b.ts` | 路线 B 编排 | `inspectPassport`, `syncFromPassport` | 换票必须传外层 `binding.uid`（非 `roleId`）；每次换票按需重 grant；单绑定失败只写 `item.error` 不中断其它绑定；多角色时 `u8_token` 只对应默认角色 |
| `io/*`（`validate.ts` / `v1.ts` / `lcx.ts` / `importer.ts` / `csv.ts`） | 导入 / 导出 / 离愁轩救援 / CSV / 备份 | `validateRecord`, `parseV1`, `parseLcx`, `planImport`, `applyImport`, `toCsv` | 官方优先不覆盖（冲突记入 `conflicts`）；v1 `accountKey` 按四维重算校验；非 `draw`（如 `gift_intel_book`）实证存在 `rarity=0` 且 `itemId=""`，校验仅对 `kind==="draw"` 强约束 1..6 与非空 `itemId`；`lcx` 保守映射（`--pool-map` → 本地唯一映射，歧义记 `ambiguous`、缺失记 `unresolvedPools`），含 `rarity=3 && !has6` 整体 +1 启发式与 `lcx:unknown4` 占位；`backupTo` 使用 `VACUUM INTO` 且同秒撞车自动加后缀 |
| `server/*`、`core/mask.ts`、`cli/commands/serve.ts` | 本地 HTTP API + 静态托管 + 任务管理 + 窗口拉起 | `createApp`, `JobManager`, `serveStatic`, `openWindow`, `serve` | 仅监听 `127.0.0.1`；`/api/*` 强制校验 `X-BEG-Key`（先比长度再 `timingSafeEqual`）、`Host`（`127.0.0.1:<port>`/`localhost:<port>`）、同源 `Origin` 与变更请求 `Content-Type: application/json`，且绝不返回 CORS 允许头；普通 body 上限 64 KB、`/api/import` 上限 60 MB；`JobManager` 单活 `sync` 并发回 409 并对日志/错误脱敏（不回传 `stack`）；`/api/link` 默认不回明文，仅 `reveal:true` 才回 |

## 5. 数据布局与安全边界

- 数据目录：`--data-dir` / `BEG_DATA_DIR` / `./data`（`.gitignore` 已忽略）。内含 `gacha.sqlite`（WAL）与可选 `vault.json`。**默认不放系统盘用户目录**。
- 表：`accounts`、`records`、`pools`（`/api/content` 缓存，含 UP 六星 id）、`rerun_counts`、`meta(schema_version)`。
- **`vault.json` 威胁模型**：路线 B 的 `hytoken` 使用 Windows DPAPI（`CurrentUser`）加密保存在 `<dataDir>/vault.json`。DPAPI 仅能防范离线文件泄露或同机其他 Windows 账户读取；**同一 Windows 登录用户下的任意进程都能调用 `ProtectedData.Unprotect` 解密**。因此不提供 CLI 参数明文传参（仅 `--token-stdin` / `--qr` / `BEG_HYTOKEN`），提供 `beg logout` 清除本地文件，并在 `README.md` 明示需到 `user.hypergryph.com` 手动踢出服务端会话。
- **本地 HTTP 服务安全模型（`beg serve`）**：
  1. 仅绑定 `127.0.0.1`（不绑定 `0.0.0.0` 或 `localhost`），设置 `headersTimeout = 10_000`、`requestTimeout = 120_000`；
  2. 每次启动随机生成 24B `base64url` 密钥，通过 URL fragment（`/#k=<key>`）传给前端（不发往服务端、不进 Referer），`/api/*` 用等长保护的 `crypto.timingSafeEqual` 校验 `X-BEG-Key`；
  3. 严格校验 `Host`（`127.0.0.1:<port>` / `localhost:<port>`）防范 DNS rebinding；校验 `Origin` 必须同源并拦截 `null` Origin；非 `GET`/`HEAD` 校验 `Content-Type: application/json`；绝不输出任何 `Access-Control-Allow-*` CORS 允许头；
  4. 响应统一附带 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`，非 API 静态资源加 `Content-Security-Policy`（`default-src 'self'; ... frame-ancestors 'none'`）；
  5. 静态服务以 `path.resolve` + `fs.realpathSync` 双重校验根目录边界防止路径/符号链接穿越；默认请求体上限 64 KB（`/api/import` 上限 60 MB）；错误不泄露 `stack`。
- 不可信输入：缓存文件内容（长度/地址均做边界检查，异常条目跳过）、服务端 JSON（逐字段 `str/num` 归一化）。
- 已实证事实（2026-11-25 本机 B 服）：QtWebEngine 缓存 42/42 条目哈希通过；`u8_token` 328 字符；跨会话 23h+ 仍可用；`channel=2&subChannel=2` 出现在页面 URL。

## 6. 开发约定与测试运行

```pwsh
pnpm install
pnpm typecheck        # tsc -p tsconfig.json（含 tests）
pnpm test             # vitest run（含 Windows 共享锁实证，需要 pwsh）
pnpm build            # tsc -p tsconfig.build.json → dist/
pnpm cli <命令>       # 开发期直接跑 CLI（tsx）
```

- 测试一律使用 `os.tmpdir()` 临时目录与合成夹具（`tests/helpers/`），**禁止**读写真实 `%LOCALAPPDATA%`、真实 token。
- 对真实缓存/真实服务端的冒烟只在本机手工进行，输出必须脱敏，数据目录放仓库之外。
- 借鉴第三方实现时遵守其许可证：`bhaoo`/`MoguJunn`/`Zmd-Gacha`/`Starward`/`RoLingG` 为 MIT；`mon3tr-dev/endprotocol` 为 **AGPL-3.0，只参考协议思路，禁止拷贝代码**。
- 文档约定：架构/接口变更须在同批次更新本文档；`CHANGELOG.md` 只写大白话。

## 7. 常见任务食谱（How-to）

### 新增一种缓存后端
1. 在 `src/core/cache/` 新增解析器，输出 `CacheUrlEntry[]`（`verified` 必须有真实校验依据）。
2. 在 `locations.ts` 的 `classify` 里加探测；在 `extract.ts` 的 `scanLocations` 里分发。
3. 用合成夹具补测试（`tests/extract.test.ts`）。

### 新增一个 API 接口
1. `ef-client.ts` 加方法（注意 `server_id` 规则、错误脱敏）。
2. `normalize.ts` 加归一化；`sync.ts` 编排；`tests/helpers/fake-ef-server.ts` 加对应假端点。
