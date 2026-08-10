addon-name = 榕树

menuitem-relate-items = 关联多语条目
menuitem-style-editor = Banyan 样式编辑器
menuitem-create-output = 创建引注/参考文献表
menuitem-write-extra-field = 写入其他字段
item-tree-citation-column = 引注

item-section-multilingual-head-text =
    .label = 榕树：多语关联
item-section-multilingual-sidenav-tooltip =
    .tooltiptext = 多语关联
item-section-multilingual-add-tooltip =
    .tooltiptext = 添加多语关联
item-section-multilingual-empty = 暂无多语关联条目
item-section-multilingual-loading = 加载中...
item-section-multilingual-summary = { $count } 条多语关联

link-multilingual-item-error-different-library = 只能关联同一文库中的条目。
relate-multilingual-item-error-different-library = 只能将同一文库中的条目标记为多语关联。
relate-multilingual-item-error-different-item-type = 只能将相同条目类型的条目标记为多语关联。
relate-multilingual-item-error-same-item = 不能将条目与自身标记为多语关联。

extra-field-write-failed = 写入其他字段失败：{ $message }
extra-field-error-invalid-key = 字段名无效，请重新输入。
extra-field-conflict-title = 其他字段已存在
extra-field-conflict-message = 条目“{ $item }”中的“{ $key }”已存在，当前值：{ $existing }
extra-field-conflict-skip = 跳过
extra-field-conflict-overwrite = 覆盖
extra-field-conflict-apply-to-remaining = 将此选择应用到本次会话中其余条目
extra-field-write-summary = 处理完成：已更新 { $updated } 项，已跳过 { $skipped } 项{ $aborted ->
    [1] ，并已中止后续处理。
   *[0] 。
}
