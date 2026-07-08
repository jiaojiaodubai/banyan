import { dialogExample } from "./modules/debug";
import { registerPrefs, onPrefsWindowLoad } from "./modules/preferences";
import { createZToolkit } from "./utils/ztoolkit";
import { getStyle, installPresetStyles, loadStyles } from "./modules/styles";
import { useL10n } from "./utils/locale";
import {
  registerStyleSheet,
  registerItemPaneSection,
} from "./modules/mainWindow";
import {
  cleanupCitationColumn,
  registerCitationColumn,
} from "./modules/citedItemsSearch";
import { registerToolsMenu, registerContextMenu } from "./modules/menu";
import { ensureStyleEditorRuntimeAssets } from "./modules/styleEditor";
import {
  registerEndpoints,
  restoreBanyanCORS,
  savePortToConfigFile,
} from "./modules/server";

function registerAPIs(): void {
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

  registerAPIs();
  registerPrefs();
  registerItemPaneSection();
  registerEndpoints();

  // Save Zotero's HTTP server port to config file for external integrations
  await saveZoteroServerPort();

  await ensureStyleEditorRuntimeAssets();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function saveZoteroServerPort(): Promise<void> {
  try {
    const port = Number(Zotero.Prefs.get("httpServer.port"));
    if (Number.isFinite(port) && port > 0) {
      await savePortToConfigFile(port);
    }
  } catch (e) {
    ztoolkit.logError(e);
  }
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  const t = useL10n();
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

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

  await loadStyles();
  await installPresetStyles();

  popupWin.changeLine({
    progress: 30,
    text: `[30%] ${t("startup-begin")}`,
  });

  registerStyleSheet(win);
  registerToolsMenu();
  registerContextMenu();

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

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  cleanupCitationColumn();
  restoreBanyanCORS();
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
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
