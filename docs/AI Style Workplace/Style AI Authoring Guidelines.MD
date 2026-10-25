# Banyan Style 编写说明

> 与本说明同目录的 `typings/` 定义了全部接口、数据结构与工具函数的行为注解
> （`style.d.ts`/`unit.d.ts`/`styleUtils.d.ts`/`item.d.ts`）；这里只补充类型无法
> 表达的内容：运行语义、写作要点与成文结构。

## 1. 样式文件要求

产出一个**单文件 JavaScript** 样式脚本：顶层提供 `INFO`、`generate()`（必需）与
`STYLE_OPTIONS` / `CITATION_PARAMS` / `CITE_PARAMS`、`ITEM_FIELD_PRESETS`、`ITEM_FIELD_VALIDATORS`（可选），放入 banyan 数据目录即可被插件加载执行。

- 文件保持精简：注释只解释本样式的独有决策，通用能力交给沙箱工具。
- 推荐内部顺序：常量与辅助函数 → `INFO` → `STYLE_OPTIONS` → `CITATION_PARAMS` / `CITE_PARAMS` → `ITEM_FIELD_PRESETS` → `ITEM_FIELD_VALIDATORS` → `generate()`。

## 2. 工作环境：沙箱

`generate()` 在受控沙箱中运行。沙箱既带来**限制**，也提供**便利**。

### 限制

- 不是 Node.js：不用 `require`/`fs`/`path`/`process` 等 Node API；不用
  `window`/`globalThis`、顶层 `await`；不用 `this` 组织逻辑。
- `readText`/`readBytes`/`readJSON` 只能读取 banyan 数据目录内的相对路径文件。

### 数据视图

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

### 全局工具函数

沙箱以全局函数提供下列工具。只有当工具无法表达特定格式规则时，才编写专用逻辑。
特有规则（如某刊的著录顺序、编号合并）才自己写函数。

| 需求                   | 用                                                               |
| ---------------------- | ---------------------------------------------------------------- |
| 取条目字段             | 直接 `item.field`（安全视图已保证缺失即 `""`）                   |
| 参数值安全化           | `safeString(value)`                                              |
| 读 `extra`             | `getExtraValue(item, "键")`；多值加第三参 `"array"`              |
| 解析/规整日期          | `formatDate(value, ({ year, month, day }) => …)`                 |
| 多语言条目             | `getMultilingualItem(item, "en")` / `getMultilingualItems(item)` |
| 读小数据文件           | `readText` / `readJSON` / `readBytes`                            |
| 报告问题（不中断）     | `console.warn(...)` / `console.error(...)`（见下）               |
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
  手写 `RichText { text, marks }` 的 mark 区间；rich 参数返回的是标记字符串，需要时用
  `htmlToUnit` 转换；不要手写结构或 mark 区间。
- `read*` 与 `getMultilingual*` 返回 Promise，用到时把 `generate` 写成 `async`
  并 `await`。

### 日志与诊断：`console`

沙箱提供标准的 `console`，用它既能调试，也能**报告问题而不中断**：

- `console.log`/`debug`/`trace`（以及 `dir`、`table`）是调试输出：单次有裁剪、每次
  运行有行数上限，随时可被丢弃，不会保留。
- `console.info`/`warn`/`error` 是“发现”：会随样式保留并交给宿主显示，因此遇到
  “这个条目缺字段”“这条数据格式不认识”这类**可以继续**的情况，用
  `console.warn`，不要为了让用户知道而抛异常。
- `console.assert(condition, ...)` 在条件为假时按 `error` 报告。
- 其余常见方法（`count`、`time`、`group`、`clear` 等）存在但什么也不做：熟悉的
  写法不会因为方法缺失而抛错。

只有**无法继续**时才 `throw`。

## 3. 关键环节

### `INFO` 元数据

`id` 用英文小写短横线且稳定唯一；`title` 用英文；`updated` 填 `YYYY-MM-DD`；其余
字段按需填写。

### `generate()` 实现

- 读取全局 `contexts`（与要输出的 `citations` 一一对应），返回
  `{ citations, bibliography }`。
- 每条 `content` 是**单个** `Unit`：多片段经工具组合，不要手写 `RichText`/mark
  索引、不要把数组直接赋给 `content`。
- `citations.length === contexts.length`，每条 `id` 沿用 `context.id`。
- `bibliography` 一般按被引条目去重；条目身份使用核心字段 `item.id`。不要读取
  `key` / `uri` / `relations`，也不要依赖 `z:*` 等宿主私有扩展键。
- 主流程用 `try/catch` 包裹，异常时返回空结果；可以继续的问题用 `console.warn`
  报告，不要为了提示而中断整次生成。

### 写参数声明（按需）

需要用户输入时才提供：

