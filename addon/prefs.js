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
pref("debugLoggingEnabled", false);
pref("debugLoggingModules", "");
pref("debugLoggingDesktopAutoExport", false);
