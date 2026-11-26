# v0.1.x 技术变更流水（unreleased.md 模板同此）

> **非溯源排查勿读**。按次版本号分文件归档，发版后对应版本小节冻结。

## [Unreleased]

### [M1] — 路线 A 核心库 + CLI 初版
> **涵盖提交**：见 `git log`（首批提交，未发版）。
>
> **代码改动概况**：
> - `src/core/cache/*`：blockfile 只读解析（SuperFastHash 双校验、RankingsNode.last_used、外部 long_key）、SimpleCache 前瞻解析、目录发现（QtWebEngine + CEF md5 目录）、凭据提取与排序。
> - `src/core/api/*`、`src/core/sync/sync.ts`：ef-webview 客户端、5 类角色池 + 武器逐池 + rerun-counts + `/api/content`、feed 原子入库的增量同步。
> - `src/core/storage/store.ts`：node:sqlite，主键 `(account_key, feed, seq_id)`。
> - `src/cli/index.ts`：`scan/link/sync/accounts/stats/export`，默认脱敏。

- **核心实现与根因**：
  - Node/libuv 在 Windows 打开文件固定带 `FILE_SHARE_READ|WRITE|DELETE`，因此无需 ffi 调 `CreateFileW`；`tests/win-lock.test.ts` 用另一进程持有 DELETE 句柄的方式实证“缺 DELETE 共享的打开失败 / 本项目的打开成功”。
  - 缓存 key 可能带 `1/0/_dk_<site> <site> <url>` 前缀，URL 取最后一个 http 片段（合成夹具测试暴露的坑，真实 QtWebEngine 缓存为裸 URL）。
  - 增量游标与分页缺口：feed 中途失败若保存已拉到的新页，下次会在已知 seq 处提前停止而永久漏掉中间页，故 feed 原子入库。
  - 真实实机冒烟（本机 B 服缓存）：42/42 条目哈希通过，`index.crash==1` 被容忍，凭据指纹与调研报告一致，渠道 `2/2`；实机分页页大小为 5。
- **验证**：`pnpm typecheck` 通过；`pnpm test` 23 passed（含 Windows 共享锁实证）。未覆盖：真实 CEF 缓存（官方尚未启用）、路线 B（未实现）、`query_role_list.uid` 与 `binding.uid` 是否同值（未实测）。

### [W0] — 路线 B 通行证链路 + CLI 命令注册表
> **涵盖提交**：`3ba8c36`（`refactor(cli): command registry (W0)`）及本批次路线 B 收尾提交（分支 `feat/w0-route-b`）。
>
> **代码改动概况**：
> - `src/core/auth/passport.ts`、`dpapi.ts`、`vault.ts`、`src/core/route-b.ts`：完成路线 B（`hytoken → grant → binding_list → u8_token_by_uid → query_role_list/回退 → syncAccount`）及 Windows DPAPI（`CurrentUser`）加密保险库 `vault.json`。
> - `src/cli/context.ts`、`types.ts`、`util.ts`、`commands/*`、`index.ts`：将单文件 `switch` 拆分为命令注册表，新增 `login`、`logout` 与 `sync --passport`（支持 `--qr` / `--token-stdin` / `BEG_HYTOKEN` / `vault.json`），抽离 `printReport` 供路线 A/B 共用。
> - `tests/helpers/fake-passport.ts`、`tests/helpers/combine-fetch.ts`、`tests/passport.test.ts`、`tests/vault.test.ts`、`tests/route-b.test.ts`：补齐通行证协议、DPAPI 保险库（含 Windows 实测）、多渠道隔离与回退/容错测试。
> - `README.md`、`docs/DEVELOPER.md`：补充路线 B 使用指南、`vault.json` 威胁模型与模块说明。

- **根因与关键决策**：
  - 修复 `passport.ts` 顶部块注释内 `as.*/` 提前闭合注释导致的语法错误。
  - 严格校验鹰角通行证业务状态字段 `json?.status === 0`（移除 `?? json?.code` 回退），确保仅返回 `{ code: 0 }` 时明确报错；`parseHyTokenInput` 对非法百分号编码返回 `null`；`qrWait` 结合实耗时间与累计等待间隔，保证注入 `sleep` 的超时测试不空转。
  - CLI 注册表将选项解析集中至 `src/cli/context.ts`（`OPTIONS` 超集），后续模块只需新增命令文件并在 `commands/index.ts` 追加一行。
- **验证**：`tsc -p tsconfig.json` 0 error；`vitest run` 7 个测试文件共 46 passed（新增 23 条，含 Windows 真实 DPAPI 加解密往返）；`tsx src/cli/index.ts --help` 列出 `login`/`logout`，`tsx src/cli/index.ts scan` 重构前后输出一致。未覆盖（留待 W6 实机验证）：扫码登录三接口真实响应、`query_role_list.uid` 与 `bindingList[].uid` 是否等值、同绑定多角色换票落点。

### [W1] — 分析引擎（保底 / 歪 / UP / 徽章 / 分组）
> **涵盖提交**：分支 `feat/w1-analysis`（见 `git log`）。
>
> **代码改动概况**：
> - `src/core/analysis/{config,types,common,up,char,weapon,summary,index}.ts`、`src/core/data/up-map.json`：实现零状态纯函数分析引擎 `analyzeAccount`，覆盖 5 类角色池与 3 类武器池小/大保底、跨池共享、Rerun 按池名跨版本归并及官方计数封顶、Joint 独立计数、免费抽隔离、歪/UP 判定、徽章（`十连双金` / `九蓝一紫`，自动跳过 `lcx:` 占位批次）与分 Tab 总览。
> - `src/core/storage/store.ts`：在 W1 标记区块追加 `getAllPools(): PoolInfo[]`。
> - `src/cli/context.ts`、`src/cli/commands/stats.ts`：新增 `--analysis` 选项输出 `analyzeAccount` JSON（默认通过 `maskKey` 脱敏，`--show-ids` 才明文）。
> - `tsconfig.json`、`.gitignore`：启用 `resolveJsonModule: true`，保证 `tsc -p tsconfig.build.json` 正确输出 `dist/core/data/up-map.json`；在 `.gitignore` 白名单放行 `src/core/data/`，避免被运行期 `data/` 规则误忽略。
> - `tests/analysis.test.ts`、`docs/DEVELOPER.md`：新增 14 条纯函数/Store/CLI 脱敏测试，并补充分析引擎模块文档与风险标注。

