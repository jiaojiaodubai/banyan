# Banyan Style 编写说明（面向 AI Agent）

> 本文用于让 AI Agent 根据“样式需求”直接生成可运行的 Banyan 样式脚本。
> 使用方式：把本文和你的样式需求一起提交给 Agent。

## 1. 任务目标

你是 Banyan 样式脚本生成器。你的目标是输出一个单文件 JavaScript 样式脚本，放入 banyan 数据目录后可被插件加载并执行。

你必须满足以下要求：

- 输出必须是完整脚本代码，不要输出解释性文字。
- 脚本必须实现 `INFO` 和 `generate()`。
- 如果需求包含可配置参数，才实现 `UI`。
- `generate()` 必须读取全局只读变量 `contexts`，并返回 `{ citations, bibliography }`。
- 生成结果中的 citation 与 bibliography 均使用 `content` 字段；脚本侧类型是单个 `Unit`，多片段请用 `group([...])` 或 `fallback([...])` 组合。

## 2. 运行环境约束（硬性）

- 目标环境是 Zotero/Firefox 沙箱，不是 Node.js。
- 禁止使用 Node API：`require`、`fs`、`path`、`process`、`child_process` 等。
- 不要依赖顶层 `await` 或仅现代浏览器才支持的新特性。
- 不要污染全局对象（不要写 `window.xxx` 或 `globalThis.xxx`）。
- 不要使用 `this` 作为核心逻辑依赖。

可用只读文件函数：

- `debug(...values)`
- `readText(relPath)`
- `readBytes(relPath)`
- `readJSON(relPath)`
- `uuid()`
- `getExtraValue(item, key)` 默认返回 `string`；显式调用 `getExtraValue(item, key, "array")` 时返回 `string[]`；`item.extra` 的键已归一化为 kebab-case，`key` 需使用归一化后的形式
- `getMultilingualItems(item)`
- `getMultilingualItem(item, language)`

说明：只能访问 banyan 数据目录下的文件，宿主会规范化路径并拒绝目录穿越或绝对路径绕过。文件读取不设置大小硬限制；生成脚本时应只读取来源明确、格式固定、已预清洗的小型数据文件，不要把大型文本、JSON 或二进制数据一次性读入内存。多语言 item API 返回的是只读安全视图；`getMultilingualItem(item, language)` 会按 `item.language` 匹配语言，支持 `zh` 匹配 `zh-CN`，未命中时回退到当前条目。

## 3.5 类型声明位置

请直接从以下文件读取类型定义：

- `./typings/item.d.ts`
- `./typings/unit.d.ts`
- `./typings/style.d.ts`
- `./typings/styleUtils.d.ts`

使用方式：在生成样式脚本时，以本文规范为准，并以上述类型声明作为数据结构依据。

## 3. 输入数据模型（最小认知）

- `contexts`：只读安全视图，类型可按 `ScriptContexts` 理解，每个元素代表一条引注上下文。
- 读取对象上不存在的属性时，运行时会返回空字符串 `""`；数组索引和数组方法保持原生行为。
- `context.cites`：当前引注中的被引条目数组。
- `context.params`：整条引用级参数（来自 `UI.citation`）。
- `cite.params`：单条被引项参数（来自 `UI.cite`）。
- `cite.item`：Zotero 条目对象（可读取 `id`、`title`、`firstCreator`、`date` 等字段）。

## 4. 输出脚本结构（必须遵守）

脚本只需要导出以下顶层符号：

- `INFO`（必需）
- `generate`（必需）
- `UI`（可选）

推荐结构：

1. 顶部常量与辅助函数
2. `INFO`
3. `UI`（如果需求涉及参数）
4. `generate()` 主流程

## 5. INFO 字段约束

`INFO` 至少包含：

- `id`: 稳定且唯一（英文、小写短横线风格）
- `title`: 样式名（英文）
- `updated`: `YYYY-MM-DD`
- `citationType`: 按需求填写（常见：`intext-citation`）

建议补充：`description`、`creator`、`license`、`tags`。

## 6. generate() 编写规范

- 函数签名：`function generate()` 或 `async function generate()`。
- 不接收参数，直接读取 `contexts`。
- 需要保证：
  - `citations.length === contexts.length`
  - 每个 citation 的 `id` 与对应 `context.id` 一致
  - bibliography 可按“所有被引条目去重后”生成
- 返回格式：

```js
return {
  citations,
  bibliography,
};
```

- 推荐在主流程使用 `try/catch`，异常时返回空结果，避免未捕获异常。

## 7. 内容（content）构建规范

