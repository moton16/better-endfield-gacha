# 那么，一切从这里开始吧。
### 如有 commit 变更，请同步在此说明更新。非必要可以**不读**该文件，阅读 [DEVELOPER.md](../DEVELOPER.md) 即可。只在你需要补充内容以及遇到困难要溯源时进行查证使用。否则就太占上下文了。
### 请在每次 commit 的开头标注 commit 提交的用户名（GitHub 用户名），时间，若 commit 为 AI 直接提交的，请一并输出 Agent 与模型底模（如你的系统提示词有明确告诉你你是什么模型，没有则不需要）的名字。
#### 如：`moton16,2026-9-13,Codex,GPT-6-Astra`
### 💡 组织说明：同一次任务/同一 Agent 连续提交的多个 commit 已按工作批次（如 `[C0–C7]`）合并整理，并提供了清晰的「涵盖提交」与「代码改动概况」；独立提交（如架构审查报告、重大发版节点、独立专项缺陷修复）继续单独成项，以兼顾溯源精度与阅读效率。
### ⚠️ 必须注意文档分工：面向普通用户的日常更新在根目录 [CHANGELOG.md](../../CHANGELOG.md)，必须用大白话只讲功能增减与体验，绝不允许写技术细节；所有的代码逻辑、实现细节与技术变更流水必须且只能写在本文档（`docs/dev_changelog/`）与 [DEVELOPER.md](../DEVELOPER.md)！

> 历史批次：`v0.1.x` 周期（M1 至 W5 及 `0.1.0-rc.1` 收口批次 `UI-V2`–`ANALYSIS-FREE-QUOTA`）已归档至 [v0.1.md](v0.1.md)。后续 `v0.1.0` 正式切版与下一版本变更请在下方 `## [Unreleased]` 按批次追加。

---

## [Unreleased]

### [DOC-PACK] — Vodyanitsaaa,2026-11-27,Antigravity,Claude Sonnet 5.5 — docs: 在 DEVELOPER.md 增补本机打包流程说明
- **`docs/DEVELOPER.md`**：在 §7「常见任务食谱」新增「本机打包流程（Windows CLI 便携版 / Tauri 桌面版）」，简述前置工具链、Tauri CLI 查找顺位（`BEG_TAURI_CLI` → `cargo-tauri` → `node_modules/.bin/tauri.cmd` → `D:\dependency\tauri-cli` → 全局 `tauri` → `npx`）、`scripts/pack.ps1` 与 `scripts/pack-tauri.ps1` 的阶段顺序、校验门禁、输出路径及临时目录清理约定。
- **验证**：纯文档改动，已核对 `docs/DEVELOPER.md` 维持 7 节结构且总行数 ≤ 800。

### [DATA-IO-UX] — Vodyanitsaaa,2026-11-27,Antigravity,Claude Sonnet 5.5 — fix: 空库导入离愁轩、导出落盘可见、备份可恢复
> **涵盖提交**：`5fc7663`（`fix(io,server,web,cli): support empty-library lcx import, disk export, and backup restore`）。

- **问题**：① 空库导入离愁轩 JSON 被强制「先选目标账号」，但此时根本没有账号；② 导出走 blob 下载，桌面壳（WebView2）里无任何可见反馈，用户不知文件在哪；③ 备份只能生成 `.sqlite`，没有任何恢复入口（导入只认 JSON）。
- **`core/io/lcx.ts`**：新增 `readLcxMeta`（只读 `data.uid/nickName/server/serverId`，UID 限 `[A-Za-z0-9_-]{1,64}`）与 `resolveLcxAccount`（先匹配 `roleId`/`bindingUid`/`accountKey` 相同的已有账号，否则按 `server` 含 `bili` 判渠道 2/1 新建 `cn` 国服 `source=import` 账号）。
- **`core/io/restore.ts`（新）**：`listBackups`/`resolveBackupFile`/`planRestore`/`applyRestore`，合并式恢复（见 §4 `io/*` 行）。
- **`server/routes/importexport.ts`**：`POST /api/import` 新增 `createAccount: true`（未传 `account` 时自动匹配/新建；仍不传则 400，旧契约不变；预览返回 `createdAccount` 与警告）；新增 `POST /api/export/save`（写入 `<dataDir>/exports/beg-export-<时间戳>.<ext>`，`wx` 防覆盖，返回 `file/dir/bytes/accounts/records`）、`POST /api/open-folder`（`target` 仅 `exports|backups`，`AppDeps.openFolder` 可注入便于测试）、`GET /api/backups`、`POST /api/backup/restore`（`apply` 默认干跑，坏文件返 `400 bad_backup`）；`GET /api/export` 保持兼容。
- **`GachaStore.open`**：构造失败时关闭句柄后再抛错。
- **CLI**：`import --new-account`（lcx 无 `--account` 时的自动匹配/新建）；新增 `restore`（`--in <备份名或路径>`，不带 `--in` 列备份，默认干跑，`--apply` 写入）。
- **前端 `DataDialog.tsx`**：导出按钮直接落盘并显示文件名与目录、提供「打开导出文件夹」；导入目标账号默认「自动」，去掉离愁轩必选账号的拦截；新增「备份与恢复」区（备份列表、预览恢复→确认恢复、打开备份文件夹）；错误提示置顶；mock 同步新增接口。
- **局部验证**：`tests/data-io.test.ts` 与 `tests/web-ui.test.tsx` 局部测试通过。

