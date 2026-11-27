# 那么，一切从这里开始吧。
### 如有 commit 变更，请同步在此说明更新。非必要可以**不读**该文件，阅读 [DEVELOPER.md](../DEVELOPER.md) 即可。只在你需要补充内容以及遇到困难要溯源时进行查证使用。否则就太占上下文了。
### 请在每次 commit 的开头标注 commit 提交的用户名（GitHub 用户名），时间，若 commit 为 AI 直接提交的，请一并输出 Agent 与模型底模（如你的系统提示词有明确告诉你你是什么模型，没有则不需要）的名字。
#### 如：`moton16,2026-9-13,Codex,GPT-6-Astra`
### 💡 组织说明：同一次任务/同一 Agent 连续提交的多个 commit 已按工作批次（如 `[C0–C7]`）合并整理，并提供了清晰的「涵盖提交」与「代码改动概况」；独立提交（如架构审查报告、重大发版节点、独立专项缺陷修复）继续单独成项，以兼顾溯源精度与阅读效率。
### ⚠️ 必须注意文档分工：面向普通用户的日常更新在根目录 [CHANGELOG.md](../../CHANGELOG.md)，必须用大白话只讲功能增减与体验，绝不允许写技术细节；所有的代码逻辑、实现细节与技术变更流水必须且只能写在本文档（`docs/dev_changelog/`）与 [DEVELOPER.md](../DEVELOPER.md)！

> 历史批次：`v0.1.x` 周期 M1 至 W5 已归档至 [v0.1.md](v0.1.md)。后续 `v0.1.0` 正式切版与下一版本变更请在下方 `## [Unreleased]` 按批次追加。

---

## [Unreleased]

### [UI-V2] — moton16,2026-11-26 — 前端视觉模板升级、同周期 5★ 陪跑与武器十连聚合视图
> **涵盖提交**：`7596858`（`feat(web): overhaul UI template design language and add 5-star/weapon ten-roll views`）。

- **分析引擎增强（`src/core/analysis/`）**：
  - `types.ts` / `common.ts` / `char.ts` / `weapon.ts`：新增 `SubHitSummary`（`subHits5` / `pendingSubHits5` 按 `itemId || itemName` 聚合周期内 5★ 陪跑计数，仅计 `kind === "draw"`）、武器池十连聚合 `weaponTenRolls`（含 6★/5★ 与 `isGift` 赠品及 `rollIndex`）与全账号摘要 `global`（`globalBadges`、`globalLuckCounts`、`totalDraws`/`totalFree`/`totalNonDraw`/`total6`、`firstRecordTs`、`ratingLabel`/`isLucky`）。
- **前端视觉升级（`src/web/`）**：
  - 参考视觉模板设计语言，基于纯 CSS 与 Inline SVG 自主实现（零外部 CDN/字体/图片 URL，适配浅色/深色模式与 360px–500px 宽度）：45° 斜纹页底、`#f2f2f2`/`#fcfcfc` 分层卡片、顶部玩家卡片与 `#efefef` 总计条、本地评分丝带与 10° 倾斜统计邮戳、4 卡槽横向总览与全账号全局徽章、`展示五星` 开关、`十连双金`/`免费十连` 斜角丝带、45° 斜纹进度条（`barWidth` 支持 70 抽封顶缩放）、随色阶变化的圆形 `歪` 印章、武器十连条（含青色 `赠` 徽标与切换水位视图）及 `?` 垫抽释义弹窗；`Avatar.tsx` 预留 `iconFor`/`bannerFor` 本地静态槽位。
  - 同步重构 `src/web/mock/analysis.sample.json`、`src/web/mock/accounts.json`、`src/web/api/mock.ts` 与 `tests/fixtures/server/analysis.json`，全部由 `analyzeAccount()` 合成记录生成以确保与 `tone`/`luck` 公式 100% 一致。
- **验证**：`pnpm typecheck`、`pnpm build`（`dist-web/` 约 91.5 KB < 200 KB，无外链 URL）、`pnpm test` 全绿；并经本地 `beg serve --port 0 --no-open` 实服务预览截图验收。

### [UI-V3] — moton16,2026-11-26 — 排版字重重构、5 卡/5 标签对齐、紧凑单行与内嵌数字字体
> **涵盖提交**：`b3c9895`（`feat(web): align layout, typography, 5-tab cards, and compact rows (UI-V3)`）。

