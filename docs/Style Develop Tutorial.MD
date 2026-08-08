# Banyan 样式开发入门

Banyan Style 是配合 Banyan for Zotero 使用的 JavaScript 脚本，用于生成参考文献和引用。

## 术语约定

为了方便下文的叙述，我们约定以下术语：

- 样式（Style）：规定参考文献内容和排版格式的规范，如 APA、MLA、Chicago 等，有时特指 Banyan Style 脚本。
- 条目（Item）：即 Zotero 中的条目，是包含文献出版信息的一条记录。
- 引注（Citation）：在正文中标注引用了文献的标记。其中 `intext-citation` 是最常用的引注类型，它仅在正文中出现标记，而 `note-citation` 则在正文插入一个引用标记。
- 引用（Cite）：把条目添加到引注中的行为，在 Banyan 的语境中，一次引用对应一个条目。
- 参考文献列表（Bibliography）：集中列出参考文献具体信息的列表，一般出现在文档末尾或章节末尾。
- 参考文献项目（Bibliography Entry）：参考文献列表中的一项，通常对应一个条目，但在复合编码的样式中，一个参考文献项目中可能包含多个条目。

## JavaScript 基础

编写 Banyan Style 需要一定的 JavaScript 基础。如果你对 JavaScript 不太熟悉，建议先阅读一些入门教程，如 [MDN JavaScript 教程](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide)。JavaScript 很容易入门，但也包含不少深度的概念，为了避免初学者迷失在浩瀚的教程中，这里列举一些编写 Banyan Style 需要了解的概念。

- 标量：`Number`、`String`、`Boolean`、`Null`、`Undefined` 等。
- 数据容器：`Array`、`Object` 等。
- 函数：匿名函数、箭头函数、异步函数的声明及调用。
- 流程控制：`if/else`、`switch/case`、`for/break/continue` 等。

在以上的概念中，`Array` 是我们最常用的数据容器，因为我们总是需要在样式中处理用户插入的一系列引注，因此你需要重点掌握它的几个方法：

- `filter`：返回一个新数组，该数组中的元素是通过检查指定数组中符合条件的元素。
- `map`：返回一个新数组，该数组中的元素是通过对指定数组中每个元素进行指定操作后返回的结果。
- `find`：返回数组中满足条件的第一个元素。
- `findIndex`：返回数组中满足条件的第一个元素的索引。

## 准备环境

JavaScript 是文本脚本，理论上你可以用任意文本编辑器编写脚本，但为了方便，推荐你使用以下方案：

