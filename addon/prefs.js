pref("progressTimeout", 300000);
// Milliseconds a single server operation may hold its document/style lock
// before the watchdog force-releases it. Defaults to match `progressTimeout`
// so the plugin gives up at about the same time the front-end does; users may
// tune it independently.
pref("lockWatchdogTimeout", 300000);
pref("styleEditorAssetsVersion", "");
pref("citationDialogInitialCollectionMode", "mainLibrary");
pref("citationDialogCollectionTreeWidth", 170);
pref("serverTrustedOrigins", "[]");
pref("httpsProxyEnabled", false);
pref("httpsProxyState", "");

// Which style's ITEM_FIELD_PRESETS / ITEM_FIELD_VALIDATORS feed the item
// context menu: "" follows the last style parsed for rendering, "-" disables
// the menu, anything else is a style id.
pref("itemMenuStyleId", "");
// Last style parsed for rendering (document refresh, citation dialog, ...),
// recorded automatically; not edited by users.
pref("lastUsedStyleId", "");
// `extra` key shown by the "Extra value" item-list column; "" hides the column.
pref("extraValueColumnKey", "");