- 每个 citation/bibliography entry 使用 `content: Unit`。脚本侧值不是数组；运行时会把它标准化为前端渲染使用的 `RichText { text, marks }`。
- `RichText.marks` 的区间由运行时生成，使用 JavaScript UTF-16 字符串偏移，`end` 为排他边界；不要让样式作者或 AI 代码手写索引。
- 简单文本优先使用 `text("...")`。
- 复杂拼接可使用：`group(...)`、`affix(...)`、`fallback(...)`、`when(...)`、`textCase(...)`。需要返回多个片段时，把片段放进 `group([...])`，不要把数组直接赋给 `content`。
- 允许直接写叶子对象：`{ value: "..." }`。
- 超链接使用 `link(unit, href)` 包裹目标 `Unit`；不要在 `text(..., style)` 或 `withStyle(..., style)` 里写 `link` 属性。
- 组装 Unit 片段时优先使用 `group([...], delimiter)`，不要对可能含 Unit 的数组使用 `.join(...)`。
  - `.join(...)` 只适合纯字符串数组；如果元素是 Unit 对象（例如 `affix(...)` 的返回值），会被隐式串化成 `"[object Object]"`，导致错误文本泄漏到结果中。
  - 错误示例：`nameParts.map(part => affix(part, "", ".")).join(" ")`
  - 正确示例：`group(nameParts.map(part => affix(part, "", ".")), " ")`

## 8. UI 参数规范（按需）

当需求存在“可选项”时，输出 `UI`：

- `UI.citation`：控制整条引用表现。
- `UI.cite`：控制单个被引项表现。
- `UI.cite` 控件可使用 `visible(item)` 根据条目元数据限制输入范围；回调在弹窗展开时于沙箱中执行一次并严格返回布尔值。也可使用 `disabled(cite)` 根据参数动态启用或禁用控件而不改变布局，省略时默认为 `false`。
- 控件类型使用 `checkbox`、`select`、`text`。
- `id` 使用 camelCase；在 `generate()` 中从 `context.params` 或 `cite.params` 读取。

## 9. 生成策略（Agent 执行步骤）

1. 解析用户需求，提取：引用格式、排序规则、分隔符、作者规则、日期规则、是否需要参数化。
2. 设计 `INFO` 和（可选）`UI`。
3. 编写辅助函数（作者格式化、条目格式化、去重、排序）。
4. 在 `generate()` 中先生成 `citations`，再生成 `bibliography`。
5. 执行自检清单，确认脚本结构与返回值符合规范。

## 10. 自检清单（输出前必须逐项通过）

- 已包含 `INFO` 和 `generate`。
- 未使用 Node.js 专属 API。
- 未污染全局对象，未依赖 `this`。
- `generate()` 读取了 `contexts`。
- 返回值是 `{ citations, bibliography }`。
- 所有输出项使用 `content`。
- citation 的 `id` 正确映射 `context.id`。
- bibliography 已按被引条目去重（除非需求明确不要去重）。
- 对空数据有兜底处理（如 `contexts` 为空、作者缺失、标题缺失）。

## 11. 给 Agent 的可直接复用提示词模板

将下列模板中的“需求区”替换为你的具体要求，然后与本文一起提交给 Agent：

```text
你现在要为 Banyan 生成一个可运行的样式脚本（单文件 JavaScript）。
必须严格遵守我提供的《Banyan Style 编写说明（面向 AI Agent）》。

【需求区】
1) 引注样式要求：
- ...
2) 参考文献样式要求：
- ...
3) 排序/去重规则：
- ...
4) 可选参数（如需要）：
- ...
5) 特殊边界条件：
- ...

【输出要求】
- 只输出 JS 代码，不要解释。
- 必须包含 INFO、generate（和需要时的 UI）。
- generate 返回 { citations, bibliography }。
- 输出统一使用 content。
```

## 12. 最小可用脚手架（供 Agent 参考）

```js
const INFO = {
  id: "your-style-id",
  title: "Your Style Title",
  description: "Style generated for Banyan",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "AI Generator" }],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "2026-05-20",
};

const UI = {
  citation: [],
  cite: [],
};

function safeText(v) {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function generate() {
  try {
    const citations = contexts.map((ctx) => ({
      id: ctx.id,
      content: text(
        ctx.cites
          .map((c) => safeText(c.item.firstCreator || c.item.title))
          .filter(Boolean)
          .join("; "),
      ),
    }));

    const unique = new Map();
    for (const ctx of contexts) {
      for (const cite of ctx.cites) {
        unique.set(cite.item.id, cite.item);
      }
    }

    const bibliography = Array.from(unique.values()).map((item) => ({
      id: String(item.id),
      type: "bibliography-entry",
      content: text(
        [safeText(item.firstCreator), safeText(item.title)]
          .filter(Boolean)
          .join(". "),
      ),
    }));

    return { citations, bibliography };
  } catch (_err) {
    return { citations: [], bibliography: [] };
  }
}
```
