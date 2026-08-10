addon-name = Banyan

menuitem-relate-items = Relate Multilingual Items
menuitem-style-editor = Banyan Style Editor
menuitem-create-output = Create Citation/Bibliography
menuitem-write-extra-field = Write Extra Field
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
relate-multilingual-item-error-same-item = The same item cannot be related as a multilingual item.

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
