# Menu items are localized through the Fluent DOM overlay, which replaces an
# element's children with a plain text node when the message has a value.
# Menu labels must therefore use attribute-only messages (`.label = ...`) so
# that the rendered `.menu-icon` and nested <menupopup> children are preserved.
addon-name =
    .label = Banyan

menuitem-relate-items =
    .label = Relate Multilingual Items
menuitem-style-editor =
    .label = Banyan Style Editor
menuitem-create-output =
    .label = Create Citation/Bibliography
menuitem-write-extra-field =
    .label = Write Extra Field
menuitem-create-multilingual-item =
    .label = Create Multilingual Item…
item-tree-citation-column = Citation

item-section-multilingual-head-text =
    .label = Banyan: Multilingual Relations
item-section-multilingual-sidenav-tooltip =
    .tooltiptext = Multilingual relations
item-section-multilingual-add-tooltip =
    .tooltiptext = Add multilingual relation
item-section-multilingual-empty = No multilingual relations
item-section-multilingual-loading = Loading...
item-section-multilingual-summary = { $count } multilingual

link-multilingual-item-error-different-library = Only items in the same library can be linked as multilingual items.
relate-multilingual-item-error-different-library = Only items in the same library can be related as multilingual items.
relate-multilingual-item-error-different-item-type = Only items with the same item type can be related as multilingual items.
relate-multilingual-item-warning-skipped = { $count ->
    [one] One pair was not related: the two items differ in item type or library.
   *[other] { $count } pairs were not related: those items differ in item type or library.
}

extra-field-write-failed = Failed to write extra field: { $message }
extra-field-error-invalid-key = Invalid field key. Please enter a valid key.
extra-field-conflict-title = Extra Field Already Exists
extra-field-conflict-message = Item "{ $item }" already has "{ $key }" with value: { $existing }
extra-field-conflict-skip = Skip
extra-field-conflict-overwrite = Overwrite
extra-field-conflict-apply-to-remaining = Apply this choice to the remaining items in this session
extra-field-write-summary = Completed: updated { $updated }, skipped { $skipped }{ $aborted ->
    [1] , then canceled the remaining items.
   *[0] .
}

multilingual-retype-title = Multilingual Items
multilingual-retype-message = "{ $item }" is now { $type }. { $count ->
    [one] 1 linked multilingual item has
   *[other] { $count } linked multilingual items have
} a different type; a multilingual group expects every member to share one type.
multilingual-retype-line = • { $title } (now: { $from })
multilingual-retype-line-lost = • { $title } (now: { $from }) — clears: { $fields }
multilingual-retype-question = Change the linked items to { $type } as well? Fields that type does not have are cleared. This cannot be undone automatically, so if you don't, change this item's type back yourself.
multilingual-retype-confirm = Change All to { $type }
multilingual-retype-close = Close
multilingual-retype-blocked = The linked multilingual items were not changed: { $count ->
    [one] one of them has
   *[other] { $count } of them have
} creators, and { $type } does not support creators. Remove their creators first, or change this item back.
multilingual-retype-stale = The linked multilingual items changed while you were deciding, so nothing was changed. Change the type again to retry.
multilingual-retype-read-error = The linked multilingual items could not be read, so nothing was changed. Try changing the type again.
multilingual-retype-error = The linked multilingual items were not changed: "{ $item }" is now { $type } and no longer matches them. Change this item back, or retry changing them to { $type }.
