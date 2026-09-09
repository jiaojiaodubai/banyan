# Banyan Style 编写说明

> 与本说明同目录的 `typings/` 定义了全部接口、数据结构与工具函数的行为注解
> （`style.d.ts`/`unit.d.ts`/`styleUtils.d.ts`/`item.d.ts`）；这里只补充类型无法
> 表达的内容：运行语义、写作要点与成文结构。

## 1. 任务目标

产出一个**单文件 JavaScript** 样式脚本：顶层提供 `INFO`、`generate()`（必需）与
`UI`（可选），放入 banyan 数据目录即可被插件加载执行。

- 只输出脚本代码。
- 文件保持精简：注释只解释本样式的独有决策，通用能力交给沙箱工具。
- 推荐内部顺序：常量与辅助函数 → `INFO` → `UI` → `generate()`。

## 2. 工作环境：沙箱

`generate()` 在受控沙箱中运行。沙箱既带来**限制**，也提供**便利**。

### 限制

- 不是 Node.js：不用 `require`/`fs`/`path`/`process` 等 Node API；不用
  `window`/`globalThis`、顶层 `await`；不用 `this` 组织逻辑。
- `readText`/`readBytes`/`readJSON` 只能读取 banyan 数据目录内的相对路径文件。

### 便利一：数据是只读“安全视图”

`contexts` 及其内部一切对象（`ctx`、`ctx.cites[i]`、`cite.item`、
`cite.item.extra`、`ctx.params`、`cite.params`）都被宿主递归包装成安全视图：

- 读缺失属性返回 `""`（不是 `undefined`、不抛错），数组索引与方法保持原生；
- 条目字段（`title`/`date`/`year`/`firstCreator`/`creators`/`language`…）直接读，
  缺失即 `""`，无需判空；
- `extra` 已是解析好的键值对象，用 `getExtraValue(item, key)` 读取。

```js
const name = cite.item.firstCreator; // 缺失 -> ""
const label = fallback([
  text(cite.item.firstCreator),
  text(cite.item.title),
  text("佚名"),
]);
```

### 便利二：全局工具函数

沙箱把工具注入为全局函数，遇到下面的需求直接对号入座；只有工具覆盖不到的样式
特有规则（如某刊的著录顺序、编号合并）才自己写函数。

| 需求                   | 用                                                               |
| ---------------------- | ---------------------------------------------------------------- |
| 取条目字段             | 直接 `item.field`（安全视图已保证缺失即 `""`）                   |
| 参数值安全化           | `safeString(value)`                                              |
| 读 `extra`             | `getExtraValue(item, "键")`；多值加第三参 `"array"`              |
| 解析/规整日期          | `formatDate(value, ({ year, month, day }) => …)`                 |
| 多语言条目             | `getMultilingualItem(item, "en")` / `getMultilingualItems(item)` |
| 读小数据文件           | `readText` / `readJSON` / `readBytes`                            |
| 随机 id                | `uuid()`                                                         |
| Unit → 纯文本          | `plainText(unit)`                                                |
| 文本叶子               | `text(str, style?)`                                              |
| 串联片段               | `group([...], delimiter?)`                                       |
| 片段加前后缀           | `affix(unit, prefix, suffix)`                                    |
| 条件分支               | `when(cond, unit)`                                               |
| 可选项 + 默认值        | `fallback([...])`                                                |
| 斜体/加粗/上下标/颜色  | `text(str, { italic: true })` 或 `withStyle(unit, style)`        |
| 标题/句首/人名等大小写 | `textCase(unit, "title")` 等（`sentence`/`name`/`lower`…）       |
| 整段加超链接           | `link(unit, href)`                                               |

要点：

- 工具自动处理“空值”（渲染后无可见文本的内容，如 `""`、缺失字段、内部全空的
  组合）：`group` 跳过空片段且只在相邻实际内容之间插分隔符；`affix` 主体为空时
  整体不渲染；`fallback` 取第一个能渲染出可见文本的候选（`null`/`undefined`/
  `false` 与空文本候选被跳过）。多数分支与判空可由 `when`/`fallback`/`group`
  表达。
- 排版用工具参数表达（`text`/`withStyle`/`textCase`/`link`），不要手拼富文本或
  `RichText { text, marks }`——marks 由宿主在渲染前统一生成。
- `read*` 与 `getMultilingual*` 返回 Promise，用到时把 `generate` 写成 `async`
  并 `await`。

## 3. 关键环节

### 写 `INFO`

`id` 用英文小写短横线且稳定唯一；`title` 用英文；`updated` 填 `YYYY-MM-DD`；其余
字段按需填写。

### 写 `generate()`

- 读取全局 `contexts`（与要输出的 `citations` 一一对应），返回
  `{ citations, bibliography }`。
- 每条 `content` 是**单个** `Unit`：多片段经工具组合，不要手写 `RichText`/mark
  索引、不要把数组直接赋给 `content`。
- `citations.length === contexts.length`，每条 `id` 沿用 `context.id`。
- `bibliography` 一般按被引条目去重；重复引用合并、序号连排等属于样式策略，自行
  实现。
- 主流程用 `try/catch` 包裹，异常时返回空结果。

### 写 `UI`（按需）

需要用户输入时才提供：

- `UI.citation` 控制整条引用；`UI.cite` 控制单个被引项。
- 控件类型：`checkbox` / `select` / `input`，`id` 用 camelCase。
- 控件值在 `ctx.params` / `cite.params` 中读取。
- `UI.cite` 控件可用 `visible(item)`（弹窗展开时评估一次，须返回布尔值）与
  `disabled(cite)`（随参数变化评估，省略默认为 `false`）。

## 4. 提示词模板

把“需求区”替换为具体的格式要求，与本说明一起提交：

```text
为 Banyan 生成一个单文件 JavaScript 样式脚本。

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
- 只输出脚本代码。
- 实现 INFO、generate（需要时加 UI），输出统一使用 content。
- 精简：复用沙箱工具，只写样式特有逻辑。
```

## 5. 示例

最小可运行骨架（作者缺失时回退到标题，再回退到默认名；`fallback` 会跳过空文本
候选）：

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

const UI = { citation: [], cite: [] };

function author(item) {
  return fallback([
    text(item.firstCreator),
    text(item.title),
    text("Untitled"),
  ]);
}

function generate() {
  try {
    const citations = contexts.map((ctx) => ({
      id: ctx.id,
      content: group(
        ctx.cites.map((cite) => author(cite.item)),
        text("; "),
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
      content: group([
        withStyle(author(item), { italic: true }),
        text(". "),
        text(item.title || "Untitled"),
      ]),
    }));

    return { citations, bibliography };
  } catch (_err) {
    return { citations: [], bibliography: [] };
  }
}
```
