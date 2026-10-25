# 验收样式

这些文件是 GUI 验收专用样式，不是随插件发布的预设。每个文件顶部的 `INFO.id` 是样式索引
使用的稳定标识；文件名可以不同，但不要改动 `INFO.id`，否则主文档中的用例引用会失效。

## 安装

- **只做样式编辑器预览**：打开样式编辑器，**文件 → 载入样式**，选择文件。
- **需要出现在样式选择、条目菜单或引注窗口**：把文件复制到
  `<Zotero 数据目录>/banyan/`，重启 Zotero 让样式索引重新载入。数据目录可在
  **编辑 → 设置 → 高级 → 文件和文件夹** 查看。

测试结束后删除复制进去的文件并重启，避免它们留在样式列表或条目菜单来源中。

## 清单

| 文件                         | `INFO.id`                 | 用途                                                                                                                                  |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `manual-gui-acceptance.js`   | `manual-gui-acceptance`   | 参数面板、引注窗口、富文本、快捷标记、字段检查、诊断日志；覆盖 state/value/list、preset、applicable、forcedValue、同步/异步 validator |
| `manual-gui-diagnostics.js`  | `manual-gui-diagnostics`  | 故意写错声明；用于载入期 findings、编辑器“沙箱反馈”和“检查代码”                                                                       |
| `manual-gui-disposable.js`   | `manual-gui-disposable`   | 保存后索引同步、删除样式后菜单回退；只删除这一份，不要删除随插件发布的样式                                                            |
| `manual-gui-output-error.js` | `manual-gui-output-error` | `generate()` 不返回结果；用于“只弹一次错误对话框、不写出任何内容”                                                                     |
| `host-contract-probe.js`     | `host-contract-probe`     | 多语能力探针；分别用 context item 和 `{ ...item }` 调用 `getMultilingualItems`，用于 HOST-01/01M                                      |

## 注意

- `manual-gui-acceptance.js` 的 `debug` 选项打开后，`generate()` 会写
  `trace` / `info` / `warn` / `error` 四条消息；HOST-02 用它检查日志去向。
- `manual-gui-diagnostics.js` 会故意产生重复参数 id、非法参数 kind、重复 preset id、
  未知键/类型名、validator 缺少 description/check 等载入期问题；它仍应能载入和生成。
- `manual-gui-disposable.js` 的 `INFO.id` 是保存和删除用例的目标。不要用它测试随插件发布
  的样式，也不要把它的 id 改成已有样式。
- 样式里的 `console` 输出和声明都按 Banyan Style 契约编写；修改样式后先在样式编辑器里
  刷新预览，确认它仍能载入，再用于 GUI 用例。
