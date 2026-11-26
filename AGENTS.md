# Agent 协作硬规则

- 改动代码或回答架构问题前，**必须先通读 [docs/DEVELOPER.md](docs/DEVELOPER.md)**。
- 致命红线（不可违背）：
  1. 严禁把真实 token / UID / 抽卡记录 / 本机缓存写入仓库、日志、测试快照或终端输出（一律脱敏为 `<LEN, SHA256_PREFIX>`）。
  2. 路线 A 只读磁盘缓存：禁止内存注入、抓包、触碰 AntiCheatExpert；缓存文件必须带 `FILE_SHARE_*` 全共享只读打开，禁止写/删缓存。
  3. 国服（官服+B 服）请求 `ef-webview.hypergryph.com` 时 `server_id` 恒为 `"1"`；换票用外层 `bindingList[].uid`，绝不用 `roleId`；存储键必含渠道+角色维度。
  4. 测试必须使用临时目录与合成夹具，禁止读写宿主真实数据目录。
  5. `beg serve` 仅监听 `127.0.0.1`（禁止 `0.0.0.0`），校验 `X-BEG-Key` / `Host` / 同源 `Origin`，绝不返回 `Access-Control-Allow-*` CORS 头（详见 `DEVELOPER.md` §5）。
- 架构、模块坑位、测试命令见 `docs/DEVELOPER.md`，本文档不重复。
