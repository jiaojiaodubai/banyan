# 榕树 (Banyan)

简体中文 | [English](README.en-US.md)

[![CI](https://github.com/jiaojiaodubai/Banyan/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jiaojiaodubai/Banyan/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/jiaojiaodubai/Banyan?include_prereleases&style=flat-square&label=release)](https://github.com/jiaojiaodubai/Banyan/releases)
[![License](https://img.shields.io/github/license/jiaojiaodubai/Banyan?style=flat-square)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/jiaojiaodubai/Banyan/total?style=flat-square)](https://github.com/jiaojiaodubai/Banyan/releases)
[![Zotero](https://img.shields.io/badge/Zotero-8%E2%80%9310-CC2936?style=flat-square&logo=zotero&logoColor=white)](https://www.zotero.org/)
[![Front ends](https://img.shields.io/badge/front--end-Word%20%7C%20WPS-2B579A?style=flat-square)](#安装字处理器前端)
[![Stars](https://img.shields.io/github/stars/jiaojiaodubai/Banyan?style=flat-square&logo=github)](https://github.com/jiaojiaodubai/Banyan/stargazers)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](#贡献指南)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

## 目录

- [简介](#简介)
- [功能特性](#功能特性)
- [使用说明](#使用说明)
  - [安装插件](#安装插件)
  - [安装字处理器前端](#安装字处理器前端)
  - [写作工作流](#写作工作流)
  - [编写与安装样式](#编写与安装样式)
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

## 使用说明

### 安装插件

1. 从 [Releases](https://github.com/jiaojiaodubai/Banyan/releases) 下载最新
   `banyan-*.xpi`（`.xpi` 为正式版；`-beta` 为预览版）。
2. 在 Zotero 中打开 **工具 → 附加组件 → 齿轮图标 → Install Add-on From File…**，
   选择下载的 `.xpi` 并重启 Zotero。
3. 在 **Zotero 设置 → 榕树** 中管理样式与加载项。

### 安装字处理器前端

插件负责“算”，字处理器负责“写”，两者通过本地 HTTP 通信。目前有两个前端实现，
未来可扩展到更多客户端：

| 前端                                                                    | 宿主程序             | 支持平台              | 主要功能                                                                                           |
| ----------------------------------------------------------------------- | -------------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| [Banyan for Word](https://github.com/jiaojiaodubai/Banyan-for-Word-VBA) | Microsoft Word 2016+ | Windows、macOS        | 插入/编辑引注、插入分隔符、插入/编辑书目、刷新、转换 Zotero 域、定稿、设置                         |
| [Banyan for WPS](https://github.com/jiaojiaodubai/Banyan-for-WPS)       | WPS 文字 2019+       | Windows、macOS、Linux | 插入/编辑引注、插入分隔符、插入/编辑书目、打开引注窗格、刷新、转换 Zotero 域、定稿、设置、暗色主题 |

各前端与插件**绑定发布**，因此请在 **Zotero 设置 → 榕树 → 加载项** 中一键安装或卸载：

- **安装/卸载前请先退出宿主程序**（Word 或 WPS），完成后重新启动它即可生效。
- **使用时**请保持 Zotero 运行，并确认 Banyan 插件已启用。
- **首次使用**宿主程序会请求授权（Word 可能还需启用宏/内容，macOS 上需信任本地
  HTTPS 证书），按提示同意即可。

### 写作工作流

1. 在字处理器（如 Word/WPS）中把光标放到要插入引注的位置，点
   **插入引注**。
2. 选择样式与条目后自动插入；写作完成后用 **刷新** 更新编号，用
   **插入参考文献** 生成文献列表。
3. 转投期刊前用 **转换/定稿** 把 Banyan 域替换为普通文本（定稿会先备份）。

### 编写与安装样式

Banyan 的样式是一个实现固定接口的 JavaScript 文件（接口说明与编写教程见
[Style Develop Tutorial](docs/Style%20Develop%20Tutorial.MD)）。**编写**与
**安装**是两个步骤：先按下面的方式写出样式文件，再照
[如何安装样式](#如何安装样式) 交给插件。针对不同背景的用户，我们设计了两种
编写方式：

**方式一：动手编写** —— 面向有 JavaScript 基础的用户。

1. 推荐使用插件内置编辑器：在 Zotero 菜单 **工具 → Banyan 样式编辑器** 打开。
   它是完整的编码环境，提供**类型提示、预设模板与代码片段、代码检查与格式化、
   输出预览**。点“保存”后样式即被插件索引，**无需再手动安装**。
2. 也可以使用你习惯的编辑器：编写 `.js` 文件（仓库
   `docs/AI Style Workplace/typings` 中的类型声明可供补全与检查）。

**方式二：AI 辅助编写** —— 面向无编程基础的用户。

1. 下载本仓库的
   [`docs/AI Style Workplace`](docs/AI%20Style%20Workplace/Style%20AI%20Authoring%20Guidelines.MD)
   目录（内含类型声明与面向 AI Agent 的编写规范）。
   > 不知道如何下载？
   >
   > - **整仓下载（最简单）**：打开仓库首页
   >   [github.com/jiaojiaodubai/Banyan](https://github.com/jiaojiaodubai/Banyan)，点击绿色
   >   **Code** 按钮 → **Download ZIP**，下载整个仓库的压缩包并解压；进入其中的
   >   `docs/AI Style Workplace/` 文件夹即为所需内容，其余文件可忽略。
   > - **只下载该文件夹**：进入仓库的
   >   [`docs/AI Style Workplace`](https://github.com/jiaojiaodubai/Banyan/tree/main/docs/AI%20Style%20Workplace)
   >   目录页后，复制浏览器地址栏的网址，粘贴到
   >   [DownGit](https://minhaskamal.github.io/DownGit) 一类的“目录打包下载”网站，
   >   即可单独下载这个文件夹。
2. 将该目录设为 AI Agent（如 Claude Code、Codex、GitHub Copilot 等）的工作目录，
   并把手头的格式要求一并准备好：
   - 收稿方（期刊、学校等）通常会以**在线网页**，或 **`.pdf`、`.docx` 等办公文档**
     的形式给出引注与参考文献格式要求。
   - 若格式要求以**网页**形式提供，直接把网页链接发给 Agent 即可；
     若以 **`.pdf`/`.docx` 等文档**形式提供，则把文件放进上述工作目录，并在对话中
     告诉 Agent 文件所在位置，Agent 会结合文档与目录内的规范一起生成样式。
3. 向 Agent 描述你的格式要求（引注/参考文献样式、期刊或学校规范等），Agent
   会结合目录内的类型与规范生成 `.js` 样式。

#### 如何安装样式

以下三种方式任选其一；安装好的样式会被插件索引，并出现在“选择样式”对话框中：

- **内置编辑器保存（无需手动安装）**：在样式编辑器里点“保存”，文件会直接写入
  插件样式目录并立即可用。
- **样式管理器导入**：**Zotero 设置 → 榕树 → 样式管理器 → 导入样式**，选择
  `.js` 文件；“选择样式”对话框里的 **导入** 按钮作用相同。样式 ID 重复时会
  提示覆盖。
- **手动复制文件**：把 `.js` 复制到 Zotero 数据目录下的 `banyan/` 文件夹
  （定位方式：**Zotero 设置 → 高级 → 文件与文件夹 → 显示数据目录**；其中的
  `banyan/` 即插件样式目录，插件首次运行后自动创建）。样式以文件内的
  `INFO.id` 索引，文件名不影响识别。

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
