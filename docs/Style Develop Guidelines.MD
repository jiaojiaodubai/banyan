# Banyan 样式脚本编写规范

> 参考自 [Zotero 官方代码风格指南](https://www.zotero.org/support/dev/client_coding/coding_guidelines)，并结合 Banyan 插件的沙箱与参数机制。

## 必须实现的接口

- `INFO`：必需，包含样式元信息（id、title、updated、description 等）。
- `generate()`：必需，无参函数，读取全局 `contexts` 生成引用和参考文献，返回 `{ citations, bibliography }`。支持异步。
- `UI`：可选，定义参数表单（checkbox/select/text），用于弹窗收集用户输入。

## 全局变量

- `contexts`：只读全局变量，在 `generate()` 调用前由沙箱自动注入。脚本侧可视为 `StyleScriptContexts`，样式作者可在任意函数中读取。
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
- `getExtraValue(item, key)` 读取 `Item.extra` 中的值，默认返回 `string`；只有传入 `getExtraValue(item, key, "array")` 时才返回 `string[]`。
- `getMultilingualItems(item)` 返回当前条目的其他多语版本列表；返回值是只读安全视图。
- `getMultilingualItem(item, language)` 按 `item.language` 匹配指定语言的多语版本；`language` 可传字符串或字符串数组，支持 `zh` 匹配 `zh-CN` 这类前缀形式，未命中时回退到当前条目。
- 仅允许访问 banyan 数据目录下的文件。

### 8. 代码结构建议

- 推荐将主逻辑拆分为小函数，主入口只做调度。
- 辅助函数/常量建议用 `const` 定义。
- citations 和 bibliography 在同一个 `generate()` 函数内生成，天然共享作用域，方便实现相互引用（如 citation 链接到 bibliography entry）。

### 9. 错误处理

- 推荐用 try/catch 包裹主流程，遇到异常时返回空数组/空字符串，避免抛出未捕获异常。

### 10. 注释与文档

- 重要逻辑、参数、边界条件请用英文或中英文注释。
- 建议在文件头部写明作者、版本、更新时间。

### 11. 渲染单元

- `generate()` 返回的 `citations` 和 `bibliography` 现在统一使用 `units` 字段。
- `units` 接收声明式 `Unit[]`；最简单的叶子文本可以写成 `text("...")`，也可以手写 `{ value: "..." }`。
- 复杂拼接建议优先使用 `group(...)`、`affix(...)`、`fallback(...)`、`when(...)`、`textCase(...)` 这些声明式 helper，最终由宿主统一编译。
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
    units: text(
      ctx.cites.map((c) => c.item.firstCreator || c.item.title).join("; "),
    ),
  }));

  // 生成 bibliography
  const bibliography = Array.from(unique.values()).map((item) => ({
    id: String(item.id),
    type: "bibliography-entry",
    units: text((item.firstCreator || "Unknown") + ". " + item.title),
  }));

  return { citations, bibliography };
}
```
