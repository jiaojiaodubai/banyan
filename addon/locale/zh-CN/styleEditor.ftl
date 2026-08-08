style-editor-title = Banyan 样式编辑器
style-editor-new = 新建
style-editor-open = 打开
style-editor-template-placeholder = 选择模板
style-editor-template-apply = 应用模板
style-editor-refresh = 刷新预览
style-editor-save = 保存为样式
style-editor-status-ready = 就绪
style-editor-status-lint-checking = 检查中...
style-editor-status-lint-done = 检查完成（{ $count } 个问题）
style-editor-status-no-items = 当前未选中普通条目，预览将使用占位数据
style-editor-status-saved = 已保存到 { $path }
style-editor-status-opened = 已打开 { $path }
style-editor-status-template = 已应用模板
style-editor-open-invalid-file = 文件不合法或无法读取：{ $path }
style-editor-save-overwrite-indexed = 已存在相同 ID（{ $id }）的样式索引（{ $title }）。是否覆盖？
style-editor-save-overwrite-file = 目标文件已存在：{ $path }。是否覆盖？
style-editor-external-change-detected = 样式文件已在编辑器外部更改：{ $path }
  保留本地内容，还是重新载入外部更改？
style-editor-external-change-conflict = 样式文件已在编辑器外部更改，且本地有未保存修改：{ $path }
  保留本地内容，还是重新载入外部更改并丢弃未保存本地修改？
style-editor-btn-keep-local = 保留本地
style-editor-btn-reload-external = 重新载入外部更改
style-editor-status-external-changed-keep-local = 已检测到外部更改，保留本地内容：{ $path }
style-editor-status-external-changed-reloaded = 已从磁盘重新载入外部更改：{ $path }
style-editor-status-style-required-for-citation = 请先载入或编写有效的样式/模板代码，再添加或编辑引注
style-editor-editor-hint =
  1. 使用顶部菜单中的“文件”载入模板或样式。
  2. 使用“运行”菜单刷新预览或检查代码。
  3. 使用“帮助”菜单在“信息”面板查看辅助内容。
style-editor-preview-title = 预览
style-editor-output-title = 输出
style-editor-input-title = 输入
style-editor-input-page-column = 页码
style-editor-input-cites-column = 引注文献
style-editor-input-empty-hint = 点击 + 添加引注行，然后双击行或按回车添加条目
style-editor-input-cites-placeholder = 双击行或按回车添加条目
style-editor-input-add-tooltip = 添加引注行
style-editor-input-remove-tooltip = 删除选中行
style-editor-input-move-up-tooltip = 上移选中行
style-editor-input-move-down-tooltip = 下移选中行
style-editor-input-fill-empty-cites-tooltip = 请先为未添加条目的引注行插入指定条目
style-editor-citations-heading = 引注
style-editor-bibliography-heading = 参考文献
style-editor-lint-heading = 信息
style-editor-empty-preview = 点击“刷新预览”以渲染样式输出
style-editor-empty-citations = 无引注输出
style-editor-empty-bibliography = 无参考文献输出
style-editor-preview-intext-label = 文内引注
style-editor-preview-note-reference-label = 脚注标记
style-editor-preview-note-text-label = 脚注正文
style-editor-error-prefix = 错误
style-editor-lint-no-issues = 无 lint 问题
style-editor-lint-disabled = ESLint 已禁用
style-editor-lint-group-errors = 错误（{ $count }）
style-editor-lint-group-warnings = 警告（{ $count }）
style-editor-lint-btn-open-node = 打开 Node.js 下载页
style-editor-lint-btn-retry = 重试
style-editor-lint-btn-ignore-once = 本次忽略
style-editor-lint-install-eslint = 无法运行 ESLint，未找到可执行文件：{ $path }。
  请按以下步骤完成安装：
  1. 如果尚未安装 Node.js，请先安装 Node.js。
  2. 打开终端并进入目录：{ $dir }
  3. 运行：pnpm install
  完成后返回编辑器并点击“重试”。

style-editor-menu-file = 文件
style-editor-menu-file-accesskey = F
style-editor-menu-file-new = 新建
style-editor-menu-file-load-template = 载入模板
style-editor-menu-file-load-style = 载入样式
style-editor-menu-file-save-as = 保存

style-editor-menu-edit = 编辑
style-editor-menu-edit-accesskey = E
style-editor-menu-edit-undo = 撤销
style-editor-menu-edit-redo = 重做
style-editor-menu-edit-cut = 剪切
style-editor-menu-edit-copy = 复制
style-editor-menu-edit-paste = 粘贴
style-editor-menu-edit-delete = 删除
style-editor-menu-edit-select-all = 全选
style-editor-menu-edit-find = 查找

style-editor-menu-view = 查看
style-editor-menu-view-accesskey = V
style-editor-menu-view-toggle-input = 输入
style-editor-menu-view-toggle-preview = 预览
style-editor-menu-view-toggle-info = 信息
style-editor-menu-view-font-size = 编辑器字体大小
style-editor-menu-view-font-size-increase = 放大
style-editor-menu-view-font-size-decrease = 缩小
style-editor-menu-view-font-size-reset = 重置

style-editor-menu-run = 运行
style-editor-menu-run-accesskey = R
style-editor-menu-run-refresh-preview = 刷新预览
style-editor-menu-run-lint = 检查代码

style-editor-menu-help = 帮助
style-editor-menu-help-accesskey = H
style-editor-menu-help-utility-functions = 工具函数
style-editor-menu-help-item-types = 条目类型

style-editor-toolbar-open = 打开
style-editor-toolbar-lint = 检查代码
style-editor-toolbar-run = 运行代码
style-editor-toolbar-save = 保存
