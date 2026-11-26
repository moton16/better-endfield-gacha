# 第三方开源组件清单（THIRD_PARTY）

本清单由 `pnpm licenses list --prod --json` 自动核对生成，并随便携打包产物一并发布。

## 1. 应用运行时 npm 依赖

核心解析、本地数据库、本地服务与命令行模块均基于 Node.js 内置能力实现，**零第三方 npm 运行时依赖**；仅前端图形界面使用了以下构建入静态资源包的运行时依赖：

| 包名 | 版本 | 许可证 | 说明 | 主页 |
|---|---|---|---|---|
| `preact` | `10.29.8` | MIT | Fast 3kb React-compatible Virtual DOM library. | https://preactjs.com |

## 2. Windows 便携版随包运行环境

Windows 便携压缩包额外内置官方原版 Node.js 运行时：

| 组件 | 版本 | 许可证 | 来源与校验 |
|---|---|---|---|
| Node.js (`node/node.exe`) | `v24.15.0` (win-x64) | MIT（含其内置 V8 / libuv / OpenSSL / SQLite 等组件各自开源许可） | 下载自 `https://nodejs.org/dist/v24.15.0/`，打包前经官方 `SHASUMS256.txt` SHA256 强制校验 |

## 3. 前端静态构建内嵌字体资源

| 资源 | 许可证 | 说明 | 来源 |
|---|---|---|---|
| `Public Sans` (ASCII/数字裁剪 WOFF 子集) | SIL OFL-1.1 | `src/web/fonts/PublicSans-{Regular,Medium,Bold}.woff`，仅包含基础拉丁与数字标点字形 | https://github.com/uswds/public-sans |
