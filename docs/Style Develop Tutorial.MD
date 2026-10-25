# Banyan 样式开发入门

Banyan Style 是供 Banyan for Zotero 执行的 JavaScript 样式文件，用于生成引注和参考文献。
本文从常见的文献格式要求出发，说明这些要求如何对应到 Banyan 样式中的数据和输出字段，
并介绍样式文件的基本结构及可选功能。无需先掌握全部 JavaScript 语法；代码术语会在相关
示例中解释。

最小样式和文件结构见[第 1 节](#1-最小可用样式)与[第 2 节](#2-样式文件结构)；
输入参数见[第 3 节](#3-输入数据)；输出结构和 Unit 工具见[第 4 节](#4-输出citations-和-bibliography)
及[第 6 节](#6-unit-工具速查)；全局选项、快捷标记和字段检查见[第 5 节](#5-按需扩展全局选项快捷标记字段检查)。

## 术语对照

格式规范描述的是作者、年份、页码和参考文献等排版要求；样式代码则通过条目、引注和输出
对象表达这些要求。下表给出两者之间的对应关系。

| 格式规范中的概念                     | Banyan 术语         | 样式中的位置                       |
| ------------------------------------ | ------------------- | ---------------------------------- |
| 一处正文或脚注引注，可能包含多个文献 | 引注上下文（`ctx`） | `contexts[]`；输出到 `citations[]` |
| 该处引注中的一项文献引用             | 引用项（`cite`）    | `ctx.cites[]`                      |
| Zotero 文库中的文献记录              | 条目（`item`）      | `cite.item`                        |
| 参考文献列表中的一行                 | 参考文献项目        | `bibliography[]`                   |
| 引注或参考文献项目的文字、标点和格式 | Unit                | `content`                          |

例如，“引注显示作者、年份和页码”通常由 `citations[].content` 表达；“参考文献列出作者、
题名和出版信息”则由 `bibliography[].content` 表达。用户为整处引注或其中某项引用填写的
页码等内容，分别通过 Citation 参数和 Cite 参数提供，详见[第 3 节](#3-输入数据)。

## JavaScript 基础

样式通过 JavaScript 函数读取条目和引注，再返回排版结果。代码示例会解释所需语法；
不熟悉 JavaScript 的读者可按需阅读
[MDN JavaScript 教程](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide)。

## 1. 最小可用样式

一个样式至少要有 `INFO` 和 `generate()`：

```javascript
const INFO = {
  id: "my-first-style",
  title: "我的第一个样式",
  description: "一个最小的 Banyan 样式",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Your Name" }],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "2026-01-01",
};

function generate() {
  return {
    citations: contexts.map((ctx) => ({
      id: ctx.id,
      content: group(
        ctx.cites.map((cite) => cite.item.title || "无题"),
        "; ",
      ),
    })),
    bibliography: [],
  };
}
```

这段代码做了三件事：

1. `INFO` 描述样式本身；
2. `generate()` 读取 `contexts`，把每次引注变成一个字符串；
3. 返回 `citations` 和 `bibliography`，交给 Banyan 显示。

`contexts` 和 `text` 由 Banyan 注入，样式无需定义这些对象或函数。

`text(...)` 会把文字变成一个 **Unit**。Unit 是 Banyan 表示“一段文字及其格式”的对象；最简单的 Unit 也可以直接是字符串。后文会再介绍怎样组合和格式化 Unit。

> 多个标题用 `group(...)` 连接；`group` 会跳过空值，并在两个实际内容之间插入分隔符。

## 2. 样式文件结构

一个样式文件包含：

- **必需**：`INFO` 对象；
- **必需**：`generate()` 函数；
- **可选**：`CITATION_PARAMS`、`CITE_PARAMS`，让用户在引用窗口中输入；
- **进阶可选**：`STYLE_OPTIONS`、`ITEM_FIELD_PRESETS`、`ITEM_FIELD_VALIDATORS`。

后三项不是写一个样式所必需的，放在第 5 节讲。

### INFO 对象

`INFO` 描述样式的名称、作者、类型等信息。下面是最常见的写法：

```javascript
const INFO = {
  id: "your-style-id",
  title: "样式名称",
  description: "一句话说明这个样式适合什么场景",
  // intext-citation：正文中显示 [1]、(Smith, 2024) 等标记
  // note-citation：正文中显示脚注标记，内容写在脚注里
  citationType: "intext-citation",
  creator: [
    {
      type: "author",
      name: "Your Name",
      email: "you@example.com",
      uri: "https://example.com/",
    },
  ],
  tags: ["numeric"],
  documentation: ["https://example.com/docs"],
  license: "MIT",
  updated: "2026-01-01",
};
```

| 字段            | 作用                                 |
| --------------- | ------------------------------------ |
| `id`            | 样式的唯一标识，不要和别的样式重复   |
| `title`         | 显示给用户的名称                     |
| `description`   | 样式说明                             |
| `citationType`  | `intext-citation` 或 `note-citation` |
| `creator`       | 作者/维护者列表                      |
| `tags`          | 搜索和筛选用的标签                   |
| `documentation` | 文档链接                             |
| `license`       | 许可协议                             |
| `updated`       | 更新时间                             |

### generate 函数

`generate()` 无需声明参数。运行时从 Banyan 注入的全局数据读取输入，并返回：

```javascript
function generate() {
  return {
    citations: [], // 引注
    bibliography: [], // 参考文献列表
  };
}
```

`generate()` 可以写成 `async`，也可以返回 Promise。需要读取文件、查询多语言条目时，用异步写法会更方便。

### 编写与预览

- 推荐使用 Banyan 内置样式编辑器创建或编辑样式。编辑器提供模板、代码片段、语法
  高亮、错误提示和渲染预览。
- 也可在 Zotero 首选项的样式管理器中选择样式，并使用当前文库的条目生成预览。
- 外部编辑器可用于编辑 Zotero 数据目录中的样式文件。插件仓库内的开发与检查命令
  仅适用于仓库开发环境；样式作者可使用内置编辑器检查并预览样式。

建议先验证最小样式能够运行，再逐步增加参数和格式规则。

## 3. 输入数据

写样式时，数据主要来自这几处：

| 来源          | 提供什么                   | 从哪里读                |
| ------------- | -------------------------- | ----------------------- |
| `contexts`    | 文档里已经有的引注和条目   | `contexts`、`ctx.cites` |
| Citation 参数 | 用户对这一条引注的选择     | `ctx.params`            |
| Cite 参数     | 用户对这一个被引条目的选择 | `cite.params`           |

`contexts` 表示文档中已有的引注和条目；参数表示用户为样式提供的补充输入。两者共同构成
`generate()` 的输入。

### 3.1 contexts：文档里的引注和条目

`contexts` 是一个数组，每个元素代表文档中的一条引注：

```javascript
for (const ctx of contexts) {
  console.log(ctx.id); // 引注 ID
  console.log(ctx.page); // 引注所在页码
  console.log(ctx.cites); // 这条引注引用的条目
}
```

每个 `ctx` 有：

- `id`：引注 ID，返回结果时沿用该值，以便 Banyan 将生成结果对应到原引注；
- `cites`：这条引注包含的引用；
- `page`：引注所在页码；
- `params`：Citation 参数的值，见 3.2。

每个 `cite` 有：

- `item`：被引用的 Zotero 条目；
- `params`：Cite 参数的值，见 3.3。

例如：

```javascript
const firstCite = contexts[0].cites[0];
const title = firstCite.item.title;
const year = String(firstCite.item.date || "").slice(0, 4);
```

`contexts` 和条目数据是只读的。读取不存在的字段时，通常会得到空字符串 `""`，而不是 `undefined`；因此可以安全地写 `item.title || "无题"`。

### 3.2 Citation 参数：整条引注的输入

如果用户需要在每次插入引注时选择“完整引用/略写”“是否显示 DOI”等，就声明 `CITATION_PARAMS`：

```javascript
const CITATION_PARAMS = [
  {
    id: "mode",
    kind: "state",
    label: "引用方式",
    states: {
      full: "完整",
      short: "略写",
    },
    defaultValue: "full",
  },
];
```

用户在引注窗口里选择后，`generate()` 里这样读：

```javascript
function generate() {
  return {
    citations: contexts.map((ctx) => ({
      id: ctx.id,
      content: text(ctx.params?.mode === "short" ? "略写" : "完整"),
    })),
    bibliography: [],
  };
}
```

要点：

- 每个参数必须有 `id`、`kind`、`label`；
- `kind` 是 `state` 或 `value`；
- `defaultValue` 是默认值；
- 读值时用 `ctx.params.<id>`；
- 没有声明参数时，`ctx.params` 是空对象。

### 3.3 Cite 参数：单个条目的输入

如果用户需要为“这一条引注中的这个条目”填写页码、章节、卷号等，就声明 `CITE_PARAMS`：

```javascript
const CITE_PARAMS = [
  {
    id: "locator",
    kind: "value",
    label: "页码",
    defaultValue: "",
  },
];
```

读取方式：

```javascript
function generate() {
  return {
    citations: contexts.map((ctx) => ({
      id: ctx.id,
      content: group(
        ctx.cites.map((cite) => affix(cite.params?.locator, "，第", "页")),
        "；",
      ),
    })),
    bibliography: [],
  };
}
```

Cite 参数的值属于**这一次引用**，不是条目的永久属性。同一条目在不同引注里可以有不同的页码。

大多数样式只需要 Citation 参数和 Cite 参数这两类输入；`STYLE_OPTIONS` 属于第 5 节的进阶功能，不写也不影响样式工作。

### 3.4 参数类型速览

| 类型    | 适合做什么                     | 值的样子                           |
| ------- | ------------------------------ | ---------------------------------- |
| `state` | 开/关或固定选项                | 布尔，或 `states` 的 key（字符串） |
| `value` | 普通文字、数字、日期、富文本   | 字符串（rich 是受限标记字符串）    |
| `list`  | 可重复的多行输入，例如多个页码 | 行对象数组；仅 Cite 级可用         |

几个例子：

```javascript
// 开关
{ id: "showDOI", kind: "state", label: "显示 DOI", defaultValue: false }

// 固定选项
{
  id: "mode",
  kind: "state",
  label: "引用方式",
  states: { full: "完整", short: "略写" },
  defaultValue: "full",
}

// 普通文本，可给推荐值
{
  id: "locator",
  kind: "value",
  label: "页码",
  defaultValue: "",
  presets: ["1", "2", "3"],
}

// 富文本：值是受限标记字符串，编辑器负责预览/编辑
{
  id: "comment",
  kind: "value",
  label: "说明",
  format: "rich",
  defaultValue: "",
}
```

`list` 只用在 `CITE_PARAMS`，适合“多个页码、多个条款”这类重复输入：

```javascript
const CITE_PARAMS = [
  {
    id: "pages",
    kind: "list",
    label: "页码",
    fields: [
      { id: "start", kind: "value", label: "起" },
      { id: "end", kind: "value", label: "止" },
    ],
  },
];
```

它的值是行对象数组，例如 `[{ start: "33", end: "35" }]`。

> `format: "rich"` 与普通 `value` 的区别：普通值适合普通文字；rich 值适合“说明文字里有局部斜体/上标”的情况。样式拿到的是标记字符串，可按输出层规则使用。

### 3.5 参数的适用性、强制值和校验（进阶）

大多数样式只需要 `defaultValue`。需要根据其他值隐藏、锁定或校验参数时，再加
`applicable`、`forcedValue` 或 `validate`。

```javascript
const CITE_PARAMS = [
  {
    id: "locator",
    kind: "value",
    label: "页码",
    defaultValue: "",
    applicable: (cite, citation, options) => true,
    forcedValue: (cite, citation, options) => null,
    validate: (value, cite, citation, options) =>
      value === "" || /^\d+$/.test(value) || "只能填数字",
  },
];
```

- `applicable`：返回 `false` 时参数不适用，宿主隐藏；不执行 `forcedValue` / `validate`；
- `forcedValue`：返回一个值表示锁定；返回 `null` 表示自由；不要返回 `undefined`；
- `validate`：第一个参数是当前值，返回 `true` 表示合法，返回字符串表示错误提示；
- 强制值、隐藏值不跑用户级 `validate`。

依赖按声明顺序从前至后求值：后面的参数能看到前面参数的 effective 值；依赖应写在被
依赖参数之后。输入阶段拿不到全文位置，首引/紧邻/前注号仍在 `generate()` 里判断。

不需要这些能力时，完全不用写它们。

## 4. 输出：citations 和 bibliography

`generate()` 返回两个数组。

### 4.1 citations

`intext-citation` 的每一项：

```javascript
{
  id: ctx.id,
  content: text("(Smith, 2024)"),
}
```

`note-citation` 的每一项多一个 `reference`：

```javascript
{
  id: ctx.id,
  content: text("Smith, John. Book Title. 2024."),
  reference: text("1"),
}
```

- `id`：沿用 `ctx.id`，用来替换文档里的原引注；
- `content`：引注正文，单个 Unit；
- `reference`：脚注标记，单个 Unit，可省略。

### 4.2 bibliography

参考文献列表是数组，每一项可以是：

- `bibliography-entry`：一条参考文献；
- `bibliography-title`：列表标题，例如“参考文献”。

```javascript
const bibliography = [
  {
    id: "item-1",
    type: "bibliography-entry",
    content: text("Smith, John. Book Title. 2024."),
  },
];
```

如果多个引注引用同一条目，通常先去重再生成：

```javascript
const unique = new Map();
for (const ctx of contexts) {
  for (const cite of ctx.cites) {
    unique.set(cite.item.id, cite.item);
  }
}

const bibliography = Array.from(unique.values()).map((item) => ({
  id: String(item.id),
  type: "bibliography-entry",
  content: text(`${item.firstCreator || "佚名"}. ${item.title || "无题"}.`),
}));
```

## 5. 按需扩展：全局选项、快捷标记、字段检查

这一节的功能不是写样式所必需的。只有在确实需要时再使用。

### 5.1 全局选项：整篇文档共用

`STYLE_OPTIONS` 声明文档级参数，用户在一个地方设置，所有引注共享。值通过全局 `options` 读取：

```javascript
const STYLE_OPTIONS = [
  {
    id: "showDOI",
    kind: "state",
    label: "显示 DOI",
    defaultValue: false,
  },
  {
    id: "maxNames",
    kind: "value",
    label: "最多列作者数",
    defaultValue: "3",
  },
];

function generate() {
  const showDOI = options.showDOI;
  const maxNames = Number(options.maxNames || 3);
  // ...
}
```

样式级参数使用同一套 `state` / `value`；不支持 `list`，也不支持 `applicable`。它适合“整篇文档统一”的设置；只影响一条引注的选择，仍应使用 Citation/Cite 参数。

### 5.2 条目快捷标记

`ITEM_FIELD_PRESETS` 在条目右键菜单里增加“快捷标记”，用来批量写入某个字段：

```javascript
const ITEM_FIELD_PRESETS = [
  {
    id: "classic",
    label: "古籍",
    visible: (item) => item.itemType === "book",
    fields: { type: "classic" },
  },
];
```

把值写成 `null` 时，应用标记会询问用户要填什么：

```javascript
{
  id: "foreign-law",
  label: "外国法（补法域）",
  fields: { jurisdiction: null },
}
```

这类功能用于维护样式要求的条目字段，不直接参与引注或参考文献的输出生成。

### 5.3 条目字段检查

`ITEM_FIELD_VALIDATORS` 在条目右键菜单里增加“检查字段”，按条目类型声明检查规则：

```javascript
const ITEM_FIELD_VALIDATORS = {
  book: [
    {
      description: "必须填写标题",
      check: (item) => String(item.title || "").trim() !== "" || "缺少标题",
    },
  ],
};
```

`check` 可以返回 `true`、`false` 或错误说明；也可以写成异步函数，Banyan 会等待结果。它只读取条目，不会修改数据。

## 6. Unit 工具速查

`content` 里可以放字符串，也可以放 Unit。Unit 工具用来组合文字、加格式、处理空值。

| 工具         | 作用                           | 例子                                 |
| ------------ | ------------------------------ | ------------------------------------ |
| `text`       | 创建普通文字                   | `text("Smith")`                      |
| `group`      | 把多个 Unit 连起来，可加分隔符 | `group([a, b], ", ")`                |
| `affix`      | 给 Unit 加前后缀               | `affix(year, " (", ")")`             |
| `fallback`   | 取第一个有内容的候选           | `fallback([title, text("无题")])`    |
| `when`       | 条件成立时输出                 | `when(item.doi, text("DOI"))`        |
| `textCase`   | 转换大小写                     | `textCase(name, "title")`            |
| `withStyle`  | 给整段加格式                   | `withStyle(title, { italic: true })` |
| `link`       | 给整段加链接                   | `link(text("PDF"), url)`             |
| `plainText`  | 取纯文本，适合排序             | `plainText(unit)`                    |
| `htmlToUnit` | 把外部标记字符串转成 Unit      | `htmlToUnit(markup)`                 |
| `unitToHtml` | 把 Unit 转成标记字符串         | `unitToHtml(unit)`                   |

几个常用写法：

```javascript
// 加粗
withStyle(text("注意"), { bold: true });

// 斜体 + 上标
text("2", { script: "superscript" });

// 年份加括号
affix(text("2024"), " (", ")");

// 空值回退
fallback([text(item.title), text("无题")]);

// 条件输出
when(item.doi, text(` DOI: ${item.doi}`));
```

`text` 和 `withStyle` 的样式对象支持 `italic`、`bold`、`script`（`superscript` / `subscript`）、`color` 和 `backgroundColor`。颜色使用 HEX 格式，可以用 [HTML Color Picker](https://htmlcolorcodes.com/color-picker/) 这样的工具选取。

`group` 会自动跳过空片段，只在两个有内容的片段之间插入分隔符；`affix` 的主体为空时，前后缀也不会输出。

`textCase` 支持：

- `lower`：全小写；
- `upper`：全大写；
- `small-caps`：小型大写；
- `title`：标题格式；
- `sentence`：句子格式；
- `name`：人名格式。

`htmlToUnit` 用于外部输入或旧数据里的受限标记；普通条目字段通常直接 `text(item.title)` 即可。`unitToHtml` 主要用于调试、测试或需要字符串的场景，不是生成引注的常规步骤。

### 其他常用工具

| 工具                           | 作用                          |
| ------------------------------ | ----------------------------- |
| `callStyle(id, contexts)`      | 运行声明的另一个样式          |
| `loadResource(id)`             | 读取 `assets/<id>` 声明的资产 |
| `getExtraValue(item, key)`     | 读取条目 `extra` 字段中的值   |
| `uuid()`                       | 生成 UUID                     |
| `console.log` / `console.warn` | 调试输出 / 报告问题           |
| `safeString(value)`            | 安全地转成字符串              |
| `safeRecord(value)`            | 安全地按对象读取              |

`callStyle()` 与 `loadResource()` 都必须先声明（`STYLE_DEPENDENCIES` 最多 4 个，`STYLE_RESOURCES` 最多 8 个）。两者都返回 `{ ok: true, … }` 或 `{ ok: false, reason, message }`，失败时不抛出：调用方要自己写回退分支。被调用的样式必须已安装，且 `INFO.citationType` 与调用方一致；资源 id 就是 `banyan/assets/<id>` 的文件名（小写字母、数字和短横线，无扩展名），读取有 4 MiB 与 10 秒上限，成功结果是实例级冻结快照。没有 `readText` / `readJSON` / `readBytes` 这类低层读取工具。

## 7. 进阶功能

### 7.1 引注超链接

给引注加网页链接：

```javascript
return {
  id: ctx.id,
  content: link(content, "https://example.com"),
};
```

让引注跳到参考文献列表中的对应条目：

```javascript
content: link(content, `banyan://entry/${item.id}`),
```

参考文献项目的 `id` 要与这里的目标一致。

### 7.2 多语言条目

Banyan 可以把两个条目关联成“多语言条目”。样式里用 `getMultilingualItem()` 读取另一种语言：

```javascript
async function generate() {
  const citations = contexts.map((ctx) => ({
    id: ctx.id,
    content: text(ctx.cites[0].item.title || ""),
  }));

  const unique = new Map();
  for (const ctx of contexts) {
    for (const cite of ctx.cites) {
      unique.set(cite.item.id, cite.item);
    }
  }

  const bibliography = [];
  for (const item of unique.values()) {
    const enItem = await getMultilingualItem(item, "en");
    bibliography.push({
      id: String(item.id),
      type: "bibliography-entry",
      content: text(enItem.title || item.title || ""),
    });
  }

  return { citations, bibliography };
}
```

`getMultilingualItem()` 是异步函数，记得在 `generate()` 里 `await`。没有找到对应语言时，它会返回原条目。

## 8. 常见错误

### content 必须是单个 Unit

错误：

```javascript
content: [text("A"), text("B")];
```

正确：

```javascript
content: group([text("A"), text("B")], " ");
```

### 使用 group 组合 Unit

`group` 能保留每段的格式；直接用 `+` 或先拼成字符串，会丢掉格式，甚至得到 `"[object Object]"`。给 Unit 数组加分隔符时，把分隔符交给 `group` 的第二个参数：

```javascript
group(
  names.map((name) => withStyle(name, { italic: true })),
  ", ",
);
```

### 读取缺失字段

`contexts` 和条目是安全视图，缺失字段通常是 `""`。不要假设它一定是 `undefined`，用 `||` 或 `safeString()` 处理空值。

### 异常处理

建议用 `try/catch` 包住主流程，出错时返回空结果，避免整个刷新失败：

```javascript
function generate() {
  try {
    // 主逻辑
    return { citations: [], bibliography: [] }; // 换成实际结果
  } catch {
    return { citations: [], bibliography: [] };
  }
}
```

### 其他约定

- 不要使用 `eval`、`with`、`new Function`；
- 不要依赖 `window` 或 `globalThis` 上的自定义属性；
- 不要使用 `setTimeout` / `setInterval`；
- 提交前用样式编辑器的预览检查一次。

## 9. 完整模板

下面是一个不依赖进阶功能的完整骨架：

```javascript
const INFO = {
  id: "my-style",
  title: "我的样式",
  description: "作者-年份示例",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Your Name" }],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "2026-01-01",
};

const CITATION_PARAMS = [
  {
    id: "mode",
    kind: "state",
    label: "引用方式",
    states: {
      full: "完整",
      short: "略写",
    },
    defaultValue: "full",
  },
];

const CITE_PARAMS = [
  {
    id: "locator",
    kind: "value",
    label: "页码",
    defaultValue: "",
  },
];

function generate() {
  try {
    const unique = new Map();
    for (const ctx of contexts) {
      for (const cite of ctx.cites) {
        unique.set(cite.item.id, cite.item);
      }
    }

    const citations = contexts.map((ctx) => {
      const cites = ctx.cites.map((cite) => {
        const locator = safeString(cite.params?.locator);
        const year = String(cite.item.date || "").slice(0, 4);
        return group([
          text(cite.item.firstCreator || cite.item.title || "佚名"),
          text(year ? ` (${year})` : ""),
          text(locator ? `，第${locator}页` : ""),
        ]);
      });
      const mode = ctx.params?.mode === "short" ? "略：" : "";
      return {
        id: ctx.id,
        content: group([text(mode), group(cites, "；")]),
      };
    });

    const bibliography = Array.from(unique.values()).map((item) => ({
      id: String(item.id),
      type: "bibliography-entry",
      content: text(`${item.firstCreator || "佚名"}. ${item.title || "无题"}.`),
    }));

    return { citations, bibliography };
  } catch {
    return { citations: [], bibliography: [] };
  }
}
```

需要全局选项、快捷标记或字段检查时，再参考第 5 节加入即可。
