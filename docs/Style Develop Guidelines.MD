# Banyan 样式脚本编写规范

> 参考自 [Zotero 官方代码风格指南](https://www.zotero.org/support/dev/client_coding/coding_guidelines)，并结合 Banyan 插件的沙箱与参数机制。

## 必须实现的接口

- `INFO`：必需，包含样式元信息（id、title、updated、description 等）。
- `generate()`：必需，无参函数，读取全局 `contexts` 生成引用和参考文献，返回 `{ citations, bibliography }`。支持异步。
- `UI`：可选，定义参数表单（checkbox/select/input），用于弹窗收集用户输入。

## 全局变量

- `contexts`：只读全局变量，在 `generate()` 调用前由沙箱自动注入。脚本侧可视为 `ScriptContexts`，样式作者可在任意函数中读取。
- 读取对象上不存在的属性时，运行时会返回空字符串 `""`，而不是 `undefined`；数组索引和数组方法保持原生行为。

## 推荐风格与注意事项

### 1. 避免使用 `this`

- 推荐全部用顶层函数、常量、闭包，不要依赖 `this` 绑定。
- 如果确需用 `this`，请在样式内部自行 `.bind(...)`，但不建议。

### 2. 只导出必要接口

- 只需导出 `INFO`、`generate`、`UI`（可选）。
- 其他辅助函数/变量可在脚本内部自由定义，无需导出。

### 3. 避免污染全局

- 不要向全局对象（如 window、globalThis）挂载属性。
- 不要依赖外部环境变量。

### 4. 命名规范

- 变量、函数、常量命名采用小驼峰（camelCase），常量可用全大写。
- id/title/updated/description 等字段请用英文，便于国际化。

### 5. 兼容性与健壮性

- 支持 async/await，推荐 generate 为 async function 或返回 Promise。
- 不要使用 Node.js 专属 API（如 require、fs、path 等）。
- 不要使用仅在现代浏览器可用的新特性（如顶层 await 等），以保证兼容 Firefox ESR。

### 6. 参数机制

- 窗口只会根据样式脚本声明的 `UI` 渲染表单，不会预设任何默认控件。
- 这些参数会被合并到 `CitationContext` 里：
  - `CitationContext.params`：整条引用级别参数（由样式脚本自行定义）
  - `Cite.params`：单个被引条目的参数（如单条前后缀、页码覆盖等）
- 样式无需实现或导出 `getParams`/`setParams` 等函数；直接从 `contexts` 中读取即可。

### 7. 只读工具函数

- 可直接调用沙箱内置的只读工具函数：
  - `debug(...values)`
  - `readText(relPath)`
  - `readBytes(relPath)`
  - `readJSON(relPath)`
  - `uuid()`
- `getExtraValue(item, key)` 读取 `Item.extra` 中的值，默认返回 `string`；只有传入 `getExtraValue(item, key, "array")` 时才返回 `string[]`。`item.extra` 的键在条目转换时统一归一化为 kebab-case（如 `My Key`/`AuthorID` → `my-key`/`author-id`），`key` 必须使用归一化后的形式，查询端不做二次归一化。
- `getMultilingualItems(item)` 返回当前条目的其他多语版本列表；返回值是只读安全视图。
- `getMultilingualItem(item, language)` 按 `item.language` 匹配指定语言的多语版本；`language` 可传字符串或字符串数组，支持 `zh` 匹配 `zh-CN` 这类前缀形式，未命中时回退到当前条目。
- 仅允许访问 banyan 数据目录下的文件。路径会在宿主侧规范化并拒绝目录穿越或绝对路径绕过。`readText`/`readBytes`/`readJSON` 与 Zotero 底层 API 一样不设置文件大小硬限制；读取外部数据前应先约束文件来源、命名和格式，尽量使用已预清洗的小型数据文件，避免一次性读入过大的文本、JSON 或二进制内容。

### 8. 代码结构建议

- 推荐将主逻辑拆分为小函数，主入口只做调度。
- 辅助函数/常量建议用 `const` 定义。
- citations 和 bibliography 在同一个 `generate()` 函数内生成，天然共享作用域，方便实现相互引用（如 citation 链接到 bibliography entry）。
- 在提交样式前，至少用样式编辑器的渲染预览检查一次；如果只想快速确认已安装样式，可在 Zotero 文库中选中样例条目后，到首选项的样式管理器中预览。

### 9. 错误处理

- 推荐用 try/catch 包裹主流程，遇到异常时返回空数组/空字符串，避免抛出未捕获异常。

### 10. 注释与文档

- 重要逻辑、参数、边界条件请用英文或中英文注释。
- 建议在文件头部写明作者、版本、更新时间。

### 11. 渲染内容

- `generate()` 返回的 `citations` 和 `bibliography` 统一使用 `content` 字段。
- `content` 接收单个声明式 `Unit`；宿主标准化后会得到 `RichText { text, marks }`。最简单的叶子文本可以写成 `text("...")`，也可以手写 `{ value: "..." }`。
- `RichText.marks` 的 `start`/`end` 使用 JavaScript UTF-16 字符串偏移，`end` 为排他边界；这是渲染层契约，样式作者不应手工维护这些索引。
- 复杂拼接建议优先使用 `group(...)`、`affix(...)`、`fallback(...)`、`when(...)`、`textCase(...)` 这些声明式 helper，最终由宿主统一编译。多个片段应包装成 `group([...])` 或 `fallback([...])`，不要直接把 `Unit[]` 放到 `content`。
- 超链接应使用 `link(unit, href)` 包裹目标 `Unit`，不要把链接写进 `RenderStyle`。
- 尽量使用 `group([...], delimiter)` 拼接部件，谨慎使用 `Array.prototype.join`（最好不要用于 Unit 相关拼接）。
  - 原因：`join` 只能安全处理纯字符串数组；如果数组中混入 `group/affix/textCase` 等 helper 返回的 Unit 对象，会被 JavaScript 强制转成 `"[object Object]"` 并直接进入最终输出。
  - 错误示例：`firstName.split(" ").map(word => affix(word, "", ".")).join(" ")`
  - 正确示例：`group(firstName.split(" ").map(word => affix(word, "", ".")), " ")`

## 示例模板

```js
const INFO = {
  id: "your-style-id",
  title: "Your Style Name",
  description: "简要描述",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Your Name" }],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "2026-01-01",
};

const UI = {
  citation: [
    { id: "showDOI", type: "checkbox", label: "显示 DOI", value: false },
  ],
  cite: [],
};

function generate() {
  // 去重收集所有被引条目
  const unique = new Map();
  for (const ctx of contexts) {
    for (const cite of ctx.cites) {
      unique.set(cite.item.id, cite.item);
    }
  }

  // 生成 citations
  const citations = contexts.map((ctx) => ({
    id: ctx.id,
    content: text(
      ctx.cites.map((c) => c.item.firstCreator || c.item.title).join("; "),
    ),
  }));

  // 生成 bibliography
  const bibliography = Array.from(unique.values()).map((item) => ({
    id: String(item.id),
    type: "bibliography-entry",
    content: text((item.firstCreator || "Unknown") + ". " + item.title),
  }));

  return { citations, bibliography };
}
```
