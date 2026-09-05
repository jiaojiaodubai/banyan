# 榕树 (Banyan)

简体中文 | [English](README.en-US.md)

[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

> 本项目由 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
> 创建，按模板要求保留上述徽标；代码沿用其 GNU AGPL 许可（见
> [许可](#许可)）。

## 目录

- [简介](#简介)
- [功能特性](#功能特性)
- [使用说明](#使用说明)
  - [安装插件](#安装插件)
  - [安装字处理器前端](#安装字处理器前端)
  - [写作工作流](#写作工作流)
  - [使用自己的样式](#使用自己的样式)
- [贡献指南](#贡献指南)
  - [环境要求](#环境要求)
  - [克隆与预配置](#克隆与预配置)
  - [开发](#开发)
  - [测试](#测试)
  - [发布](#发布)
- [许可](#许可)

## 简介

榕树（Banyan）是一个用于 [Zotero](https://www.zotero.org/) 的引用后端插件：
**用 JavaScript 完全自定义你的引用样式**，并以本地 HTTP 服务向外部客户端
提供引用能力。

> **为什么叫“榕树”？**
> 南方的榕树会从枝干上垂下气生根，落地后扎根成新的树干，最终独木成林。
> 我们希望你论文里引用的文献，也像气生根一样，从论证的枝干自然“长”出、
> 稳稳扎根于坚实可靠的大地——每一处论据都清晰指向它的出处，让整棵“论文
> 之树”枝繁叶茂、有据可依。

## 功能特性

- **样式即代码**：每个样式是一个 JavaScript 文件（实现 `Style` 接口），
  标题转换、人名缩写、ibid 判断、日期/多语言处理等都由你说了算。
- **开箱即用**：内置若干预设样式，可在设置面板一键导入/管理；
  也内置样式编辑器，改写后实时预览。
- **“后端”定位**：插件本身是引用后端，通过本地 HTTP（默认端口 `23119`）
  向外部客户端服务；**“字处理器”** 是它的前端，不限于某一家产品。
- 支持简体中文 / English 界面。

## 使用说明

### 安装插件

1. 从 [Releases](https://github.com/jiaojiaodubai/Banyan/releases) 下载最新
   `banyan-*.xpi`（`.xpi` 为正式版；`-beta` 为预览版）。
2. 在 Zotero 中打开 **工具 → 附加组件 → 齿轮图标 → Install Add-on From File…**，
   选择下载的 `.xpi` 并重启 Zotero。
3. 在 **Zotero 设置 → 榕树** 中管理样式与加载项。

### 安装字处理器前端

插件负责“算”，字处理器负责“写”。字处理器前端通过本地 HTTP 与本插件
（后端）通信；目前提供 Microsoft Word 与 WPS Office 两个实现，未来可扩展
到更多客户端：

| 前端       | 用途                                 | 仓库                                                                                      |
| ---------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Word (VBA) | 在 Word 中插入/刷新引注与参考文献    | [jiaojiaodubai/Banyan-for-Word-VBA](https://github.com/jiaojiaodubai/Banyan-for-Word-VBA) |
| WPS        | 在 WPS 文字中插入/刷新引注与参考文献 | [jiaojiaodubai/Banyan-for-WPS](https://github.com/jiaojiaodubai/Banyan-for-WPS)           |

建议在插件设置面板的 **加载项** 区一键安装/卸载（各前端与插件**绑定发布**，
会安装与当前插件匹配的版本）：

- **Word**：一键安装会把 `Banyan.dotm` 复制到 Word 的 STARTUP 目录；重启
  Word，如提示宏/内容安全警告请选择启用，然后在“开始 → Banyan”功能区使用。
  也可按该仓库 README 手动安装。
- **WPS**：一键安装到 WPS 加载项目录；重启 WPS 并在弹窗中同意启用即可。
- 使用前请保持 Zotero（后端）运行；首次使用可按提示授权信任对应客户端。

### 写作工作流

1. 在字处理器（如 Word/WPS）中把光标放到要插入引注的位置，点
   **插入引注**。
2. 选择样式与条目后自动插入；写作完成后用 **刷新** 更新编号，用
   **插入参考文献** 生成文献列表。
3. 转投期刊前用 **转换/定稿** 把 Banyan 域替换为普通文本（定稿会先备份）。

### 使用自己的样式

把写好的 `.js` 样式放到 Zotero 数据目录下的 `banyan/` 文件夹（或用插件内
样式编辑器创建），插件启动时会自动索引并在引用对话框中列出。样式开发文档见
[Style Develop Guidelines](docs/Style%20Develop%20Guidelines.MD) 与
[Style Develop Tutorial](docs/Style%20Develop%20Tutorial.MD)。

## 贡献指南

本仓库的插件骨架来自
[zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)；
开发/构建/发布流程由
[zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold)
驱动，Zotero API 类型来自 [zotero-types](https://github.com/windingwind/zotero-types)，
UI 封装来自
[zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit)。

### 环境要求

- Node.js ≥ 20 与 [pnpm](https://pnpm.io/)
- 一个可用的 [Zotero](https://www.zotero.org/download/)（本地开发调试，建议
  使用最新稳定版）
- Git（仓库使用 submodule 管理字处理器前端源码）

### 克隆与预配置

```powershell
git clone https://github.com/jiaojiaodubai/Banyan.git
cd Banyan
pnpm install                 # 安装本仓库依赖
git submodule update --init --recursive   # 或 pnpm submodules:init
pnpm integrations:build     # 从子模块装配 addon/content/integration 产物
```

`integrations/` 下是只读的构建输入（子模块）；`addon/content/integration/`
中的打包产物**不提交**，由 `integrations:build` 生成。

### 开发

```powershell
pnpm start        # 构建并启动 Zotero（zotero-plugin serve），改码即热重载
pnpm build        # 产物校验：构建 + tsc --noEmit
pnpm lint:fix     # prettier + eslint（含 styleEditor）自动修复
pnpm lint:check   # 校验格式与规则
```

代码约定与结构请参考 `AGENTS.md`（及 `.github/copilot-instructions.md`）：
小函数与纯函数优先、公共 API 放 `src/modules`、工具放 `src/utils`、跨模块
基础类型放 `typings/`。

### 测试

```powershell
pnpm test          # 在 Zotero 内运行的 mocha 单元测试（zotero-plugin test）
pnpm test:node     # 纯 Node 测试（样式 lint 规则，mocha + tsx）
```

修改字处理器前端时请到对应仓库开发并自测：

- Banyan-for-WPS：`npm install && npm run build`
- Banyan-for-Word-VBA：见其 `test/Run-Tests.ps1` / `Import-BanyanDotm.ps1`

### 发布

发布采用“**本地推进 → CI 出资产**”的两段式（详见
[Release Workflow](docs/Release%20Workflow.MD)）：

```powershell
pnpm release:prepare   # 更新依赖/子模块 → 装配前端产物 → 构建 → 刷新 CHANGELOG
# 人工 review git status / CHANGELOG.md 后：
pnpm release           # 选择版本号：自动提交+打 tag+推送
```

推送 `v**` tag 后，CI（`.github/workflows/release.yml`）会自动从锁定的子模块
commit 装配字处理器前端、构建，并把 XPI 与 update 清单发布到 GitHub Release。

## 许可

本项目由
[zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
派生，按其要求继承 GNU AGPL 许可；本仓库代码以
[AGPL-3.0-or-later](LICENSE) 授权，不附带任何担保。
