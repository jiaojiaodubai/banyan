import { dialogExample } from "./modules/debug";
// Side-effect import: installs the main-window executable style index hooks.
import "./modules/styleIndex";
import { registerPrefs, onPrefsWindowLoad } from "./modules/preferences";
import { createZToolkit } from "./utils/ztoolkit";
import {
  generateStyle,
  getStyle,
  installPresetStyles,
  loadStyles,
} from "./modules/styles";
import { useL10n } from "./utils/locale";
import {
  registerStyleSheet,
  registerItemPaneSection,
} from "./modules/mainWindow";
import {
  cleanupCitationColumn,
  registerCitationColumn,
  unpatchCollectionsView,
} from "./modules/citedItemsSearch";
import { registerToolsMenu, registerContextMenu } from "./modules/menu";
import {
  registerRetypeObserver,
  unregisterRetypeObserver,
} from "./modules/multilingualRetype";
import { ensureStyleEditorRuntimeAssets } from "./modules/styleEditor";
import { initializeServer, shutdownServer } from "./modules/server";
import { DIALOG_WINDOW_NAME } from "./modules/multilingualItem";
import { findWindowByName } from "./utils/window";
import { createLogger } from "./utils/logger";
import { runStartupSteps } from "./utils/startup";

const log = createLogger("hooks");

function registerAPIs(): void {
  addon.api.reloadStyles = loadStyles;
  addon.api.generate = generateStyle;
  addon.api.getStyleUI = async (style) => {
    const cachedStyle = await getStyle(style);
    return cachedStyle.UI ?? { cite: [], citation: [] };
  };
}

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  addon.data.ztoolkit = createZToolkit();

  // Every step owns its failure: a deleted asset or an unreadable file must
  // not take down the steps after it, and the log entry names the step so a
  // report can be traced back to the module that failed. `startupFailures` keeps
  // the names readable from the running client (`Zotero.Banyan.data`).
  const windowSteps = Zotero.getMainWindows().map((win, index) => ({
    name: `main-window:${index + 1}`,
    run: () => onMainWindowLoad(win),
  }));
  const failures = await runStartupSteps(
    [
      { name: "api", run: registerAPIs },
      { name: "prefs", run: registerPrefs },
      // Registered once per session: `Zotero.MenuManager` keys menus by
      // `menuID` and injects them into each popup as it opens, so every main
      // window (including ones opened later) gets them. Per-window
      // registration would be rejected by its unique-`menuID` check.
      { name: "menu:tools", run: registerToolsMenu },
      { name: "menu:context", run: registerContextMenu },
      { name: "observer:retype", run: registerRetypeObserver },
      // The style index is the plugin's core data and the style table reads it
      // directly, so it loads before the optional style-editor runtime assets:
      // a missing editor asset must not leave the table empty.
      { name: "styles:load", run: () => loadStyles() },
      { name: "styles:presets", run: () => installPresetStyles() },
      {
        name: "style-editor:runtime-assets",
        run: () => ensureStyleEditorRuntimeAssets(),
      },
      { name: "server", run: () => initializeServer() },
      ...windowSteps,
    ],
    (failure) => {
      log.error(`Startup step '${failure.name}' failed`, failure.error);
    },
  );

  addon.data.startupFailures = failures.map((failure) => failure.name);
  if (addon.data.startupFailures.length) {
    log.warn(
      `Plugin started with ${addon.data.startupFailures.length} failed startup step(s): ${addon.data.startupFailures.join(", ")}`,
    );
  }

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  const t = useL10n();

  // Attach the plugin's Fluent file before anything else: menu labels resolve
  // asynchronously, and a later failure in window setup must not leave the
  // plugin's menus without labels.
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: t("startup-begin"),
      type: "default",
      progress: 0,
    })
    .show();

  popupWin.changeLine({
    progress: 30,
    text: `[30%] ${t("startup-begin")}`,
  });

  registerStyleSheet(win);
  registerItemPaneSection();

  void registerCitationColumn().catch((e: unknown) => {
    ztoolkit.logError(e);
  });

  await new Promise((resolve) => {
    setTimeout(resolve, 500);
  });

  popupWin.changeLine({
    progress: 100,
    text: `[100%] ${t("startup-finish")}`,
  });
  popupWin.startCloseTimer(5000);

  if (addon.data.env === "development") {
    dialogExample();
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  unpatchCollectionsView(win);
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  // Note: the multilingual item-pane section is intentionally not unregistered
  // here. `registerSection` binds it to our `pluginID`, so Zotero removes it
  // automatically when the plugin is disabled/removed. The citation column has
  // no such owner tracking, so it must be cleaned up explicitly below.
  cleanupCitationColumn();
  unregisterRetypeObserver();
  shutdownServer();
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  // The editor keeps references to this now-destroyed instance; the next
  // plugin version would otherwise retarget it while it still runs old code.
  findWindowByName(DIALOG_WINDOW_NAME)?.close();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsWindowLoad,
};
