# 未发版技术变更流水

> **非溯源排查勿读**。按次版本号分文件归档（`v0.1.x` 周期 M1–W5 已归档至 [v0.1.md](v0.1.md)）。
> 后续 `v0.1.0` 正式切版与下一版本变更请在下方 `## [Unreleased]` 按批次追加。

## [Unreleased]

### [UI-V2] — 前端视觉模板升级、同周期 5★ 陪跑与武器十连聚合视图
- **分析引擎增强（`src/core/analysis/`）**：
  - `types.ts` / `common.ts` / `char.ts` / `weapon.ts`：新增 `SubHitSummary`（`subHits5` / `pendingSubHits5` 按 `itemId || itemName` 聚合周期内 5★ 陪跑计数，仅计 `kind === "draw"`）、武器池十连聚合 `weaponTenRolls`（含 6★/5★ 与 `isGift` 赠品及 `rollIndex`）与全账号摘要 `global`（`globalBadges`、`globalLuckCounts`、`totalDraws`/`totalFree`/`totalNonDraw`/`total6`、`firstRecordTs`、`ratingLabel`/`isLucky`）。
- **前端视觉升级（`src/web/`）**：
  - 参考视觉模板设计语言，基于纯 CSS 与 Inline SVG 自主实现（零外部 CDN/字体/图片 URL，适配浅色/深色模式与 360px–500px 宽度）：45° 斜纹页底、`#f2f2f2`/`#fcfcfc` 分层卡片、顶部玩家卡片与 `#efefef` 总计条、本地评分丝带与 10° 倾斜统计邮戳、4 卡槽横向总览与全账号全局徽章、`展示五星` 开关、`十连双金`/`免费十连` 斜角丝带、45° 斜纹进度条（`barWidth` 支持 70 抽封顶缩放）、随色阶变化的圆形 `歪` 印章、武器十连条（含青色 `赠` 徽标与切换水位视图）及 `?` 垫抽释义弹窗；`Avatar.tsx` 预留 `iconFor`/`bannerFor` 本地静态槽位。
  - 同步重构 `src/web/mock/analysis.sample.json`、`src/web/mock/accounts.json`、`src/web/api/mock.ts` 与 `tests/fixtures/server/analysis.json`，全部由 `analyzeAccount()` 合成记录生成以确保与 `tone`/`luck` 公式 100% 一致。
- **验证**：`pnpm typecheck`、`pnpm build`（`dist-web/` 约 91.5 KB < 200 KB，无外链 URL）、`pnpm test` 全绿；并经本地 `beg serve --port 0 --no-open` 实服务预览截图验收。