- Banyan for Zotero 插件内置的脚本编辑器。它是一个集成环境，提供了模板、代码片段、语法高亮、错误提示、渲染预览等功能。
- Zotero 首选项中的样式管理器。选中一个样式后可以点击“预览样式”，或双击样式行，用当前文库中已选中的常规条目生成快速预览。
- [Visual Studio Code](https://code.visualstudio.com/)。你可以在安装 Banyan for Zotero 插件后，使用 VS Code 打开 Banyan 的数据目录，并在集成终端中运行 `pnpm install` 安装依赖包。之后，你可以用 `pnpm run lint:check` 检查代码问题。

这两个方案都需要你准备 Node.js 环境。如果你没有安装 Node.js，请按照 [Node.js 安装指南](https://nodejs.org/zh-cn/download/) 安装。

## 你的任务

在介绍样式的具体结构之前，我们先来认识一下你的任务：输入 `contexts`，生成 `citations` 和 `bibliography`。

### contexts

`contexts` 是样式内的全局对象，代表用户提供的引注。`contexts` 是一个数组，数组中的每个元素都是 `CitationContext` 类型的对象，`CitationContext` 包含以下属性：

- `id`：引注的 ID，用于标识引注。
- `cites`：引注中的引用。
- `page`：引注在文档中的页码。
- `params`：引注的其它的参数，用于控制样式的生成。

而 `cites` 也是一个数组，数组中的每个元素都是 `Cite` 类型的对象，`Cite` 包含以下属性：

- `item`：引用的条目。
- `params`：引用的其它的参数，用于控制样式的生成。

### Unit 对象

参考文献格式规范除了规定参考文献的内容之外，还规定了文本的格式。Banyan 用 `Unit` 这个概念来表示带有字符格式的文本，`Unit` 可以是简单的字符串或者纯数字，或者 [Unit 工具](#unit工具)提到的类型。

脚本输出对象里的字段名叫 `content`，它接收的是单个 `Unit`。宿主在渲染前会把 `content` 编译成 `RichText`，即 `{ text, marks }` 结构，其中 `text` 是完整纯文本，`marks` 是加粗、斜体、链接等作用区间。

`marks` 中的区间使用 JavaScript 字符串偏移：`start` 为起始位置，`end` 为排他结束位置，单位是 UTF-16 code unit。样式作者通常不需要手写 `RichText`；请继续返回 `Unit`，由宿主统一编译。

### citations

`citations` 即引注组成的数组。我们在[术语约定](#术语约定)中提到过，引注有 `intext-citation` 和 `note-citation` 两种类型，它们所具有的属性不同。

`intext-citation` 类型的引注是具有如下属性的对象：

- `id`：引注的 ID，用于标识引注，一般你只需要沿用 `contexts` 中的 ID，这样你的引注就会取代旧的引注。
- `content`：引注内容，是单个 `Unit`。如果内容由多个片段组成，请使用 `group([...])` 组合。

`note-citation` 类型有正文标记和脚注区内容两部分，它包括以下属性：

- `id`：引注的 ID，用于标识引注，一般你只需要沿用 `contexts` 中的 ID，这样你的引注就会取代旧的引注。
- `content`：脚注内容，是单个 `Unit`。如果内容由多个片段组成，请使用 `group([...])` 组合。
- `reference`：正文中的标记，是单个 `Unit`。这个属性可以留空，此时脚注标记由字处理器自动分配。

### bibliography

`bibliography` 即参考文献列表。它是一个数组，数组中的元素可能是 `BibliographyEntry` 或者 `BibliographyTitle` 类型的对象。

`BibliographyEntry` 类型表示一个参考文献列表项目，有如下属性：

- `id`：参考文献列表项目的 ID，用于标识项目，可作为超链接的跳转靶点。
- `type`：必须是 `bibliography-entry`，用以自明身份。
- `content`：参考文献列表项目的内容，是单个 `Unit`。如果内容由多个片段组成，请使用 `group([...])` 组合。

`BibliographyTitle` 类型表示参考文献列表的标题，有如下属性：

- `type`：必须是 `bibliography-title`，用以自明身份。
- `content`：参考文献列表的标题内容，是单个 `Unit`。如果内容由多个片段组成，请使用 `group([...])` 组合。

## 样式结构

Banyan Style 是一个 JavaScript 文件，它要求你必需声明 `INFO` 对象和 `generate()` 函数，此外你还可以声明 `UI` 对象用于定义输入控件。

### INFO 对象

`INFO` 对象用于描述样式的元信息，如 ID、标题、描述、作者、标签、文档链接、许可协议、更新时间等，你可以参照下面的例子来写出 `INFO` 对象。

```javascript
const INFO = {
  id: "your-style-id",
  title: "Your Style Name",
  description: "简要描述",
  // 引注类型，可选值：intext-citation、note-citation
  citationType: "intext-citation",
  creator: [
    // 样式的原作者、维护者信息
    {
      name: "Your Name",
      email: "your-email@example.com",
      uri: "https://example.com/",
      type: "author",
    },
  ],
  tags: [
    // 和样式有关的标签，便于搜索和筛选样式
    "numeric",
  ],
  documentation: [
    // 文档链接
    "https://example.com/docs",
  ],
  license: "MIT",
  updated: "2026-01-01",
};
```

### generate 函数

`generate()` 函数用于生成引注和参考文献列表，相比 `INFO`，它就复杂多了，它可以用下面的结构来描述：

```javascript
function generate() {
  /* 复杂的逻辑 */
  return { citations, bibliography };
}
```

### UI 对象

如果你需要获取用户的输入来生成参考文献，可以用 `UI` 对象定义这些控件，它们将会显示在用户插入引注的窗口中。

UI 对象结构如下：

```javascript
const UI = {
  citation: [
    // 控件列表
  ],
  cite: [
    // 控件列表
  ],
};
```

显然，`citation` 和 `cite` 属性内的控件分别对引注和引用起效。

所有控件对象都有这几个属性：

- `id`：控件的 ID，用于标识控件。
- `type`：控件的类型，可选值有 `checkbox`、`select`、`input`。
- `label`：控件的标签，用于显示给用户。
- `disabled`：是否禁用控件，默认为 `false`。

对于 `cite` 属性中定义的控件，还可以携带 `itemType` 属性，它的值是一个 [Zotero 条目类型](https://www.zotero.org/support/kb/item_types_and_fields)组成的数组，使控件仅在指定的条目类型下可见。

`type` 属性取不同的值时，相应可取的组件属性不同：

- `checkbox`：`value` 属性表示控件的默认值，默认为 `false`。`r`n- `select`：`options` 属性是一个对象，对象中的键是选项的 ID，值是选项的标签。`value` 属性取其中一个键表示默认选中的选项。- `input`：`value` 属性表示控件的默认值，默认为空字符串。

在 `UI.citation` 和 `UI.cite` 中指定的控件，其获取的值会被分别存储到 `CitationContext` 和 `Cite` 对象的 `params` 属性。

## Unit工具

Banyan 提供了一些处理 `Unit` 对象的实用工具函数。

### text

`text` 函数用于把一个字符串转换成 `TextUnit` 对象。

```typescript
type text = (value: string, style?: RenderStyle) => TextUnit;
```

- `value`：要转换的字符串。
- `style`：可选的渲染样式，用于控制文本样式。

`RenderStyle` 对象具有以下属性：

- `italic`：是否斜体。
- `bold`：是否加粗。
- `script`：可选值为 `subscript`（下标）、`superscript`（上标）。
- `color`：使用 HEX 格式表示的颜色，你可以使用类似 [HTML Color Picker](https://htmlcolorcodes.com/color-picker/) 这样的在线工具来获取特定颜色的 HEX 代码。
- `backgroundColor`：背景颜色，同样使用 HEX 格式。

### group

`group` 函数用于把 `Unit` 数组内的 `Unit` 组合成一个 `GroupUnit` 对象。

```typescript
type group = (units: Unit[], delimiter?: Unit) => GroupUnit;
```

- `units`：要组合的 `Unit` 对象组成的数组。
- `delimiter`：可选的分隔符，用于分隔 `units` 中的 `Unit` 对象。

### affix

`affix` 函数用于在一个 `Unit` 对象前后添加 `Unit` 对象。

```typescript
type affix = (unit: Unit, prefix?: Unit, suffix?: Unit) => AffixUnit;
```

- `unit`：要添加前后缀的 `Unit` 对象。
- `prefix`：可选的前缀，用于添加到 `unit` 的前面。
- `suffix`：可选的后缀，用于添加到 `unit` 的后面。

### fallback

`fallback` 函数用于在 `Unit` 数组中寻找首个非空的 `Unit` 对象。

```typescript
type fallback = (units: Unit[]) => FallbackUnit;
```

- `units`：候选的 `Unit` 数组。

### when

`when` 函数用于根据条件返回一个 `Unit` 对象。

```typescript
type when = (condition: boolean, trueUnit: Unit, falseUnit: Unit) => WhenUnit;
```

- `condition`：判断条件。
- `trueUnit`：当 `condition` 为 `true` 时返回的 `Unit` 对象。
- `falseUnit`：当 `condition` 为 `false` 时返回的 `Unit` 对象。

### textCase

`textCase` 函数用于指定 `Unit` 中的文本大小写形式。

```typescript
type textCase = (
  unit: Unit,
  textCase: TextCase,
  ignoreWords?: string[],
) => TextCaseUnit;
```

- `unit`：目标 `Unit` 对象。
- `textCase`：格式化形式，详见下文。
- `ignoreWords`：忽略的单词列表，用于指定哪些单词不需要进行格式化。

`TextCase` 类型可能的值有：

- `lower`：全小写。
- `upper`：全大写。
- `small-caps`：小型大写字母。
- `title`：标题格式，即除了冠词、连词、介词和助词外，其他单词首字母大写。
- `sentence`：句子格式，即首个字母大写，其余字母小写。
- `name`：人名格式，即每个单词首字母大写，且撇号后面的首字母也大写。

### withStyle

`withStyle` 函数用于设置 `Unit` 的渲染样式。

```typescript
type withStyle = (unit: Unit, style: RenderStyle) => WithStyleUnit;
```

- `unit`：目标 `Unit` 对象。
- `style`：要设置的渲染样式。

### link

`link` 函数用于为整个 `Unit` 指定超链接。即使这个 `Unit` 内部包含多个不同视觉样式的片段，标准化输出也会生成一个连续的链接区间。

```typescript
type link = (unit: Unit, link: string) => LinkUnit;
```

- `unit`：目标 `Unit` 对象。
- `link`：链接目标，支持 `https://`、`http://`、`doi:` 和 `banyan://entry/...`。

### plainText

`plainText` 函数用于把一个 `Unit` 对象转换成纯文本，这在用作排序键时特别有用。

```typescript
type plainText = (input: Unit | Unit[]) => string;
```

- `input`：要转换的 `Unit` 对象或 `Unit` 对象组成的数组。

## 其他工具

Bnayan 还提供了其他实用的工具：

- `uuid()`：生成一个 UUID。
- `readText(relPath)`：读取 Zotero 数据目录下 `banyan` 目录内的文件内容，返回字符串。
- `readBytes(relPath)`：读取 Zotero 数据目录下 `banyan` 目录内的文件内容，返回字节数组。
- `readJSON(relPath)`：读取 Zotero 数据目录下 `banyan` 目录内的文件内容，返回 JSON 对象。

文件读取不设置大小硬限制；建议只读取来源明确、格式固定、已经预清洗的小型数据文件，避免把过大的文本、JSON 或二进制内容一次性读入。

- `getExtraValue(item, key, mode)`：读取条目的 `item.extra` 字段中的值，返回字符串。可选参数 `mode` 指定为 `"array"` 时返回字符串数组。`item.extra` 的键在条目转换时统一归一化为 kebab-case（如 `My Key`/`AuthorID` → `my-key`/`author-id`），`key` 需使用归一化后的形式。
- `debug(...values)`：脚本被执行的时候在 Zotero 控制台中打印调试信息。
- `safeRecord(object)`：返回一个只读对象，取不存在的属性时返回空字符串 `""`，而不是 `undefined`。
- `safeString(value)`：返回一个字符串，字符串和数字返回字面值，其他返回空字符串 `""`。

## 进阶效果

### 引注超链接

可以为引注添加超链接实现更丰富的交互体验。

如果添加指向互联网的超链接，只需用 `link(unit, href)` 包裹目标 `Unit`。例如：

```javascript
function generate() {
  /* 复杂的逻辑 */
  const citations = contexts.map((ctx) => {
    /* 复杂的逻辑 */
    const content = genCitation(ctx);
    const url = getURL(ctx);
    return {
      id: ctx.id,
      content: link(content, url),
    };
  });
  return { citations, bibliography };
}
```

如果想让引注的超链接指向参考文献列表项目，则需要对应设置引注的 `link(...)` 目标和参考文献列表项目的 `id` 属性。例如：

```javascript
function generate() {
  /* 复杂的逻辑 */
  const citations = contexts.map((ctx) => {
    /* 复杂的逻辑 */
    const content = genCitation(ctx);
    const target = getTargetItem(ctx);
    return {
      // 这是 Citation 自身的 id，沿用自 Context
      id: ctx.id,
      // 这里的 target.id 对应目标 BibliographyEntry 的 id
      content: link(content, `banyan://entry/${target.id}`),
    };
  });
  const items = getItems(contexts);
  const bibliography = items.map((item) => {
    const content = genBibliography(item);
    return {
      // 这是 BibliographyEntry 的 id
      id: item.id,
      type: "bibliography-entry",
      content,
    };
  });
}
```

上面的例子中，使用 `target.id` 构造 `banyan://entry/...` 的引注，将会指向 `id` 属性和 `target.id` 相同的 `bibliography-entry`。

### 多语言条目

有时候，你可能需要同时输出一个条目的多语言信息（例如，同时输出其英文信息和中文信息）。为了满足这种需求，Banyan 引入了“多语言条目”的概念。不同于 Endnote 或者 CSL 在同一个条目上预设字段来填写多语言信息，Banyan 允许你直接指定若干个选中的条目为“多语言”关系，然后在样式脚本中方便地使用目标条目在指定语言下的字段。

假设你现在有一个中文条目，你想同时输出它的英文信息。先按如下步骤创建多语言条目：

1. 在 Zotero 中选中你要输出的条目。
2. 右键打开快捷菜单，执行“创建副本”。
3. 对照出版商网页或者条目的全文，在副本中填写英文信息，并注意将“语言”字段设为 `en`。
4. 选中这两个条目，右键打开快捷菜单，执行“关联多语言条目”。

现在你已经拥有了多语言条目，接着在样式脚本中，你就可以用 `getMultilingualItem(item, language)` 函数来获取指定语言下的条目信息，例如：

```javascript
function generate() {
  /* 复杂的逻辑 */
  const items = getItems(contexts);
  const bibliography = items.map((item) => {
    const enItem = getMultilingualItem(item, "en");
    const content = genBibEntry(item, enItem);
    return {
      id: item.id,
      type: "bibliography-entry",
      content,
    };
  });
  return { citations, bibliography };
}
```

## 最佳实践

这里有一些好的编码习惯，可以帮助你规避错误。

1. 避免使用 `this`。
2. 避免给全局变量挂载新属性。
3. 避免使用 `eval`。
4. 避免使用 `with`。
5. 避免使用 `new Function`。
6. 避免使用 `Function` 构造函数。
7. 避免使用 `setTimeout` 和 `setInterval`。
8. 谨慎使用 `Array.prototype.join`，推荐用 `group` 来处理。