- **分析层补全（`src/core/analysis/`）**：`SixStarHit.prevPoolDiff` 记录跨池继承垫抽数；`char.ts` 填充 `freeBatches`（未出 6★ 的免费十连批次）。
- **字体与排版重构（`src/web/fonts/`、`styles/*`、`components/*`）**：
  - 内嵌 OFL-1.1 `Public Sans` Regular/Medium/Bold WOFF ASCII/数字子集（合计约 18 KB），还原数字字重层级，统一轻盈中文 UI 字重（400/500），消除桌面系统斜杠背景与强制暗色反转，主视口收敛至 `#ffffff / #f2f2f2 / #fcfcfc` 480px 工业卡片列；
  - 瘦身顶部 `Header`（移除后台工具栏与表单边框，收束为紧凑头像/昵称/渠道/UID/胶囊动作与 `26px` 总计条）；
  - 总览升级为 `限定 / 复刻 / 武器 / 庆典 / 基准` 5 张 `102px` 不可边框选中横滑卡，徽章改用 `十连双金 xN` 纯黑清晰文字；
  - 出货列表升级为 `限定池 / 复刻池 / 武器池 / 庆典池 / 常驻` 5 栏，默认单行紧凑（`32×32` 低饱和占位块 + `24px` 进度条 + 内联 `已垫N抽`/`超欧`/`歪` 印章），并按 `freeBatches` 展示灰标 `免费十连`；武器十连行修复 `.weapon-avatar-viewport` 为 `flex: 0 1 auto` 使 `第 N 个十连` 紧贴图标结尾。

### [W6-FIX] — moton16,2026-11-26 — 路线 B 空绑定跳过与离愁轩导入体验收口
> **涵盖提交**：`47f6a42`（`fix(sync,io): skip empty passport bindings and improve lcx import UX (W6)`）。

- **路线 B 空绑定跳过（`src/core/auth/role.ts`、`src/core/route-b.ts`、`src/server/routes/sync.ts`、`src/web/components/SyncDialog.tsx`）**：
  - `role.ts` 导出 `RoleQueryError` 与 `isNoRole` 属性，单独区分 `query_role_list` 的 `status=101`（该渠道无角色）与真实接口错误。
  - `route-b.ts` 在换票前检查 `b.roles.length === 0`（及无回退的 `isNoRole`）并直接跳过、记录警告 `"该渠道下没有角色，已跳过"`（不消耗额外 `grantOAuth` / 不请求 `u8_token_by_uid`），不再产生失败项或让 `beg sync --passport` 误返退出码 `4`。
  - `server/routes/sync.ts` 与 `SyncDialog.tsx` 对无角色跳过项标为 `ok: true`、`maskedKey: "已跳过（无角色）"` 并按索引去重渲染 `key`。
- **离愁轩导入与历史 UP 补齐（`src/core/io/importer.ts`、`src/core/io/lcx.ts`、`src/core/data/lcx-catalog.ts`、`src/core/data/up-map.json`、`src/cli/commands/import.ts`、`src/server/routes/importexport.ts`）**：
  - `planImport` 新增 `allowTruncatedMs`（仅由离愁轩导入启用，保持 `v1` 严格指纹不变）：当官方精准毫秒记录与导出截断 `000` 毫秒记录在 `(itemId, rarity, isFree, kind)` 与整秒上完全一致时归入 `duplicates` / `truncatedMsDuplicates`（保留本地精确记录），`gift_*` 与 `lcx:unknown4` 等实质差异继续留在 `conflicts`；CLI 与 Server 同步给出毫秒截断判重提示。
  - 新增 `src/core/data/lcx-catalog.ts` 内置国服 1.0~1.7 卡池映射与角色/六星武器官方 ID 映射（卡池优先级 `--pool-map` > 本地同名池 > 内置映射，保留本地歧义报错；物品 ID 优先级本地库 > 内置映射 > `lcx:<name>`）。
  - 补全 `src/core/data/up-map.json` 中的 1.0~1.7 角色/武器限定池、联合池、复刻池与常驻武器箱 UP 六星清单，并新增 `tests/fixtures/io/lcx-real-shape.json` 与对应单元/集成测试。

