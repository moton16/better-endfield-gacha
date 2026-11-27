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

### [UI-V3] — 排版字重重构、5 卡/5 标签对齐、紧凑单行与内嵌数字字体
- **分析层补全（`src/core/analysis/`）**：`SixStarHit.prevPoolDiff` 记录跨池继承垫抽数；`char.ts` 填充 `freeBatches`（未出 6★ 的免费十连批次）。
- **字体与排版重构（`src/web/fonts/`、`styles/*`、`components/*`）**：
  - 内嵌 OFL-1.1 `Public Sans` Regular/Medium/Bold WOFF ASCII/数字子集（合计约 18 KB），还原数字字重层级，统一轻盈中文 UI 字重（400/500），消除桌面系统斜杠背景与强制暗色反转，主视口收敛至 `#ffffff / #f2f2f2 / #fcfcfc` 480px 工业卡片列；
  - 瘦身顶部 `Header`（移除后台工具栏与表单边框，收束为紧凑头像/昵称/渠道/UID/胶囊动作与 `26px` 总计条）；
  - 总览升级为 `限定 / 复刻 / 武器 / 庆典 / 基准` 5 张 `102px` 不可边框选中横滑卡，徽章改用 `十连双金 xN` 纯黑清晰文字；
  - 出货列表升级为 `限定池 / 复刻池 / 武器池 / 庆典池 / 常驻` 5 栏，默认单行紧凑（`32×32` 低饱和占位块 + `24px` 进度条 + 内联 `已垫N抽`/`超欧`/`歪` 印章），并按 `freeBatches` 展示灰标 `免费十连`；武器十连行修复 `.weapon-avatar-viewport` 为 `flex: 0 1 auto` 使 `第 N 个十连` 紧贴图标结尾。

### [W6-FIX] — 路线 B 空绑定跳过与离愁轩导入体验收口
- **路线 B 空绑定跳过（`src/core/auth/role.ts`、`src/core/route-b.ts`、`src/server/routes/sync.ts`、`src/web/components/SyncDialog.tsx`）**：
  - `role.ts` 导出 `RoleQueryError` 与 `isNoRole` 属性，单独区分 `query_role_list` 的 `status=101`（该渠道无角色）与真实接口错误。
  - `route-b.ts` 在换票前检查 `b.roles.length === 0`（及无回退的 `isNoRole`）并直接跳过、记录警告 `"该渠道下没有角色，已跳过"`（不消耗额外 `grantOAuth` / 不请求 `u8_token_by_uid`），不再产生失败项或让 `beg sync --passport` 误返退出码 `4`。
  - `server/routes/sync.ts` 与 `SyncDialog.tsx` 对无角色跳过项标为 `ok: true`、`maskedKey: "已跳过（无角色）"` 并按索引去重渲染 `key`。
- **离愁轩导入与历史 UP 补齐（`src/core/io/importer.ts`、`src/core/io/lcx.ts`、`src/core/data/lcx-catalog.ts`、`src/core/data/up-map.json`、`src/cli/commands/import.ts`、`src/server/routes/importexport.ts`）**：
  - `planImport` 新增 `allowTruncatedMs`（仅由离愁轩导入启用，保持 `v1` 严格指纹不变）：当官方精准毫秒记录与导出截断 `000` 毫秒记录在 `(itemId, rarity, isFree, kind)` 与整秒上完全一致时归入 `duplicates` / `truncatedMsDuplicates`（保留本地精确记录），`gift_*` 与 `lcx:unknown4` 等实质差异继续留在 `conflicts`；CLI 与 Server 同步给出毫秒截断判重提示。
  - 新增 `src/core/data/lcx-catalog.ts` 内置国服 1.0~1.7 卡池映射与角色/六星武器官方 ID 映射（卡池优先级 `--pool-map` > 本地同名池 > 内置映射，保留本地歧义报错；物品 ID 优先级本地库 > 内置映射 > `lcx:<name>`）。
  - 补全 `src/core/data/up-map.json` 中的 1.0~1.7 角色/武器限定池、联合池、复刻池与常驻武器箱 UP 六星清单，并新增 `tests/fixtures/io/lcx-real-shape.json` 与对应单元/集成测试。
