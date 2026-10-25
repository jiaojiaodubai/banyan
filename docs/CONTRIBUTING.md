# 贡献指南

本文说明 Banyan 插件仓库的开发环境、代码归属、验证流程和发布步骤。样式作者接口见
[样式开发教程](Style%20Develop%20Tutorial.MD)；本地集成协议见
[本地集成开发指南](Integration%20Develope%20Guidelines.MD)。

## 开发环境

- Node.js 20 或更高版本及 [pnpm](https://pnpm.io/)。
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
| `test-gui/`                       | 真实 Zotero 界面验收规范、夹具和工具                      |
| `scripts/`                        | 代码生成器和开发工具                                      |

样式加载、参数解析、输出归一化和诊断由 `@banyan/core` 负责。插件的
`src/modules/sandbox/` 提供 Gecko 沙箱、宿主能力和 Zotero 条目转换。核心与插件之间的
宿主接口及其验证映射见[宿主义务与证据映射](HOST_OBLIGATIONS.md)。样式作者类型由核心
仓库维护；本仓库的 `typings/{item,style,styleUtils,unit}.d.ts` 仅 re-export 核心类型，
编辑器和 AI 工作区副本由 `pnpm gen:style-editor-dts` 生成。跨模块类型放在 `typings/`，
模块私有类型留在所属模块。

## 实现约定

- 文件 I/O 使用 `IOUtils`，路径处理使用 `PathUtils`。
- 日志通过 `src/utils/logger` 的 `createLogger()` 输出；禁止直接调用 `console.log`、
  `console.error` 或 `ztoolkit.log`。记录错误时将 `Error` 作为第二个参数传入。
- 使用 Zotero/Gecko API 前，先查 `zotero-types`；类型或行为不完整时，再核对
  `dev/Zotero-Source`，并在 `typings/` 中补充声明，不用局部断言掩盖类型缺口。
- `src/utils/compat/` 只处理已由源码确认的最新稳定版与 beta 之间的 API 差异。
- 比较 Zotero API 时，使用 Git 对象检查稳定版 tag 与 `origin/main`；忽略
  `dev/Zotero-Source` 工作树中的改动。

仓库使用三个 lint/类型检查区域：

| 区域       | 配置或项目                                       | 命令                                                   |
| ---------- | ------------------------------------------------ | ------------------------------------------------------ |
| 插件主代码 | `eslint.config.mjs`                              | `pnpm lint:main`、`pnpm lint:fix:main`                 |
| 样式编辑器 | `addon/content/styleEditor/eslint.config.mjs`    | `pnpm lint:style-editor`、`pnpm lint:fix:style-editor` |
| 测试项目   | `test/tsconfig.json`、`tests-node/tsconfig.json` | `pnpm typecheck:tests`                                 |

样式作者的 lint 规则与 `@banyan/core` 都由同一个已发布的工具链修订提供，修订号和
产物哈希记录在 `toolchain.lock.json`；依赖安装的是该修订的发布 tarball。
`addon/content/styleEditor/eslint-plugin-banyan-style.mjs` 与
`eslint-plugin-banyan-style.build.json` 是从工具链生成的副本。要改规则或核心，去
`Banyan-Toolchain` 修改并发布新修订，更新依赖与 lock 后运行 `pnpm gen:style-lint`。
`pnpm lint:check` 会运行 `pnpm check:style-lint` 检查副本是否漂移。

完成代码修改后运行 `pnpm lint:fix`，再运行 `pnpm lint:check`。构建和类型检查使用
`pnpm build`。

## 测试

| 测试层        | 命令                                                  | 适用范围                                 |
| ------------- | ----------------------------------------------------- | ---------------------------------------- |
| Node.js       | `pnpm test:node`                                      | 解析、选择、校验、纯函数和样式 lint      |
| Zotero 进程内 | `pnpm test`                                           | Gecko 沙箱、宿主 API、窗口生命周期       |
| 真实 GUI      | 按 [`test-gui/README.md`](../test-gui/README.md) 执行 | 原生窗口、焦点、剪贴板、菜单、设置和迁移 |

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
构建 XPI 并发布更新清单。
