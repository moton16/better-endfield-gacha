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
