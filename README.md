# Better Endfield Gacha

> 《明日方舟：终末地》抽卡链接提取与抽卡记录管理工具。重点解决 **B 服**拿不到抽卡链接的痛点，同时兼容官服与国际服。数据只存本机。

> [!NOTE]
> 项目处于开发期（`0.1.0-dev`），当前提供命令行版本（支持路线 A 本地缓存提取与路线 B 鹰角通行证同步）；图形界面与导入导出功能仍在后续里程碑中。

---

## 核心特性

- **零绑定提取（路线 A · Windows PC 客户端）**：不需要绑定鹰角通行证、不输入任何账号密码、不改游戏、不抓包、不装证书。只要你在游戏里打开过一次「寻访记录」，工具就能从本机缓存里读到抽卡凭据，复制抽卡链接或直接拉取全部记录。游戏正在运行时也能读。
- **鹰角通行证同步（路线 B · 跨平台 / 不开游戏）**：支持通过通行证 token 或扫码校验绑定并同步全部可用角色，适合手机端玩家或不方便开游戏的场景。
- **全卡池拉取**：角色 5 类寻访池、武器各池全部覆盖，自动排除「寻访情报书」这类非抽卡赠品。
- **本地增量保存**：官方只保留近 90 天记录，本工具把记录存在本机数据库，之后每次只补新增的，旧记录不会丢。
- **官服 / B 服 / 多角色互不串号**：每个账号按渠道和角色分别存储。
- **隐私默认脱敏**：终端和日志里不会出现 token、UID、昵称（除非你显式要求）。

> 计划中：小黑盒风格的本地统计页面、与其他工具（如离愁轩）互导记录。

## 快速上手

需要 Node.js 22.13 或更新版本（推荐 24）。

```pwsh
pnpm install
# 1. 先在游戏里打开一次「寻访详情 → 寻访记录」
# 2. 看看能不能读到凭据（只显示指纹，不显示 token）
pnpm cli scan
# 3. 同步全部卡池到本机（数据默认在 ./data）
pnpm cli sync
# 4. 看统计 / 导出
pnpm cli stats
pnpm cli export --out backup.json
# 只想要抽卡链接：
pnpm cli link --copy
```

常用选项：`--channel 2` 只用 B 服凭据（`1` 为官服）、`--data-dir <目录>` 指定数据目录、`--show-ids` 明文显示账号信息。

## 路线 B：鹰角通行证同步

如果你不便启动 PC 客户端，或者在手机端游玩，可以通过鹰角通行证直接拉取记录（**不支持直接输入 B 站账号密码登录**）：

1. **B 服玩家必读**：请先在浏览器访问 [user.hypergryph.com](https://user.hypergryph.com/) 登录鹰角通行证，确认已在「账号绑定 / 角色绑定」中绑定你的 **B 服角色**。若通行证下没有 B 服绑定，同步时无法拉取 B 服数据。
2. **获取通行证 token**：登录后访问 `https://web-api.hypergryph.com/account/info/hg`（国际服请使用 `--provider gryphline`，登录 `user.gryphline.com` 后访问 `https://web-api.gryphline.com/cookie_store/account_token`），复制页面显示的整段 JSON 或其中的 `content` 字符串。
3. **登录校验与加密保存**（为了避免密码/token 留在终端历史记录，本工具禁止通过命令行参数明文传入 token，请通过剪贴板管道或环境变量传入）：
   ```pwsh
   # 从剪贴板读入并加密保存到数据目录（可省略 --save 仅作校验）
   Get-Clipboard | pnpm cli login --token-stdin --save
   # 或者尝试扫码登录（尚未在所有实机环境充分验证）：
   pnpm cli login --qr --save
   ```
4. **使用通行证同步**：
   ```pwsh
   # 使用已保存的会话同步全部可用绑定（可加 --channel 2 只同步 B 服）
   pnpm cli sync --passport
   # 不落盘一次性同步：
   Get-Clipboard | pnpm cli sync --passport --token-stdin
   ```
5. **保存位置、安全风险与清除方式**：
   - 执行 `--save` 后，通行证 token 会使用 Windows DPAPI（当前用户凭据）加密保存在数据目录下的 `vault.json`（默认 `./data/vault.json`）。
   - **安全提示**：DPAPI 的保护范围是**当前 Windows 用户**——也就是说，同一台电脑、同一 Windows 登录用户下运行的其他程序原则上也能请求系统解密该文件。不要在公用或不可信电脑上使用 `--save`。
   - 不再使用时，请运行 `pnpm cli logout` 删除本地 `vault.json`，并前往 [user.hypergryph.com](https://user.hypergryph.com/) 的登录设备管理页面手动退出对应会话。

## 注意事项

- 抽卡链接里的 `u8_token` 等同于你这个角色的查询凭据，**不要发给别人或公开**。
- 凭据只在你打开过寻访记录之后才会出现在缓存里；超过一天后是否仍然有效没有保证，失效时重新打开一次寻访记录即可。
- 如果官方以后更换游戏内置浏览器，工具会同时探测新的缓存位置，但新位置尚未在真实客户端上验证过。

## 文档导航

- **版本更新日志**：[CHANGELOG.md](CHANGELOG.md)
- **开发者文档**：[docs/DEVELOPER.md](docs/DEVELOPER.md)

## License

采用 [MIT](LICENSE) 开源许可。
