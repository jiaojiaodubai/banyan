# GUI 宿主与插件验收

本目录定义 Banyan 的 GUI 验收范围、可复用夹具、操作步骤和预期结果。用例以 Zotero
界面及其可观察行为为依据，可由人工操作或 computer-use 工具执行，不依赖特定工具。项目
推荐使用 [mcp-server-zotero-dev](https://github.com/introfini/mcp-server-zotero-dev) 作为 MCP bridge 进行半自动化操作；它是可选接口，未配置时
仍可按本文步骤完成验收。

本文不记录某次运行的结论；执行结果应保存在验收记录、issue 或 PR 中，仓库文档只保留
可重复执行的约束。

## 目录

| 路径                   | 内容                           |
| ---------------------- | ------------------------------ |
| `README.md`            | 验收范围、环境、用例与操作约定 |
| `fixtures.json`        | 集合与条目定义                 |
| `fixtures.schema.json` | `fixtures.json` 的 JSON Schema |
| `harness/`             | Local API 夹具注入工具与说明   |
| `styles/`              | 验收样式与说明                 |
| `.state/`              | 本地运行状态（已忽略，不提交） |

## 核心契约与在线资料

核心契约以工具链中 `@banyan/core` 为准：

- [宿主集成契约](https://github.com/jiaojiaodubai/banyan-toolchain/blob/main/packages/core/dev/hostIntegration.md)：
  宿主职责、`SandboxRuntime` / `SandboxContext`、能力失败模式、条目准备、跨 realm 取值和调度；
- [核心 README](https://github.com/jiaojiaodubai/banyan-toolchain/blob/main/packages/core/README.md)：包结构、公开入口和失败码；
- [host 类型源文件](https://github.com/jiaojiaodubai/banyan-toolchain/blob/main/packages/core/src/host.ts)：
  发布包的 `dist/host.d.ts` 由它生成；
- [核心契约测试](https://github.com/jiaojiaodubai/banyan-toolchain/blob/main/packages/core/dev/node-host/coreContract.test.ts)：
  核心与 Node 宿主之间的契约断言。

插件侧的宿主实现落点和验证入口见
[宿主义务与证据映射](../docs/HOST_OBLIGATIONS.md)。

## 1. 范围与分层

本目录只验收自动化测试无法证明的真实宿主与 UI 行为：

- 真实 Gecko 宿主装配、原生窗口、焦点、剪贴板、文件选择器和错误对话框；
- Zotero 菜单、设置、条目面板、列、样式索引和条目类型迁移；
- 依赖真实文库状态的上下文刷新、合并回退和不可访问条目。

不在本目录重复核心内部逻辑、纯函数或已有 Node 覆盖的行为。各层的分工：

| 层         | 位置                                                                                                                                                              | 负责                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 核心契约   | 工具链中 `@banyan/core` 的 [`coreContract.test.ts`](https://github.com/jiaojiaodubai/banyan-toolchain/blob/main/packages/core/dev/node-host/coreContract.test.ts) | 核心 API、参数解析、输出归一化、跨 realm 值桥接                  |
| 纯 Node    | `tests-node/`                                                                                                                                                     | 解析、选择、校验、纯函数、样式 lint                              |
| 插件运行时 | `test/sandboxHost.test.ts`                                                                                                                                        | Gecko 沙箱、隔离、能力、超时、诊断、二进制桥接                   |
| 真实 GUI   | `test-gui/`                                                                                                                                                       | 宿主装配、原生交互、菜单/设置/迁移、真实文库上下文和窗口生命周期 |

核心 checklist 的 6 条义务（C1–C6）与插件落点、验证入口的对应关系见
[宿主义务与证据映射](../docs/HOST_OBLIGATIONS.md)。本目录的 HOST-xx 用例负责其中必须在
真实宿主确认的部分；自动化层的覆盖不能替代这里的实际观察。

## 2. 插件验收范围

- **引注窗口**：Citation / cite 参数与富文本；确认前阻止非法值；取消不写回。
- **样式选择**：搜索、选择、取消/确认、全局选项、无选项样式不显示空区块。
- **样式编辑器**：运行/预览/信息视图、诊断与日志、样式选项、保存后索引刷新。
- **参考文献与创建输出**：未引用条目、手动编辑行、引注/参考文献表各种输出组合。
- **设置与样式管理**：设置持久化、样式删除后的回退、条目列表额外字段列。
- **条目菜单与窗口**：快捷标记、写入字段、字段检查、扩展创建者、多语言条目。
- **侧栏与列**：多语关联、引注列/引用条目行、额外字段列。
- **集成与迁移**：HTTP 入口、错误反馈、XHTML 窗口解析。

## 3. 环境、入口与夹具

### 3.1 启动

1. 按 [贡献指南](../docs/CONTRIBUTING.md) 准备 `.env`，在仓库根目录运行 `pnpm start`。
2. 等待 Zotero 主窗口出现，并确认插件 Local API 在 `127.0.0.1:23124` 应答，或使用配置档中的实际端口。
   若选用本仓库配置的 MCP 操作接口，再确认 `127.0.0.1:6100` 可用；此项不是 GUI 验收前置条件。
3. 开发版启动后会打开 **Banyan Debug** 窗口，提供三个入口：
   - **Open style dialog**：样式选择；
   - **Open citation dialog**：引注窗口；
   - **Open bibliography dialog**：参考文献窗口。

关闭该窗口后，重启 Zotero 可重新打开。

### 3.2 操作入口

| 目标       | Zotero 界面入口                                               | 可选自动化入口                                                |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| 样式选择   | Banyan Debug → Open style dialog                              | MCP 定位按钮；或 POST `/banyan/style`；其他工具可使用相同界面 |
| 引注窗口   | Banyan Debug → Open citation dialog；或 Word/WPS 的“插入引注” | MCP；或 POST `/banyan/citation`；其他工具可使用相同界面       |
| 参考文献   | Banyan Debug → Open bibliography dialog                       | MCP；或 POST `/banyan/bibliography`；其他工具可使用相同界面   |
| 样式编辑器 | 工具 → Banyan 样式编辑器                                      | 通过界面菜单打开并操作                                        |
| 条目菜单   | 条目右键 → 榕树 → …                                           | 通过界面打开上下文菜单并选择命令                              |
| 设置       | 编辑 → 设置 → 榕树                                            | 通过界面操作；需要时也可检查 `extensions.zotero.banyan.*`     |
| 调试输出   | 帮助 → 调试输出日志 → 启用/查看                               | `Zotero.Debug.get()`、日志接口或所用工具提供的控制台          |

MCP 的窗口列表不包含原生 `alert`、`Services.prompt` 和文件选择器。使用 MCP 或其他
computer-use 工具时，应确认该工具能够操作原生窗口；不支持时，可由操作者在屏幕上完成该步，
再继续后续操作。验收步骤和预期结果不因操作工具而改变。

### 3.3 夹具集合

夹具定义在 `fixtures.json`。条目用 `citationKey` 识别；Zotero 的 item key 由当前文库
生成，不要写死。注入工具在 `.state/fixtures.local.json` 中记录 `citationKey` → item key。

| 集合       | 用途                                 |
| ---------- | ------------------------------------ |
| `BNYMANUL` | 顶层集合，所有夹具条目也直接放在这里 |
| `BNYPARAM` | 参数与样式选项                       |
| `BNYCITAT` | 引注与参考文献输出                   |
| `BNYITEMS` | 条目对话框与快捷标记                 |
| `BNYMAIN2` | 主窗口、侧栏、列与多语               |
| `BNYMERGE` | 合并/过期 URI 回退                   |
| `BNYMIGR2` | 条目类型迁移                         |

| 条目                   | 用途                                                      |
| ---------------------- | --------------------------------------------------------- |
| `MT-01-BOOK-ZH`        | 中文图书；引注参数、输出、列、写入字段                    |
| `MT-02-BOOK-EN`        | 英文图书；与 MT-01 组成多条目引注                         |
| `MT-03-ARTICLE`        | 期刊文章；参考文献输出                                    |
| `MT-04-CHAPTER`        | 图书章节；未引用条目                                      |
| `MT-05-REGULATION`     | 法规；条目对话框                                          |
| `MT-06-MERGED-OLD`     | 被 MT-07 替换的旧条目；合并基础用例                       |
| `MT-07-MERGED-NEW`     | 合并后的存活条目；`dc:replaces` MT-06                     |
| `MT-08-MLING-ZH`       | 中文多语条目；与 MT-09 互为 `banyan:multilingual`         |
| `MT-09-MLING-EN`       | 英文多语条目                                              |
| `MT-10-MERGE-SOURCE`   | 合并源；MT-12 通过 `dc:replaces` 替换它，MT-11 是多语伙伴 |
| `MT-11-MERGE-LANG`     | MT-10/MT-12 的英文多语伙伴                                |
| `MT-12-MERGE-SURVIVOR` | 合并存活条目；`dc:replaces` MT-10，多语关联 MT-11         |
| `MT-13-MIGR-BOOK`      | 迁移源；`book`，多语关联 MT-14                            |
| `MT-14-MIGR-BOOK`      | 迁移伙伴；`book`                                          |

`MT-13`/`MT-14` 在迁移用例中会被改成 `bookSection`；字段和关系必须在使用后恢复。

### 3.4 注入与校验

```powershell
# 启动 Zotero beta 后，在仓库根目录执行
pnpm exec tsx test-gui/harness/fixtures.ts

# 只校验当前库是否与 fixtures.json 一致
pnpm exec tsx test-gui/harness/fixtures.ts --check
```

注入只做 upsert，不删除已有集合或条目。详细行为、授权和故障排查见
[`harness/README.md`](harness/README.md)。

### 3.5 样式夹具

把需要的 `styles/*.js` 复制到 `<Zotero 数据目录>/banyan/`，重启 Zotero，让样式索引载入。
只在样式编辑器里预览时，可以用 **文件 → 载入样式** 直接打开文件。

数据目录可在 **编辑 → 设置 → 高级 → 文件和文件夹** 查看。样式清单、`INFO.id` 和用途见
[`styles/README.md`](styles/README.md)。

### 3.6 数据卫生与还原

- 在专用测试配置或测试文库中执行；不要对生产库运行注入或破坏性用例。
- 修改条目、关系、条目类型或设置前，先记录受影响对象的 `toJSON()`、`getRelations()`、
  `deleted`、`getCollections()`，以及 `extensions.zotero.banyan.lastUsedStyleId`、
  `itemMenuStyleId`、`extraValueColumnKey`、`citationDialogInitialCollectionMode`。
  用例结束时按记录恢复，并在恢复后核对字段和关系。
- 夹具只 upsert，不删除；不要依赖上一个用例留下的选中项、打开窗口或临时文件。
- 写字段、合并、删除样式、迁移条目类型等操作必须在用例末尾恢复；不要删除随插件发布的
  样式或预设。
- 每个用例结束后关闭自己打开的窗口、对话框和原生菜单，确认 Zotero 只剩主窗口；可通过
  界面或所用工具的窗口列表检查。删除输出文件、导入的条目和临时复制进 `banyan/` 的样式。
- 用例失败时先区分核心契约（多语、能力、context）和插件 UI：前者补工具链中 `@banyan/core` 的测试，
  后者补 `test/sandboxHost.test.ts` 或本目录用例。

### 3.7 Local API 请求模板

所有 `/banyan/*` 请求至少需要以下请求头：

| Header                   | 值                 |
| ------------------------ | ------------------ |
| `Content-Type`           | `application/json` |
| `Zotero-Allowed-Request` | `1`                |
| `X-Banyan-Client`        | `Banyan for Agent` |

这里的 `Banyan for Agent` 是 Local API 对原生客户端使用的协议标识，与是否使用 MCP 或 AI
Agent 无关。

以下请求可选用于构造文档上下文，或在 GUI 步骤不适用时直接验证 refresh 接口。可在
PowerShell 执行，也可由任意支持 HTTP POST 的工具发送；GUI 验收并不要求使用 MCP。

```powershell
$body = @{
  documentId = "test-gui"
  style = @{ id = "host-contract-probe"; title = "Host contract probe" }
  contexts = @(
    @{
      id = "ctx-1"
      page = 1
      params = @{}
      cites = @(
        @{
          item = @{
            id = "123"
            "z:uri" = "http://zotero.org/users/0/items/ABCD2345"
          }
        }
      )
    }
  )
  syncItems = $true
} | ConvertTo-Json -Depth 12

curl.exe -sS -X POST "http://127.0.0.1:23124/banyan/refresh" `
  -H "Content-Type: application/json" `
  -H "Zotero-Allowed-Request: 1" `
  -H "X-Banyan-Client: Banyan for Agent" `
  --data-binary $body
```

- `contexts[].id` 必须非空且唯一，`contexts[].page` 必须是有限数字。
- `cites[].item.id` 必须是字符串；`cites[].item["z:uri"]` 是宿主持有的持久 URI。
- `syncItems` 默认 `true`；设为 `false` 时保留请求中的条目快照，只让能力层按 URI 解析。
- 请求中的条目身份必须来自当前测试文库。可在 Zotero 开发者控制台、数据库检查工具或
  可执行 Zotero JavaScript 的 computer-use 工具中读取 `String(item.id)` 和
  `Zotero.URI.getItemURI(item)`；不要复用其他文库的身份值。
- 响应形如 `{ "ok": true, "data": { "citations": [...], "bibliography": [...] } }`；
  失败时 `data.error.code` 为 `invalid_params`、`internal_error` 等。

## 4. 用例

每个用例均列出目标、夹具、准备条件、步骤和预期结果。步骤以 Zotero 界面状态和标签描述，
可由人工、MCP 或其他 computer-use 工具执行；工具只负责完成操作，不构成用例前置条件。

### HOST-01 多语能力成功解析

- **验收目标**：宿主把 readonly 的 context item 交给核心的多语能力时，不需要样式复制对象；
  `getMultilingualItems` 返回关联条目，而不是空数组或跨 realm 错误。
- **夹具**：`MT-08-MLING-ZH`、`MT-09-MLING-EN`；两项互为 `banyan:multilingual`。
- **准备**：注入夹具；把 `styles/host-contract-probe.js` 载入样式编辑器（预览即可），或复制到
  数据目录 `banyan/` 并重启。
- **步骤**：
  1. 在样式编辑器载入探针样式。
  2. 在“输入”面板点击 + 添加一条引注行，双击行或按回车加入 MT-08。
  3. 运行 → 刷新预览，读取“引注”输出。
  4. 把该行换成 MT-09，重新刷新。
  5. 也可按 §3.7 向 `/banyan/refresh` 发送同一条目的 context，并读取
     `data.citations[].content`；此接口请求是可选的替代验证方式。
- **预期**：
  - MT-08 的输出包含 `MT-09 Multilingual English Item`，不包含源条目自身。
  - MT-09 的输出包含 `MT-08 Multilingual Chinese Item`。
  - 探针分别用 context item 和 `{ ...item }` 调用能力；两次结果一致，且没有
    `error:`、`id=number` 或 `host-capability`。
  - 关联顺序不影响结果。`getMultilingualItem` 的语言优先级和源条目回退由核心契约测试
    覆盖，本用例不重复。

### HOST-01M 过期 URI / 合并回退

- **验收目标**：条目合并后，文档仍保存旧 URI；宿主应把旧身份解析到存活条目，再通过多语能力
  返回语言关联项。`syncItems` 开、关两条路径都必须工作。
- **夹具**：`MT-10-MERGE-SOURCE`、`MT-11-MERGE-LANG`、`MT-12-MERGE-SURVIVOR`。
  MT-12 通过 `dc:replaces` 替换 MT-10；MT-12 与 MT-11、MT-10 与 MT-11 互为多语关联。
- **准备**：
  1. 注入夹具，确认上述关系。
  2. 备份三项的 `toJSON()`、`getRelations()`、`deleted` 和 `getCollections()`。
  3. 读取 MT-10 的旧 `id`（字符串）和旧 URI（`Zotero.URI.getItemURI(item)`）。
  4. 把 MT-10 放入回收站（`item.deleted = true; await item.saveTx()`），或通过 Zotero UI
     删除；不要清空回收站。
  5. 确保探针样式已索引，或可在样式编辑器中载入。
- **步骤**：
  1. 按 §3.7 构造 refresh 请求：`style.id = "host-contract-probe"`，一个 context 引用
     MT-10 的旧 `id` 与旧 `z:uri`，`page: 1`，`syncItems: true`。可在 PowerShell 执行，
     或使用其他支持 HTTP POST 的工具发送请求。
  2. 发送请求，记录 `data.citations[].content` 和 `data.citations[].source`。
  3. 把 `syncItems` 改为 `false`，重复一次。
  4. 恢复 MT-10 的 `deleted` 标记，核对三项关系。
- **预期**：
  - 默认路径：`source.cites[0].item.id` 为 MT-12 的当前 id，`z:uri` 为 MT-12 的当前 URI；
    `content` 包含 `MT-11 Merge Language Book`。
  - `syncItems: false`：`source` 保留旧快照（MT-10 的 id/URI）；`content` 仍包含
    `MT-11 Merge Language Book`，说明能力经 `dc:replaces` 回退到 MT-12 再取多语组。
  - 两种路径都不返回空数组或 `host-capability` 错误。
  - 恢复后 MT-10 未删除，MT-12 的 `dc:replaces` 仍指向 MT-10，多语关系未变。

### HOST-02 宿主 messageSink 日志去向

- **验收目标**：样式 `console` 的分级消息按 severity 分派到调试输出和错误控制台，同一次运行
  不重复处理。
- **夹具**：`styles/manual-gui-acceptance.js`，`debug` 选项打开；MT-01。
- **准备**：注入夹具；安装或载入 manual 样式；打开 Zotero 的调试输出
  （帮助 → 调试输出日志 → 启用/查看），清空旧输出。
- **步骤**：
  1. 人工：在样式编辑器载入 manual 样式，在“全局选项”区把“输出诊断日志（测试）”设为开；
     输入 MT-01，刷新预览。
     可选接口方式：按 §3.7 向 refresh 传 `style.options = { debug: true }`，context 引用 MT-01。
  2. 在调试输出中搜索 `manual trace`、`manual info`、`manual warn`、`manual error`。
  3. 打开错误控制台，搜索同样文本。
- **预期**：
  - `manual trace`、`manual info` 只出现在调试输出。
  - `manual warn`、`manual error` 同时出现在调试输出和错误控制台。
  - 每次运行每条消息只出现一次；日志带 `[style=manual-gui-acceptance / 手动验收样式]`
    前缀。
  - trace 不进入样式诊断 / finding 列表。

### PLUGIN-01 引注窗口：参数、富文本与取消

- **验收目标**：引注窗口正确渲染 citation / cite 参数和富文本；非法值阻止确认；原生错误
  对话框关闭后焦点回到控件；取消不写回。
- **夹具**：`styles/manual-gui-acceptance.js`；MT-01、MT-02。
- **准备**：
  1. 注入夹具；把 manual 样式复制到数据目录 `banyan/` 并重启，确保样式选择列表可见。
  2. 用该样式生成一次输出，或把 `extensions.zotero.banyan.lastUsedStyleId` 设为
     `manual-gui-acceptance`，因为 Banyan Debug 的引注窗口使用“上次使用”的样式。
  3. 在主窗口选中 MT-01 和 MT-02。
- **步骤**：
  1. 打开引注窗口（Banyan Debug → Open citation dialog，或 Word/WPS 的“插入引注”）。
  2. 在条目列表中双击 MT-01、MT-02，把它们加入当前引注。
  3. 展开第一条 cite 气泡。
  4. 检查逐条参数：book 条目显示“定位符”；“详情”为只读 `book-detail`；“页码范围”默认
     一行 `1-1`。
  5. 编辑“页码范围”第一行的“止”：先改为 `2`，再改回 `1` 并移开焦点，使其成为用户输入。
  6. 关闭出现的原生“无效输入”提示，观察焦点回到“止”控件。
  7. 点击“逐条富文本”的预览区域。
  8. 关闭富文本编辑器，点击“取消”。
- **预期**：
  - 默认列表行不报错，“确定”可用；用户输入 `1` 后该字段标红、气泡带 `is-invalid`、
    “确定”禁用。
  - 原生错误提示出现一次；关闭后焦点回到同一个“止”控件。
  - 富文本预览直接打开编辑器，没有独立的“编辑”按钮。
  - “取消”关闭窗口且不写回；通过 `/banyan/citation` 调用时响应 `data` 为 `null`。
  - 非 book 条目的“定位符”隐藏，“详情”可编辑。

### PLUGIN-02 样式选择、编辑器与索引同步

- **验收目标**：样式选择、搜索、全局选项、编辑器的运行/预览/信息视图、保存后的索引同步
  都保持一致。
- **夹具**：`manual-gui-acceptance.js`、`manual-gui-diagnostics.js`、
  `manual-gui-disposable.js`、`host-contract-probe.js`（无全局选项）。
- **准备**：注入夹具；把需要的样式复制到数据目录 `banyan/` 并重启；或在样式编辑器中逐个
  载入。

#### A. 样式选择与搜索

1. 打开样式选择（Banyan Debug → Open style dialog；可选地 POST `/banyan/style`）。
2. 在搜索框输入“诊断”，确认列表按标题过滤。
3. 选中过滤后的行，确认详情（标题、引文类型、更新日期、描述、全局选项）与行一致。
4. 清空搜索，选中 host probe（无全局选项），确认“全局选项”区块不显示空壳。
5. 点击“取消”；重新打开，选中 manual 样式并“确定”。

预期：

- 搜索按标题过滤；过滤后选中行、详情和确认结果一致，不会停留在被过滤掉的旧样式。
- 取消返回 `null` / 不写回；确定返回选中样式的 stored values，而不是 effective/forced 值。
- 没有全局选项的样式不显示空的“全局选项”区块。

#### B. 样式编辑器

1. 工具 → Banyan 样式编辑器。
2. 文件 → 载入样式 → `manual-gui-diagnostics.js`。
3. 运行 → 刷新预览，检查“预览”“沙箱反馈”“控制台”和“信息”视图。
4. 用“查看”菜单切换输入、预览和信息视图。
5. 载入 `manual-gui-acceptance.js`，在“全局选项”区把“模式”切到“完整”，观察“形式”被强制为
   “短”且只读。
6. 再载入另一份样式，确认上一份样式的全局选项已清空。
7. 运行 → 检查代码，查看声明错误的 lint 结果。

预期：

- 诊断样式的载入期 findings 进入调试输出和错误控制台，不显示在编辑器面板；编辑器面板只显示
  运行期的“沙箱反馈”和控制台输出。
- 输入、预览、信息视图互不混用。
- forced value 只读且随模式变化；载入另一份样式后旧选项不残留，下一次运行重新生成。
- “检查代码”显示 ESLint 式结果，覆盖重复参数 id、非法参数 kind、重复 preset id、preset 的
  未知键/类型名、validator 缺少 description/check 等声明错误。

#### C. 保存与索引同步

1. 载入 `manual-gui-disposable.js`，修改标题或描述。
2. 文件 → 保存。
3. 核对磁盘文件已更新；样式索引只有一条相同 `INFO.id` 的记录。
4. 依次查看样式选择列表、设置页样式表、“条目菜单来源”列表，确认都显示新标题。
5. 删除这次复制进 `banyan/` 的一次性样式，并恢复相关设置。

预期：

- 保存写入磁盘并刷新索引；选择列表、设置页和条目菜单来源同步更新，没有重复索引。
- 一次性样式作为菜单来源时，条目菜单仍出现它的快捷标记；删除后回退行为见 PLUGIN-04。

### PLUGIN-03 参考文献与创建输出

- **验收目标**：参考文献编辑、未引用条目、创建输出的各种组合和错误路径都给出正确结果与
  可见反馈。
- **夹具**：MT-01、MT-02、MT-03、MT-04、MT-06；`manual-gui-acceptance.js`、
  `manual-gui-output-error.js`。
- **准备**：注入夹具；安装 manual 样式和 output-error 样式。

#### A. 参考文献窗口

1. 在主窗口选中 MT-01、MT-02。
2. Banyan Debug → Open bibliography dialog。
3. 检查列表和布局；编辑一行手动内容；点击“取消”。

预期：取消返回 `null`，手动编辑不写回。

#### B. 创建输出

1. 选中 MT-01，条目右键 → 榕树 → 创建引注/参考文献表。
2. 选择 manual 样式；输出类型“引注”；格式“纯文本”；方式“复制到剪贴板”；确定。
3. 粘贴剪贴板内容，确认包含 `[Manual GUI]`、`mode=`、`cites=book-detail/1-1/逐条` 等
   生成结果。
4. 重复一次“参考文献表” + “富文本 HTML” + “复制到剪贴板”；把剪贴板粘贴到富文本编辑器，
   确认同时有 `text/html` 和纯文本两种 flavor。
5. 重复一次“保存为文件”，保存到固定临时路径；核对文件内容。
6. 选择 output-error 样式，确定。

预期：

- 复制成功出现“已复制到剪贴板”提示；保存成功出现“已保存”提示。
- 剪贴板内容与生成结果一致；富文本格式保留 HTML，纯文本格式无标记。
- 保存文件内容与生成结果一致；测试后删除文件。
- output-error 样式只出现一个原生 `[JavaScript Application]` 弹窗，正文为
  `Style "手动输出错误样式" function generate has no return value. Please return { citations, bibliography }.`；
  关闭后输出对话框随之关闭，没有第二个弹窗，也没有写入剪贴板或文件。

#### C. 未引用条目

1. 在参考文献窗口的“未引用条目”区点击“编辑条目”，打开“添加为未引用条目”。
2. 加入 MT-04，点击取消。
3. 再次编辑，加入 MT-06，点击确定。

预期：

- 取消后列表和行文本不变，HTTP 请求返回 `{"ok":true,"data":null}`。
- 确定后列表立即刷新为新加入的 MT-06；不会因为复用同一行 id 而停留在编辑前的条目。

### PLUGIN-04 设置、菜单与条目窗口

- **验收目标**：设置即时持久化；条目菜单的各个窗口可打开、可取消；非法输入不落库；
  删除样式后菜单正确回退。
- **夹具**：MT-01、MT-02；`manual-gui-acceptance.js`、`manual-gui-diagnostics.js`、
  `manual-gui-disposable.js`。
- **准备**：注入夹具；安装所需样式；备份相关设置和 MT-01 的 `extra`。

#### A. 设置持久化

1. 编辑 → 设置 → 榕树。
2. 修改“引注窗口 → 打开时默认选中”、“条目菜单 → 采用的样式”和“条目列表 → 额外字段”
   键名（例如 `genre`）。
3. 关闭设置，重新打开，核对三项仍在。
4. 查看条目列表的列标签是否随额外字段键名更新。
5. 恢复原设置。

预期：设置即时持久化；额外字段列按 `额外字段：<键名>` 注册；留空时不提供该列。

#### B. 条目菜单与条目窗口

1. 选中 MT-01，右键 → 榕树，确认出现“扩展创建者信息…”“写入‘其他’字段”“快捷标记”
   “创建多语言条目…”“关联多语条目”“检查字段”“创建引注/参考文献表”。
2. 依次打开上述窗口并取消，确认都能关闭。
3. 打开“写入‘其他’字段”，输入非法键 `bad key!` 和任意值，确定。
4. 重新打开，输入合法键和值后取消；再输入后确定。
5. 打开“快捷标记”，应用“古籍（测试）”；如出现字段值冲突提示，选择“覆盖”并记录。
6. 打开“检查字段”，在 MT-01 上运行。

预期：

- 非法键提示“字段名无效，请重新输入。”，不写入条目。
- 取消不写回：`extra` 在内存和数据库中保持原值，条目没有 changed 标记。
- 确定写入后键名按 Zotero 规则规范化；测试后清回原值。
- 快捷标记按声明写入 `language` / `publisher`；测试后恢复。
- 字段检查报告显示每个条目的条目类型图标和与主窗口一致的标题字重；表格容器有确定高度，
  行可见；同步和异步检查都有结果，未通过项显示原因。

#### C. 删除样式后的回退

1. 把 `manual-gui-disposable` 设为“条目菜单来源”，把 `manual-gui-diagnostics` 记为
   上次使用（用后者生成一次输出）。
2. 在设置页样式管理器中删除 disposable 样式；关闭原生确认框，确认删除。
3. 观察样式索引、设置页来源列表和条目菜单。

预期：

- 索引减少一项，一次性样式文件被删除。
- 存储的 `itemMenuStyleId` 不必被改写；设置页来源列表回退到“上次使用”。
- 条目菜单改为显示 diagnostic 样式的快捷标记，没有重复索引。
- 恢复两个设置和被删除的一次性样式（如后续还要用）。

### PLUGIN-05 侧栏、列与迁移

- **验收目标**：多语侧栏和条目列表列随真实文库状态刷新；不可访问条目只提示一次；条目类型
  迁移提示给出正确成员和字段损失，并能选择关闭或统一类型。
- **夹具**：MT-08/MT-09、MT-01/MT-02、MT-13/MT-14；`manual-gui-acceptance.js`。
- **准备**：注入夹具；安装 manual 样式；备份 MT-13/MT-14 和 MT-01 的 `extra`。

#### A. 侧栏与列

1. 在主窗口选中 MT-08，展开条目面板的“榕树：多语关联”。
2. 将侧栏滚动到可见区域，等待异步渲染完成。
3. 在设置中把额外字段键名设为 `genre`，给 MT-01 写入 `extra` 的 `genre: Test`。
4. 右键条目列表表头 → 列设置，勾选“额外字段：genre”。
5. 按 §3.7 用 manual 样式和 `documentId = "gui-fixture-document"` 发送 refresh，context 引用
   MT-01/MT-02，刷新条目列表。

预期：

- 多语侧栏显示 `MT-09 Multilingual English Item`，不是加载占位符。
- 额外字段列显示 `genre: Test`；取消勾选或清空键名后不再显示。
- 合成文档在集合树中出现文档行；“引注”列在 MT-01/MT-02 行显示刷新得到的引注 HTML。
- 测试后删除合成文档、清除 MT-01 的 `extra` 并恢复键名。

#### B. 不可访问条目提示

1. 构造一个 refresh 请求：使用 manual 样式；context 的 cite 使用伪造的跨用户 URI
   （例如 `http://zotero.org/users/999999/items/ABCD2345`），并在同一 context 中重复引用
   两次；cite 的 `item` 至少带缓存的 `itemType` 和 `title`，以便“忽略”后还能生成。
2. 发送请求。
3. 点击“忽略”。

预期：

- 只出现一个“检测到不可访问的条目”弹窗；正文按条目计数，显示
  `1 个条目来自其他用户的个人文库`（重复 cite 只计一次），按钮为“导入条目/忽略/取消”。
- 点“忽略”后请求继续，并返回缓存快照的生成结果；不再弹第二次。
- 关闭弹窗后恢复主窗口选中项。

#### C. 条目类型迁移提示

1. 选中 MT-13，在条目面板把“条目类型”从“图书”改为“图书章节”。
2. 确认 Zotero 自身的“更改条目类型”警告（其中列出将清除的“总页数”）。
3. 在随后出现的“多语言条目”提示中先点“关闭”。
4. 把 MT-13 改回“图书”，确认不再弹出提示。
5. 再次把 MT-13 改为“图书章节”，这次点“全部改为‘图书章节’”。

预期：

- 第一次提示列出 MT-14 的当前类型和将清除的字段；点“关闭”后 MT-14 仍为“图书”，多语关系
  未变。
- 把 MT-13 改回“图书”时类型一致，不再弹出提示。
- 点“全部改为…”后 MT-13、MT-14 都变成“图书章节”，标题移到 `bookTitle`，“总页数”被清除。
- 提示中的条目名从 `title` 回退到 `bookTitle` 后仍可见，不为空。
- 测试后按备份恢复两项的类型、标题、`numPages`、语言和关系。

#### D. XHTML 窗口冒烟

1. 依次打开并关闭参考文献、引注、创建输出、写入字段、多语言、扩展创建者、字段检查、
   样式选择、设置和样式编辑器窗口。
2. 观察错误控制台。

预期：所有窗口正常打开和关闭，没有 XML 解析错误、空白窗口或未捕获异常。

## 5. 执行约定

### 5.1 通用

- 一次只执行一个用例；每个用例结束恢复到用例前状态，不把上一个用例的选中项、窗口或
  临时文件当作前置条件。
- 只记录实际观察到的结果；未执行或无法复现的步骤写“未完成”，不要推断为通过。
- 结果写入验收记录、issue 或 PR，不写回本文件。
- 失败时先判断是核心契约还是插件 UI：核心问题补工具链中 `@banyan/core` 的测试，插件问题补
  `test/sandboxHost.test.ts` 或本目录用例。
- 发布候选至少执行 HOST-01、HOST-01M、HOST-02、PLUGIN-01、PLUGIN-02、PLUGIN-03、
  PLUGIN-04、PLUGIN-05；用例中的恢复步骤必须完成。

### 5.2 人工操作

- 按界面标签操作；原生 `alert`、文件选择器和真实焦点用正常 UI 完成。
- 修改条目、关系、类型或设置前先备份；破坏性用例优先在专用测试文库中执行。
- 文件输出使用固定临时路径，测试后删除；不要留下打开的原生对话框。
- 每个用例结束确认只剩主窗口。

### 5.3 自动化工具注意事项

MCP bridge 是本仓库提供的可选半自动化操作接口，不是 GUI 验收框架或运行依赖。只有在
运行环境已配置对应服务和工具时，才能使用该入口。其他 computer-use 工具可按相同界面
步骤执行；无法自动化的原生窗口步骤由操作者手动完成。

- 原生 `alert` / `Services.prompt` 是 `MozillaDialogClass` 窗口，可能不出现在自动化工具的
  应用窗口列表中；应使用支持原生窗口的功能，或手动完成并确认焦点/状态。
- 侧栏滚动到可见区域后，Zotero 才会调用 `onAsyncRender`；应等待最终内容出现，不要把
  加载占位符当成最终状态。
- 条目面板的 Info 区展开后，条目类型菜单才会出现；更改类型前应确认相应区域已展开。
- parentless modal 对话框打开期间，生成调用会阻塞到对话框关闭。需要生成时应在对话框内
  完成；关闭后不要继续等待已阻塞的任务。
- 原生提示挂在最上层窗口，可能不属于被 app-modal 对话框禁用的主窗口；应按实际弹窗位置
  操作。
- 每个用例结束后确认只剩主窗口，并清理临时样式、输出文件、导入条目和设置。

### 5.4 运行记录模板

结果不写入本仓库文档，但每次执行至少保留以下信息：

```text
用例：HOST-01
环境：Zotero <version> / Banyan <commit> / <OS>
结果：通过 | 失败 | 阻塞
观察：实际看到的输出、提示、窗口和焦点
证据：截图、日志片段、Local API 响应或数据库查询
恢复：已恢复的条目、关系、设置和文件
```