- **根因与关键决策**：
  - `config.ts`、`types.ts`、`common.ts` 保持零 Node 依赖，供后续 W4 Web UI 直接复用；`char.ts` 与 `tabOf()` 共用 Tab 映射避免两处漂移。
  - 规则取自社区实现 `bhaoo/endfield-gacha`（MIT），非官方文档；`GachaRecord` 暂缺 `poolVersion`，重构池按版本重置小保底本期不实现；徽章与绿/黄/粉/超欧/超非阈值均为实机截图推断，集中于 `config.ts` 以便统一调整。
  - `index.ts` 对未知 UP 提示仅针对非 `Standard` / `Beginner` / `constant` 池；`freeBatches` 按 W1 规划先留空数组 `[]`。
- **验证**：`tsc -p tsconfig.json`、`tsc -p tsconfig.build.json`（已生成 `dist/core/data/up-map.json`）0 error；`vitest run` 8 个测试文件共 60 passed（新增 14 条）；对本机冒烟库只读聚合校验通过（`limited total=399, count6=8`，无 `NaN`/负数，`pending < smallPityMax`）。未覆盖：`freeBatches` 免费十连批次明细（第二阶段）、重构池按 `poolVersion` 重置小保底、真实数据多池同 `gachaTs` 批次假设（待 W6 验证）。

### [W2] — 导入 / 导出 / 备份（v1、离愁轩救援、CSV、自动备份）
> **涵盖提交**：分支 `feat/w2-io`（见 `git log`）。
>
> **代码改动概况**：
> - `src/core/storage/store.ts`：在 `// ==== W2 BEGIN/END` 区块追加 `getRecordFingerprints`、`backupTo`（确保父目录存在并检查目标文件不存在以遵循 `VACUUM INTO` 约束）与 `getAccount`。
> - `src/core/io/{validate,v1,lcx,importer,csv,index}.ts`：实现字段强校验与限额 `LIMITS`、`better-endfield-gacha/v1` 解析与身份键重算、`planImport`/`applyImport`（官方数据优先保留不覆盖、落库前自动备份且支持同秒碰撞后缀）、离愁轩（`lcx_wiki_json`，参考 MoguJunn MIT 实现思路）救援解析与保守映射、UTF-8 BOM + 防公式注入 + RFC 4180 CSV 导出。
> - `src/cli/context.ts`、`src/cli/commands/{import,export,backup,index}.ts`：注册 `import`（默认干跑、`--apply` 落库、`maskKey` 脱敏）与 `backup` 命令，扩展 `export` 支持 `--format json|csv`、`--include-gifts`（`csv` 强制 `--out`）。
> - `tests/fixtures/io/lcx-sample.json`、`tests/io.test.ts`、`tests/route-b.test.ts`：新增 11 条导入/导出/离愁轩/CSV/备份/CLI 干跑与脱敏测试（另将 `tests/route-b.test.ts` 中对 `COMMANDS` 的硬编码全等断言改为 `expect.arrayContaining`，以兼容后续模块追加注册命令）。
> - `README.md`、`docs/DEVELOPER.md`：补充大白话“导入导出与备份”指南与 `core/io/*` 仓库地图/模块表说明。

- **根因与关键决策**：
  - 在真实冒烟数据往返测试中发现官方非抽卡记录（`kind: "gift_intel_book"`）合法存在 `rarity: 0` 与 `itemId: ""`；据此将 `validateRecord` 调整为按 `kind === "draw"` 区分约束——抽卡记录严格校验 `rarity ∈ 1..6` 与非空 `itemId`，非抽卡记录允许 `rarity ∈ 0..6` 与空 `itemId`，从而无损往返 610 抽 + 3 条 gift 且继续拦截非法抽卡记录。
  - `makeBackupPath` 在同秒内多次触发 `applyImport` / `backup` 时自动探测并追加 `-1`/`-2` 后缀，规避 SQLite `VACUUM INTO` 目标文件不可已存在的报错。
  - 离愁轩导入采用保守映射策略（`--pool-map` → 本地账号记录唯一映射；同名多池入 `ambiguous`、未知池入 `unresolvedPools`，不猜不插；本地已有 `lcx:` 前缀记录不参与真实 `itemId` 唯一映射统计以免污染官方映射）。
- **验证**：`.\node_modules\.bin\tsc.CMD -p tsconfig.json` 与 `.\node_modules\.bin\tsc.CMD -p tsconfig.build.json --noEmit` 0 error；`.\node_modules\.bin\vitest.CMD run` 9 个测试文件共 71 passed（含新增 11 条 W2 测试）；使用本机脱敏冒烟库经临时目录完成 `export → import 干跑 → --apply（610 抽 + 3 gift 全数入库）→ 二次导入 0 新增 → csv/backup` 往返校验且 `stats` 一致。未覆盖：真实离愁轩导出文件实机样本验证（合成夹具已覆盖已知坑点，真机样本留待 W6）。