### [P0–P2] — Vodyanitsaaa,2026-11-27,Antigravity — feat(core,server,web,tauri): v0.1.0-rc.1 产品化收口（QR 扫码、u8_token 持久化、UP 覆盖层、图包与自选头像、Tauri v2 桌面轻壳）
> **涵盖提交**：本批次合并提交至 `main`（版本号由 `0.1.0-dev` 升级至 `0.1.0-rc.1`）。
>
> **代码改动概况**：
> - `src/core/qr.ts`、`tsconfig.web.json`、`tests/qr.test.ts`：新增零 Node 依赖 ISO/IEC 18004 Byte 模式二维码编码器（`encodeQr` / `renderQrTerminal`，支持 GF(256) RS、Version 1–20、EC `L`/`M` 与半高块终端渲染），纳入 `tsconfig.web.json`。
> - `src/core/auth/passport.ts`、`src/cli/commands/login.ts`、`src/server/routes/passport.ts`、`src/web/components/SyncDialog.tsx`、`tests/{passport,server,web-ui}.test.ts*`：`call()` 在 `!res.ok` 经 `readHttpErrorMessage` 保留服务端 `msg`/`message`；新增 `qrPollStatus`（区分未扫码与网络异常）与 `formatBindingsLabel`；清理过时 `【未实测】` 注释；新增 `POST /api/passport/qr`（限国服、TTL 5m、上限 32 会话）与 `GET /api/passport/qr/:scanId`（`confirmPromise` 防并发重复换票，连续错误 `>=3` 置 `error`，全程后端完成换票与 Vault 写入，不下发明文 `hytoken`/`uid`）；Vault 返回脱敏 `label`；Web 端接入 Inline `<svg>` 二维码、确认后自动触发同步，并在路线 A 凭据过期后提供一键切扫码按钮；CLI `--qr` 打印终端二维码并在 `--save` 写入 `label`。
> - `src/core/auth/u8-store.ts`、`src/core/route-a.ts`、`src/core/sync/sync.ts`、`src/cli/commands/sync.ts`、`src/server/routes/sync.ts`、`tests/route-a-persist.test.ts`：新增 DPAPI 加密 `U8Store`（`u8-cache.json`，按 `${region}:${channel}` 分键，非 Windows 无自定义 `SecretCrypto` 或 `:memory:` 优雅禁用）；`syncFromCache` 优先复用持久 `u8_token`（不做客户端 TTL 猜测），仅在 `EfApiError(40100)`（由 `sync.ts` 直接透传）或非 `101` `RoleQueryError` 时删除旧条目并回源重扫缓存（排除已失效 token），无新凭据时抛 `CredentialExpiredError`（CLI 退出码 `2`）。
> - `src/core/analysis/{up,index}.ts`、`src/server/index.ts`、`src/cli/commands/stats.ts`、`tests/up-override.test.ts`：`makeUpResolver` 新增 `loadUpMapOverride(dataDir?)` 读取 `<dataDir>/up-map.override.json`（`_` 前缀键忽略），解析优先级维持 `_` 未知 < DB `pools` > 本地覆盖层 > 内置 `up-map.json`；`server/index.ts` 与 CLI `{serve,stats}` 透传 `dataDir`。
> - `src/cli/context.ts`、`src/cli/commands/serve.ts`、`src/core/storage/store.ts`、`tests/serve-host.test.ts`：`OPTIONS` 末尾追加 `"parent-pid"` 与 `"watch-stdin"`；`waitForStopSignal` 轮询父 PID 并仅在显式开启 `--watch-stdin` 时监听 `stdin` EOF（防止 Windows `Start-Process` / `stdio: "ignore"` 在 0ms 误触发 `end` 事件早退）；`GachaStore.close()` 先执行 `PRAGMA wal_checkpoint(TRUNCATE);` 再关闭数据库句柄。
> - `src/web/public/media/*`、`src/web/lib/media.ts`、`src/web/components/{Avatar,PoolSection,Header,AvatarPickerDialog}.tsx`、`src/web/App.tsx`、`src/core/storage/store.ts`、`src/server/routes/accounts.ts`、`tests/{web-media,web-build,web-ui,server}.test.ts*`、`NOTICE.md`：接入 `241` 个静态 WebP 资源（`chars` 35、`weapons` 86、`boxes` 46、`avatars` 59、`banners` 15）与零外链 `manifest.json`（总计 `3,639,451 B`）；`media.ts` 实现先验存在性防 404、`爆破单元(wpn_funnel_0008)` ↔ `骑士精神(wpn_funnel_0010)` 互换（显式 `itemAlias` 不二次反转）、`宏愿(wpn_sword_0021)` ↔ `wpn_sword_0021_ink` 双向别名与 29 条补给箱 `itemAlias` 去重，`PoolSection.tsx` 维持无横幅池 CSS 渐变兜底；SQLite 新增 `account_prefs` 表与 `GET /api/accounts` / `PUT /api/accounts/:key/avatar`（`128 KB` body 上限，严审空串 / `media/(avatars|chars)/*.webp` / `<= 64 KB` 光栅 DataURL，拒 SVG 与 HTTP）；`AvatarPickerDialog.tsx` 支持 59 个预设 + 35 个干员 + Canvas 居中裁剪并按 `accountKey` 持久化（含 `localStorage` 回退），联动 `Header.tsx` 隐私遮罩显示「终」；拆分 `tests/web-build.test.ts` 体积预算（代码与字体 `< 200 KB`，`media/` `< 10 MB`，HTML/CSS/JS/JSON 零外链）；`NOTICE.md` 补全衍生美术资产版权声明。
> - `src-tauri/`、`scripts/pack-tauri.ps1`、`package.json`、`.gitignore`、`tests/tauri-shell.test.ts`、`CHANGELOG.md`、`README.md`、`QUICKSTART.md`、`docs/DEVELOPER.md`、`package.json`/`src/version.ts`：新增 Tauri v2 Windows 桌面轻壳（单实例、`%TEMP%`/只读目录启动守卫、注册表 WebView2 检测引导、`CREATE_NO_WINDOW` 启动 Node sidecar、`#k=` 内存解析、仅 `about:blank` 与精确同端口回环 `on_navigation` 白名单、`on_new_window` 拒绝外开、`drop(stdin)` + 1500ms 优雅退出）；新增 `pack-tauri.ps1` 构建 NSIS 安装包与 Desktop 便携 zip 及 `.sha256`（含官方 `node.exe` SHA256 与 Authenticode `Valid` 校验、`release/` 隔离缓存与资源自动清理）；修正 `CHANGELOG.md` 早期「深色卡片」描述并同步三层文档与 `0.1.0-rc.1` 预发布版本锚点。

