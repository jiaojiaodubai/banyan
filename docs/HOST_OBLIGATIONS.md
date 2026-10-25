# 宿主义务与验证映射

核心定义跨宿主的样式运行时契约；Banyan 插件负责在 Zotero/Gecko 中实现该契约。本文件
记录两者的职责边界、插件实现位置和验证入口。核心契约以工具链中 `@banyan/core` 的
[宿主集成契约](https://github.com/jiaojiaodubai/banyan-toolchain/blob/main/packages/core/dev/hostIntegration.md)
为准；真实 GUI 验收步骤见 [`test-gui/README.md`](../test-gui/README.md)。

## 职责边界

| 核心 `@banyan/core`                        | Zotero 插件                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 加载样式、转译 helper、提取导出并校验契约  | 创建和销毁 Gecko 沙箱，限定可见全局对象                                                          |
| 管理参数、上下文视图、样式工具和 `console` | 从 Zotero 获取条目，并准备核心所需的数据形状                                                     |
| 校验输入、归一化输出                       | 实现 `parseHtml`、`readFile`、`resolveMultilingualItems` 三项必需能力，以及可选的 `resolveStyle` |
| 生成 `StyleMessage`、诊断和错误代码        | 将诊断路由至日志、编辑器反馈或用户对话框                                                         |
| 定义作者 API 和 schema                     | 提供 UI、请求调度和文档锁                                                                        |

## 核心义务映射

核心契约以 “Checklist for a new host” 定义的 C1–C6 为准。以下映射列出插件责任及主要
验证入口；测试只有在断言覆盖相应行为时，才能作为该义务的证据。

| 核心义务                              | 插件实现                                                | 验证入口                                                          |
| ------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| C1：隔离策略                          | `src/modules/sandbox/runtime.ts`                        | `test/sandboxHost.test.ts`：全局对象与网络隔离                    |
| C2：runtime 与上下文原语              | `runtime.ts`、核心 `SandboxContext` 十个方法            | 核心 `coreContract.test.ts`；插件测试：只读视图、二进制桥接、超时 |
| C3：三项必需能力与可选 `resolveStyle` | `src/modules/sandbox/capabilities.ts`                   | 核心能力契约测试；插件测试；GUI HOST-01/01M                       |
| C4：条目形状                          | `src/modules/sandbox/items.ts` 的 `toBanyanItem()`      | 核心 host-owned item 测试及 `isBanyanItem` 测试                   |
| C5：诊断与错误路由                    | `src/modules/sandbox/index.ts`、`faults.ts`、日志       | 插件诊断和超时测试；GUI HOST-02                                   |
| C6：`assertReady`                     | `zoteroStyleHost.assertReady`、`assertHostCapabilities` | 核心 readiness 测试；GUI 启动装配冒烟测试                         |

工具链中 `@banyan/core` 的测试：
[`coreContract.test.ts`](https://github.com/jiaojiaodubai/banyan-toolchain/blob/main/packages/core/dev/node-host/coreContract.test.ts)。

## 沙箱实现

`src/modules/sandbox/runtime.ts` 中的 `geckoSandboxRuntime.createContext()` 负责创建
Gecko 隔离环境：

- 使用 `Cu.Sandbox` 和 null principal，并设置 `wantComponents: false`。
- 将 `Zotero`、`Components`、`Services`、`IOUtils` 和 `PathUtils` 设为不可用。
- 将 `fetch`、`XMLHttpRequest` 和 `WebSocket` 替换为拒绝访问的实现。
- 通过 `waiveXrays` 与 `cloneInto` 桥接数据；通过
  `Services.tm.dispatchToMainThread` 调度宿主任务。
- Gecko 的同步 `evaluate` 不支持可靠的超时中断；异步 `generate()` 超时由核心运行时处理。

## 宿主能力

| 能力                       | Zotero 实现                                                                                  | 失败行为                                     |
| -------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `parseHtml`                | 使用 `DOMParser`；片段包装在固定标识容器中后提取根节点                                       | 缺少 parser 或根节点时报告 `host-capability` |
| `readFile`                 | 以 `PathUtils.normalize` 规范路径，并限制在 `DataDirectory/banyan`；通过 `IOUtils.read` 读取 | 越界或非法路径时抛出普通 `Error`             |
| `resolveMultilingualItems` | 按 `z:uri` 解析，必要时回退到数字 itemID；读取合并后的存活条目并过滤已删除项                 | 非 Banyan 条目时抛出 `TypeError`             |
| `resolveStyle`（可选）     | 按 `INFO.id` 查样式索引，用 `IOUtils.readUTF8` 读出该样式文件，并把 `readFile` 原样交回      | id 未安装时返回 `null`，核心报 `unresolved`  |

样式以平铺文件存放在 `DataDirectory/banyan`，因此委派样式的“自有目录”与调用方是同一个
目录：`resolveStyle` 返回的 `readFile` 就是调用方使用的那个实现，不按样式再派生一套路径
规则。读取失败会抛出，由核心转成带原因的 `unresolved`；只有“索引里没有这个 id”才返回
`null`。

传入能力实现的参数必须先转换为宿主 realm 数据。跨 realm 的异步 utility bridge 由核心
处理；样式脚本不应通过对象展开复制条目。

## 条目准备

`src/modules/sandbox/items.ts` 的 `toBanyanItem()` 将 Zotero 条目转换为 Banyan 条目：

- `id` 为字符串，即 `String(zoteroItem.id)`。
- `z:uri` 是 Zotero 宿主私有扩展字段；核心只依赖公开的 `id`。
- 转换顺序为 `toJSON`、`stripExcludedFields`、`assignBaseFieldAliases`、
  `parseExtraMap` 和 `bindCreatorsExt`。
- `syncContextsWithLiveItems` 在调用 `generate()` 前刷新引用上下文。
- `getItemWithMergeFallback` 按 Zotero 的 URI 合并查找规则解析已合并条目。

## 诊断与请求调度

- `logStyleMessage` 将 trace/info 写入调试输出；warn/error 同时写入调试输出和错误控制台。
  每条样式消息带有 `[style=<INFO.id> / <INFO.title>]` 前缀，便于定位批量加载问题。
- 仅 `generate-output`（`sourcePath === "generate()"`）会显示一次用户错误对话框。
- `refresh` 的样式错误返回 HTTP 400 和 `invalid_params`；其他未处理错误返回 HTTP 500 和
  `internal_error`。
- 每个样式实例串行运行 `generate()`；refresh 另外使用 document/style 锁。

## 真实宿主验收

Node 测试不能覆盖真实 Gecko、原生窗口及 Zotero 数据库行为。发布候选至少应在目标
Zotero beta 上完成以下检查，并在 PR、issue 或验收记录中记录版本、步骤和结果。

| 检查         | 操作                                                                                        | 预期结果                                                              |
| ------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 沙箱隔离     | 从样式读取 `Zotero`、`Components`、`IOUtils` 并调用 `fetch`                                 | 宿主全局不可用；网络调用拒绝执行                                      |
| 只读上下文   | 修改或删除 `contexts[0].id`，读取缺失属性                                                   | strict 模式下写入抛错；缺失属性读取为 `""`                            |
| 工具不可替换 | 覆盖 `readText`、`htmlToUnit` 或 `console`                                                  | 核心安装的实现保持有效                                                |
| 参数校验     | 在设置或引注面板输入无效值                                                                  | 校验信息写入对应参数状态；面板保持可用                                |
| 列表默认值   | 保留含 validator 的空白 list 行                                                             | 来源标记为 `fieldValidation[field][row].source === "default"`         |
| 能力失败     | 移除 `parseHtml` 或模拟无 `DOMParser`                                                       | 报告 `host-capability`，不静默输出原始标签                            |
| 文件边界     | 从样式调用 `readText("../outside")`                                                         | 拒绝路径，不读取 banyan 目录之外的文件                                |
| 异步超时     | 令 `generate()` 返回永不 settle 的 Promise                                                  | 产生 `generate-timeout`，释放队列并重建实例                           |
| 诊断显示     | 调用 console 各级方法并声明重复 id 或非法参数                                               | 日志与编辑器反馈符合分级规则；trace 不进入 diagnostics                |
| 多语言刷新   | 执行 MT-08/MT-09 的合并及过期 URI 场景                                                      | 返回存活关联条目；重复条目合并；不可解析关系有提示                    |
| 样式委派     | 安装两个 `INFO.citationType` 相同的样式，其中一个声明 `STYLE_DEPENDENCIES` 并 `callStyle()` | 返回被调样式的输出；未安装时走回退并产生 `delegation.unresolved` 警告 |

HOST-01/01M、HOST-02 以及其他 GUI 用例的完整夹具和步骤见
[`test-gui/README.md`](../test-gui/README.md)。