### [POLICY-MIN-TEST] — Vodyanitsaaa,2026-11-27,Antigravity,Gemini 4 Hydrogen — docs/chore: 确立非发版严禁全量测试规范并收口打包脚本门禁
- **`AGENTS.md` / `docs/DEVELOPER.md`**：新增第 6 条致命红线与 §6/§7 规范——全量测试（`pnpm test` / `cargo test`）**仅在正式发版（`BEG_RELEASE=1`）时运行**，非正式发版期间绝对严禁跑全量测试，普通开发/修复仅运行与改动直接相关的局部最小测试及 `pnpm typecheck`。
- **`scripts/pack.ps1` / `scripts/pack-tauri.ps1`**：默认跳过全量 `pnpm test`（仅在 `BEG_RELEASE=1`/`true` 或显式 `-WithTests` 时执行全量测试），同时两者统一支持 `-SkipChecks`（`BEG_RELEASE=1` 时禁止 `-SkipChecks`）。
- **`CHANGELOG.md` / `QUICKSTART.md` / `docs/DEVELOPER.md`**：同步补充 `[DATA-IO-UX]` 的用户向更新日志、使用指南与 §4 模块表条目。
- **局部验证**：运行 `tests/tauri-shell.test.ts`、`tests/version-guard.test.ts` 与 `scripts/pack*.ps1` PowerShell AST 校验（仅局部最小测试，未跑全量）。

### [CO-AUTHORS] — Vodyanitsaaa,2026-11-27,Antigravity,Gemini 4 Hydrogen — chore: 在提交历史中补录 Codex / Gemini / Claude 协同贡献者
- **`docs/dev_changelog/unreleased.md`**：通过最小文档增量提交附带 `Co-authored-by` 署名（`codex`、`gemini-code-assist`、`claude`），以便 GitHub Contributors 列表收录三位协同 AI 贡献者；工作区原有未暂存业务改动未受影响。

### [ANALYSIS-RATING] — Vodyanitsaaa,2026-11-27,Antigravity,Gemini 4 Hydrogen — feat(analysis,web): 重构六级欧非称号模型（按池期望抽数加权与歪率 Z 偏移）
- **`src/core/analysis/rating.ts`（新） / `summary.ts` / `src/web/lib/bar.ts` / `tsconfig.web.json`**：将原先按小保底水位的称号逻辑抽离为 Core 与 Web 共用的 `computeRating`，按池期望抽数（角色 50 / 武器 19）加权计算综合出货指数，对限定/复刻/武器池已知 UP ≥ 4 的付费 6★ 应用歪率标准差偏移 $Z$（`±1` 升降一档），并对 `< 5` 付费 6★ 启用小样本极端档位保护。
- **夹具与文档**：同步更新 `docs/DEVELOPER.md`、`src/web/mock/analysis.sample.json`、`tests/fixtures/server/analysis.json`、`tests/analysis.test.ts`、`tests/web-bar.test.tsx`、`tests/web-ui.test.tsx`。
- **局部验证**：`tsc -p tsconfig.json`、`tsc -p tsconfig.web.json` 与 `vitest run tests/analysis.test.ts tests/web-bar.test.tsx tests/web-ui.test.tsx`（36 passed）。

### [DATA-IO-ONECLICK] — Vodyanitsaaa,2026-11-27,Antigravity,Gemini 4 Hydrogen — fix(web): 合并 DataDialog 导入与恢复为单步操作，消除前置干跑门控
- **`src/web/components/DataDialog.tsx`**：移除「预览导入（干跑）」→「确认导入」与「预览恢复」→「确认恢复」的两步禁用门控，统一简化为单枚「导入」主按钮与各备份条目的单枚「恢复」按钮，点击后直接 `apply: true` 写入（后端仍自动在操作前备份 `.sqlite` 且官方记录永不覆盖）并展示结果明细（总计/新增/重复/冲突/跳过/警告/未识别卡池/自动备份文件名）。
- **文档与局部测试**：更新 `tests/web-ui.test.tsx`、`docs/DEVELOPER.md`、`CHANGELOG.md`、`QUICKSTART.md`；仅跑 `tsc` 与局部相关测试 `tests/web-ui.test.tsx`。

### [UI-POOL-HEADER] — moton16,2026-11-27,Antigravity — fix(web): 回调角色横幅右移与武器柔和头图，移除头栏大保底余提示
- **改动文件**：`src/web/components/PoolSection.tsx`、`src/web/styles/components.css`、`tests/web-media.test.tsx`、`tests/web-bar.test.tsx`、`docs/DEVELOPER.md`。
- **代码改动概况**：
  1. `resolveHeaderArt` 恢复角色池优先走 `bannerFor(poolId)` 横幅（无横幅池回退 `chars/` 头像）；`.pool-head-art-box` 置于 `z-index: 0`，位于 `.pool-head-backdrop`（`z-index: 1`）下方与背景融合。
  2. 角色横幅定位至 `left: 38%; right: 0`（配套左缘渐变羽化与背景遮罩 `37.5% -> 60%`），人物正脸露在右侧亮区且不与左侧文字相撞；无横幅池回退 `96px` 柔和头像。
  3. 武器头图放大至 `113px × 113px` 并右移至 `left: 49%`，以 `opacity: 0.65`、`filter: blur(0.9px) saturate(0.9)` 与径向羽化融入 `.theme-weapon` 暖橙渐层；同时移除头栏多余的 `大保底余 xx`。
- **局部验证**：`pnpm typecheck`、`vitest run tests/web-media.test.tsx tests/web-bar.test.tsx` 与 `pnpm web:build` 通过。
