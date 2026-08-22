startup-begin = Addon is loading
startup-finish = Addon is ready

prefs-title = Banyan

styles-import-picker-title = Import Style
styles-import-picker-filter-style = Style (*.js)
styles-import-picker-filter-any = Any File
styles-import-overwrite-confirm = File { $filename } exists. Overwrite?
styles-overwrite-title = Overwrite Style
styles-delete-title = Delete Style
styles-delete-confirm = { $count ->
    [one] Delete the style "{ $title }"? This cannot be undone.
   *[other] Delete { $count } styles, including "{ $title }"? This cannot be undone.
}
styles-id-overwrite-confirm = The ID of the style "{ $aTitle }" conflicts with the existing style "{ $bTitle }". Overwrite?
styles-filename-overwrite-confirm = File "{ $filename }" exists. Overwrite?
styles-notfound-alert = Style "{ $title }" not found. Please ensure the style is properly installed.

inaccessible-items-title = Inaccessible Items Detected
inaccessible-items-intro = Some items in this document are not accessible:
inaccessible-items-count-cross-library = { $count } item(s) from another user's personal library
inaccessible-items-count-deleted = { $count } item(s) have been deleted
inaccessible-items-count-unknown-group = { $count } item(s) from inaccessible group libraries
inaccessible-items-reason-heading = This typically happens when:
inaccessible-items-reason-shared = A document was created using personal library items and shared with others
inaccessible-items-reason-deleted = Items were deleted after being cited
inaccessible-items-reason-group-access = Group library access was revoked
inaccessible-items-solution-heading = Recommended solutions:
inaccessible-items-solution-group = For collaboration: Create a shared Group library and use items from there
inaccessible-items-solution-group-link = See: https://www.zotero.org/support/groups
inaccessible-items-solution-import = For personal use: Import these items to your library (click "Import Items")
inaccessible-items-solution-ignore = Ignore: Continue without syncing these items (not recommended)
inaccessible-items-action-heading = What would you like to do?
inaccessible-items-action-import = Import Items: Import inaccessible items to your library
inaccessible-items-action-ignore = Ignore: Continue without syncing (items will use cached data)
inaccessible-items-action-cancel = Cancel: Stop the refresh operation
inaccessible-items-button-import = Import Items
inaccessible-items-button-ignore = Ignore
inaccessible-items-button-cancel = Cancel

inaccessible-items-desc-deleted = The item has been deleted from the library
inaccessible-items-desc-cross-library = The item is from another user's personal library
inaccessible-items-desc-unknown-group = The item is from a group library you don't have access to
inaccessible-items-desc-invalid-uri = The item URI format is invalid

server-origin-auth-intro = { $clientName } is requesting access to Banyan's local endpoints.
server-origin-auth-origin = Origin: { $origin }
server-origin-auth-prompt = Allow this origin to send Banyan integration requests?

server-cert-trust-intro = Word for Mac requires a trusted local HTTPS endpoint to communicate with Banyan.
server-cert-trust-explanation = Banyan will add a private, installation-specific certificate authority to your login Keychain. It is used only for https://localhost and can be removed when the Word add-in is uninstalled.
server-cert-trust-prompt = Continue?
