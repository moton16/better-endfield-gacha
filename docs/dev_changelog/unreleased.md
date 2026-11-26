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
