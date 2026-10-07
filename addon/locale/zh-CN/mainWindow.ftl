# Menu items are localized through the Fluent DOM overlay, which replaces an
# element's children with a plain text node when the message has a value.
# Menu labels must therefore use attribute-only messages (`.label = ...`) so
# that the rendered `.menu-icon` and nested <menupopup> children are preserved.
addon-name =
    .label = 榕树

menuitem-relate-items =
    .label = 关联多语条目
menuitem-style-editor =
    .label = Banyan 样式编辑器
menuitem-create-output =
    .label = 创建引注/参考文献表
menuitem-write-extra-field =
    .label = 写入其他字段
menuitem-create-multilingual-item =
    .label = 创建多语言条目…
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
relate-multilingual-item-warning-skipped = 有 { $count } 对条目因条目类型或文库不同，未能建立多语关联。

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

multilingual-retype-title = 多语言条目
multilingual-retype-message = 条目“{ $item }”已改为“{ $type }”。关联的 { $count } 个多语言条目与它不再是同一类型；多语言组要求组内条目类型一致。
multilingual-retype-line = • { $title }（当前：{ $from }）
multilingual-retype-line-lost = • { $title }（当前：{ $from }）——将清除：{ $fields }
multilingual-retype-question = 是否将关联条目也改为“{ $type }”？该类型没有的字段会被清除。这次更改无法自动撤销，若不统一，请自行把该条目改回原类型。
multilingual-retype-confirm = 全部改为“{ $type }”
multilingual-retype-close = 关闭
multilingual-retype-blocked = 未更改关联的多语言条目：其中 { $count } 个含有作者，而“{ $type }”不支持作者。请先移除这些条目的作者，或把该条目改回原类型。
multilingual-retype-stale = 确认期间关联的多语言条目发生了变化，本次未更改任何条目。请重新改一次类型。
multilingual-retype-read-error = 无法读取关联的多语言条目，本次未做更改。请重新改一次类型。
multilingual-retype-error = 未更改关联的多语言条目：“{ $item }”已改为“{ $type }”，与它们不再是同一类型，请把该条目改回原类型，或重试把它们也改为“{ $type }”。
