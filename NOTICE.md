# 第三方项目致谢与许可声明（NOTICE）

本项目（**Better Endfield Gacha**）自身源码基于 [MIT License](LICENSE) 开源。

在设计与实现过程中，参考了以下社区开源项目的协议描述或设计思路，在此一并致谢并声明许可边界：

## MIT 许可项目（设计思路与社区口径参考）

为谨慎履行署名意识，保留以下 MIT 许可参考项目的致谢说明（相关逻辑均在本仓库独立编写实现）：

| 项目 | 许可证 | 参考部分 |
|---|---|---|
| [bhaoo/endfield-gacha](https://github.com/bhaoo/endfield-gacha) | MIT | 终末地角色/武器卡池小保底、大保底与跨池共享规则口径参考 |
| [MoguJunn/endfield-gacha](https://github.com/MoguJunn/endfield-gacha) | MIT | 离愁轩（`lcx_wiki_json`）救援导出格式、星级量表偏移及旧名称映射思路 |
| [funyhao0930/Zmd-Gacha](https://github.com/funyhao0930/Zmd-Gacha) | MIT | 游戏客户端抽卡链接缓存提取与接口参数参考 |
| [Scighost/Starward](https://github.com/Scighost/Starward) | MIT | 桌面端只读缓存读取与本地多账号数据管理设计思路 |
| [RoLingG/endfield-gacha-app](https://github.com/RoLingG/endfield-gacha-app) | MIT | 终末地抽卡统计分析与本地展示思路参考 |

## AGPL-3.0 项目（仅参考公开协议，严守隔离红线）

| 项目 | 许可证 | 边界说明 |
|---|---|---|
| `mon3tr-dev/endprotocol` | AGPL-3.0 | **仅用于查阅公开协议字段与接口行为描述；严禁且未拷贝任何代码片段至本仓库。** |

## 静态内嵌开源字体

| 字体 | 许可证 | 用途与裁剪说明 |
|---|---|---|
| [uswds/public-sans](https://github.com/uswds/public-sans) | SIL OFL-1.1 / GSA CC0-1.0 | 前端 ASCII 数字与指标排版子集（`src/web/fonts/PublicSans-*.woff`），仅用于本地 UI 字体渲染 |

## 游戏衍生美术资产版权声明

- **版权归属**：《明日方舟：终末地》（Arknights: Endfield）相关的游戏衍生美术资产——包括但不限于角色立绘与头像（`chars/`、`avatars/`）、武器与补给箱图标（`weapons/`、`boxes/`）、货币图标（`currency/`）、卡池横幅 Banner（`banners/`）等放置于 `src/web/public/media/` 及其构建产物 `dist-web/media/` 目录下的图标、角色立绘、横幅与头像素材——其版权及相关知识产权均归 **上海鹰角网络科技有限公司（Hypergryph）** 及其关联方所有。
- **许可边界**：**MIT 仅适用项目源码，游戏衍生美术资产版权归鹰角网络所有、不适用 MIT 许可**。
- **使用限制**：上述游戏衍生美术资产仅随本工具用于本地个人抽卡记录展示，严禁脱离本项目单独二次分发、用于商业用途或冒用官方名义；若权利方要求移除相关资产，项目将立即删除对应衍生美术文件并自动回退至纯色占位与首字徽标。
