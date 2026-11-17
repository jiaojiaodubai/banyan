# 贡献指南

本文说明 Banyan 插件仓库的开发环境、代码归属、验证流程和发布步骤。样式作者接口见
[样式开发教程](Style%20Develop%20Tutorial.MD)；本地集成协议见
[本地集成开发指南](Integration%20Develope%20Guidelines.MD)。项目层面的决策、修复、
提交信息与历史重写原则见[开发原则](DEVELOPMENT_PRINCIPLES.md)。

## 开发环境

- Node.js 22.13 以上的 22.x，或 Node.js 24 及以上版本，以及
  [pnpm](https://pnpm.io/)；CI 使用 Node.js 24。
- Zotero beta，用于本地开发和真实宿主验收。插件声明的运行时最低版本以
  `addon/manifest.json` 为准；旧版本不属于持续验证目标。
- Git，用于管理 Word 和 WPS 前端子模块。

首次准备工作区：

```shell
git clone https://github.com/jiaojiaodubai/Banyan.git
cd Banyan
pnpm install
git submodule update --init --recursive
pnpm integrations:build
```

本地运行前，将 `.env.example` 复制为 `.env`，并按本机环境设置
`ZOTERO_PLUGIN_ZOTERO_BIN_PATH` 和 `ZOTERO_PLUGIN_PROFILE_PATH`。

```shell
pnpm start
```

`integrations/` 中的前端源码由子模块提供；`addon/content/integration/` 是构建产物，
不得提交。

## 代码归属

| 路径                              | 职责                                                      |
| --------------------------------- | --------------------------------------------------------- |
| `src/modules/`                    | 插件功能模块；`sandbox/` 实现 Gecko 宿主适配              |
| `src/dialogs/`、`src/ui/`         | 对话框及可复用 UI                                         |
| `src/utils/`                      | 工具函数和已验证的宿主 API 兼容处理                       |
| `addon/content/`、`addon/locale/` | 界面资源与 Fluent 文案                                    |
| `typings/`                        | 插件共享类型、样式核心类型 re-export、Zotero API 补充声明 |
| `test/`                           | Zotero 进程内测试                                         |
| `tests-node/`                     | Node.js 测试                                              |
| `scripts/`                        | 代码生成器和开发工具                                      |

样式加载、参数解析、输出归一化和诊断由 `@banyan/core` 负责。插件的
`src/modules/sandbox/` 提供 Gecko 沙箱、宿主能力和 Zotero 条目转换。核心与插件之间的
宿主接口及其验证映射见[宿主义务与证据映射](HOST_OBLIGATIONS.md)。样式作者类型由核心
仓库维护；本仓库的 `typings/{item,style,styleUtils,unit}.d.ts` 仅 re-export 核心类型，
编辑器和 AI 工作区副本由 `pnpm gen:style-editor-dts` 生成。跨模块类型放在 `typings/`，
模块私有类型留在所属模块。

## 实现约定

文件与日志、类型与宿主 API、lint/typecheck 区域、生成文件与工具链约定见
[编码约定](CODING_CONVENTIONS.md)。环境配置、代码归属和发布流程仍见本文。

## Git 钩子

`pnpm install` 会通过 `prepare` 安装仓库的两个 Git 钩子；已有工作区可运行
`pnpm run prepare` 手动安装。钩子对人工和 Agent 的 Git 操作都生效：

- `pre-commit` 运行 `pnpm test:dev`，包括 lint、Node 测试和非监听的 Zotero 测试。
- `pre-push` 仅在推送 `v*` 版本标签时运行 `pnpm test:release`，重新构建、测试并校验生产 XPI。

检查失败会阻止提交或推送。钩子不会执行自动修复，也不会覆盖已有钩子；如已设置
`core.hooksPath` 或已有同名钩子，安装脚本会提示将 `.githooks/` 中的逻辑合并进去。
合并 `pre-push` 时需保留 Git 通过标准输入提供的引用列表。Git 的 `--no-verify` 可以
绕过本地钩子，因此 CI 仍独立执行检查，发布流程也必须通过生产测试。

钩子验证的是当前工作树，包括未暂存的修改；发布前应确认工作树和标签内容一致。
Zotero 测试需要配置 `.env` 或环境变量中的 `ZOTERO_PLUGIN_ZOTERO_BIN_PATH`，并避免
与其他 Zotero 实例或更新并发运行。

## 测试

| 测试层        | 命令                     | 适用范围                                 |
| ------------- | ------------------------ | ---------------------------------------- |
| Node.js       | `pnpm test:node`         | 解析、选择、校验、纯函数和样式 lint      |
| Zotero 进程内 | `pnpm test`              | Gecko 沙箱、宿主 API、窗口生命周期       |
| 提交前        | `pnpm test:dev`          | lint、Node 与非监听 Zotero 开发测试      |
| 发布前        | `pnpm test:release`      | 重新构建、生产 XPI 启动和发布凭据验证    |
| 真实 GUI      | 本地 `dev/` 手动验收记录 | 原生窗口、焦点、剪贴板、菜单、设置和迁移 |

测试应覆盖本次修改影响的行为。核心契约测试用于验证核心 API；插件运行时测试验证
Gecko 适配；真实 GUI 验收用于确认自动化测试无法证明的宿主交互。真实 GUI 的执行结果
记录在 issue、PR 或验收记录中，不写入测试规范。

修改字处理器前端时，应在对应子模块中开发和验证：

- Banyan for WPS：在其仓库运行 `npm ci` 和 `npm run build`。
- Banyan for Word VBA：按其仓库中的 `test/Run-Tests.ps1` 和
  `Import-BanyanDotm.ps1` 执行测试。

## 发布

发布流程为本地准备版本，CI 构建发布资产。完整配置见
[发布流程](Release%20Workflow.MD)。

```shell
pnpm release:prepare
```

检查工作区、变更日志和构建结果后，运行 `pnpm release` 选择版本并创建提交、标签和推送。
推送 `v*` 标签后，`.github/workflows/release.yml` 会根据锁定的子模块提交装配前端、
构建并测试真实 XPI，再发布该文件和更新清单。