- **核心实现与根因**：
  - **Windows `\\?\` verbatim 路径崩溃修复（`src-tauri/src/{guards,lib,sidecar}.rs`）**：Windows 下 Tauri v2 `app.path().resource_dir()` 返回带 `\\?\` 前缀的路径（如 `\\?\D:\...\resources`），将其直接传入 `node.exe`（`v24.15.0`）时，Node 模块加载器内部 JS `fs.realpathSync` 会将 `\\?\D:` 解析异常并抛出 `Error: EISDIR: illegal operation on a directory, lstat 'D:'`。抽取公共 `strip_verbatim_prefix` 剥离标准盘符 `\\?\` 与 `\\?\UNC\` 前缀（保留原大小写与 `\\?\Volume{...}\` 设备路径），统一应用于 `resolve_exe_dir`、`resolve_data_dir`、`resolve_runtime_paths` 与 `SidecarHandle::start` 全部子进程参数及环境变量。
  - **Windows `stdin` 误退防护（`serve.ts`）**：无父级标准输入管道或 `stdio: "ignore"` 场景下挂载 `stdin.on("end")` 会在 0ms 立刻触发退出，因此通过显式 `--watch-stdin` 参数隔离 Tauri sidecar 关窗退出通道与 CLI 普通 `--parent-pid` 托管模式。
  - **高危素材 ID 对齐（`media.ts` / `manifest.json`）**：对上游图包中名称与图标文件名互换的 `wpn_funnel_0008`/`0010`、`wpn_sword_0021` ink 变体及 29 个补给箱同图多 ID 建立确定性映射与存在性先验，避免前端触发不存在资源的 404。
- **验证**：
  - `src-tauri` 下 `cargo test`：**`16 passed; 0 failed`**（零编译器告警）；
  - `pnpm typecheck`、`pnpm build`（代码与字体 `< 200 KB`，`media/` 约 `3.47 MiB` `< 10 MB`，零外链）：全部通过；
  - `pnpm test`：**23 个测试文件通过，`188 passed | 1 skipped`**（`tests/dpapi.test.ts` 的非 Windows 跳过用例）；
  - `pnpm pack:tauri`：校验官方 `node-v24.15.0-win-x64.zip` SHA256 与 OpenJS Foundation Authenticode 签名，构建 `better-endfield-gacha-0.1.0-rc.1` NSIS 安装包与桌面便携 zip（含包内条目与敏感路径拦截校验）及 `.sha256`；
  - Windows 11 本机实机桌面包启动与退出冒烟（临时目录解压运行 `better-endfield-gacha.exe`）：成功拉起无 `\\?\` 前缀的 `node.exe`、监听回环端口并与 WebView2 建立连接、初始化 `gacha.sqlite`、显示 `Better Endfield Gacha` 主窗口，发送 `WM_CLOSE` 后退出码 `0`、子进程退出且 `gacha.sqlite-wal` 截断为 `0` 字节。
- **未覆盖 / 后续节点**：
  - 干净 Windows 实体机（未预装 Node.js / PowerShell 7 / WebView2）端到端测试及 NSIS 安装包实际安装/卸载流程待后续在独立环境手工完成。