- `STYLE_OPTIONS` 控制整篇文档统一的参数，值写入只读全局 `options`；
  `CITATION_PARAMS` 控制整条引用，`CITE_PARAMS` 控制单个被引项；
  三个数组都可选。
- 参数只有两类语义：`state`（封闭状态）与 `value`（开放字符串）；
  `CITE_PARAMS` 另有 `list` 重复行（`fields` 只能是 value，值是行对象数组）。
- `state` 用布尔或 `states: { key: "标签" }`；没有 validator。
- `value` 始终是字符串；`format: "rich"` 表示受限标记字符串；`presets` 只是
  推荐值，不限制输入。
- `defaultValue` 是初始值，也是 `applicable=false` 时的有效值。
- `applicable(scope)` 返回 `false` 时参数不适用；`forcedValue` 返回 `T` 时锁定，
  返回 `null` 时自由；不要返回 `undefined`。
- `validate(value, ...scope)` 只校验自由值，返回 `true` / `false` / 错误字符串。
- `description` 是可选的静态说明。
- 引注级回调参数：`applicable(citation, options)` / `forcedValue(citation, options)` /
  `validate(value, citation, options)`；引用级为 `(cite, citation, options)`；
  `list` 字段的 validate 额外拿到当前 `row`。
- 输入阶段不传全文 `contexts`：引用对话框只编辑本条引用，输出由刷新阶段在全文上生成。
  `ibid`、前注号、首引等全文判断写在 `generate()` 里，用全局 `contexts` 扫描；
  参数回调只读这条 citation 内的 `cites`。
- 参数值在 `options` / `ctx.params` / `cite.params` 中读取；`list` 按行对象字段读。
- 依赖按声明顺序从前至后求值；依赖应写在被依赖参数之后。

### 写 `ITEM_FIELD_PRESETS`（按需）

当格式要求“某类条目必须把某个字段写成某个值”时（用户难以自行得知键与值），用 `ITEM_FIELD_PRESETS` 声明条目右键菜单里的“快捷标记”：

- 应用时把 `fields` 逐条写进选中条目：键在条目类型上是合法字段就写该字段，否则写进 `extra`（`status` 对 `journalArticle` 走 `extra`）。
- 取值由用户按条目决定时写 `null`：应用时逐条询问，菜单文本以 `…` 结尾。
- 非 `itemData` 的键（`extra`、`id`、`itemType`、`creators` 等）会被拒绝。
- CSL name 变量不会被 citeproc 当作 creators，`type: <条目类型>` 会改掉条目类型：宿主只记日志，不拦截。
- `visible(item)` 只决定菜单项在哪些条目上出现，也限定写入对象，与参数级 `applicable` 不是同一层语义：它只控制菜单项是否出现。
- 样式编辑器会校验该声明（`banyanStyle/validate-field-presets`），写错会立刻报出。
- 读取条目字段时用 Zotero 的**内部字段名**，不要用界面标签：Software 的“Version”是 `item.versionNumber`（`item.version` 是记录版本，不在 Banyan 条目里），"Publication" 是 `item.publicationTitle`。样式编辑器用 `banyanStyle/warn-item-field-misuse` 提示这类误用，以及 `abstractNote`／`dateAdded`／`dateModified`／`collections`／`notes` 这些 Banyan 条目不携带的键。

### 写 `ITEM_FIELD_VALIDATORS`（按需）

当格式要求“某类条目应满足哪些字段条件”时，用 `ITEM_FIELD_VALIDATORS` 声明条目右键菜单里的「检查字段」：

- 顶层按 Zotero 条目类型分组，每类是一个检查器数组；类型名用 `book`、`journalArticle` 这样的精确内部名。
- 每个检查器只含 `description`（报告中的名称）与 `check(item)`；返回 `true`（通过）、`false`（未通过）、字符串或字符串数组（失败说明），也可以返回 Promise。空数组视为通过；超时、reject、空字符串、数字、对象等视为检查器出错。
- 通用规则用普通数组展开复用，例如 `book: [...commonChecks, bookCheck]`；不要期待宿主提供继承、通配符或 `common` 键。
- 检查器只读、无副作用、不开窗、不写条目；可以使用已有的异步读取函数（如 `getMultilingualItems()`），每项检查最多 10 秒。不适用时返回 `true`。它不知道其他选中条目，也不校验渲染结果或整库。
- 报告窗口按条目展开检查器行，非模态，方便边看边改；样式未声明时菜单项不出现。
- 样式编辑器会校验声明形状（`banyanStyle/validate-item-field-validators`）；运行时不因单个检查器出错而中断整轮检查。

## 4. 示例

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

// 需要参数时再声明：
// const STYLE_OPTIONS = [...];
// const CITATION_PARAMS = [...];
// const CITE_PARAMS = [...];

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
