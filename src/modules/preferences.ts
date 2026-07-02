import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
import { useL10n } from "../utils/locale";
import { formatStyleUpdatedDate } from "../utils/styleUpdated";
import { deleteStylesById, promptImportStyle } from "./styles";
import { VirtualizedTableHelper } from "zotero-plugin-toolkit";
import type { StyleFile } from "../../typings/style";
import {
  installWPSAddin,
  uninstallWPSAddin,
  installWordAddin,
  uninstallWordAddin,
} from "./integration";

type PrefStyleRow = {
  id: string;
  name: string;
  updated: string;
};

type PreferenceTableHelper = {
  treeInstance: {
    selection: {
      isSelected: (index: number) => boolean;
    };
    invalidate: () => void;
  };
};

const t = useL10n(["preferences.ftl"]);
const CITATION_DIALOG_INITIAL_COLLECTION_MODE_PREF =
  "citationDialogInitialCollectionMode" as const;
type CitationDialogInitialCollectionMode =
  _ZoteroTypes.Prefs["PluginPrefsMap"][typeof CITATION_DIALOG_INITIAL_COLLECTION_MODE_PREF];

function bindCitationDialogInitialCollectionMode(): void {
  const win = addon.data.prefs!.window;
  const radioGroup = win.document.querySelector(
    `#${config.addonRef}-citationDialogInitialCollectionMode`,
  ) as XUL.RadioGroup | null;
  if (!radioGroup) return;

  const current = getPref(CITATION_DIALOG_INITIAL_COLLECTION_MODE_PREF);
  radioGroup.value = current || "mainLibrary";
  radioGroup.addEventListener("command", () => {
    const value = radioGroup.value as CitationDialogInitialCollectionMode;
    setPref(CITATION_DIALOG_INITIAL_COLLECTION_MODE_PREF, value);
  });
}

function confirmWordAddinInstall(promptWindow: mozIDOMWindowProxy): boolean {
  if (Services.appinfo.OS !== "WINNT") {
    return true;
  }

  const promptSvc = Services.prompt;
  const buttonPos0 = promptSvc.BUTTON_POS_0 ?? 0;
  const buttonPos1 = promptSvc.BUTTON_POS_1 ?? 0;
  const buttonTitleIsString = promptSvc.BUTTON_TITLE_IS_STRING ?? 0;
  const flags =
    buttonPos0 * buttonTitleIsString + buttonPos1 * buttonTitleIsString;

  const idx = promptSvc.confirmEx(
    promptWindow,
    t("prefs-word-addon-title"),
    t("prefs-word-addon-install-confirm"),
    flags,
    t("prefs-word-addon-install-confirm-continue"),
    t("prefs-word-addon-install-confirm-cancel"),
    "",
    "",
    { value: false },
  );

  return idx === 0;
}

export function registerPrefs() {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: t("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
  });
}

export async function onPrefsWindowLoad(_window: Window) {
  // This function is called when the prefs window is opened
  // See addon/content/preferences.xhtml onpaneload
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
      columns: [
        {
          dataKey: "name",
          label: t("prefs-table-title") || "Name",
          fixedWidth: false,
          width: 200,
        },
        {
          dataKey: "updated",
          label: t("prefs-table-detail") || "Updated",
          fixedWidth: true,
          width: 160,
        },
      ],
      rows: [],
      tableHelper: null,
    };

    // Fix: table may not display fully when pane is not initially visible.
    // Re‑invalidate when the prefpane becomes visible (matching Zotero's approach).
    const prefPane = _window.frameElement?.closest("prefpane");
    if (prefPane) {
      prefPane.addEventListener("showing", () => {
        addon.data.prefs?.tableHelper?.treeInstance?.invalidate();
      });
    }
  } else {
    addon.data.prefs.window = _window;
  }
  bindCitationDialogInitialCollectionMode();
  await updatePrefsUI();
  bindPrefEvents();
  bindIntegrationButtons();
}

async function updatePrefsUI() {
  return new Promise<void>((resolve) => {
    if (addon.data.prefs?.window == undefined) return;
    // Build rows from indexed styles metadata
    const rows = Array.from(addon.data.styles.files.values()).map(
      (m: StyleFile) => ({
        id: m.id,
        name: m.title,
        updated: formatStyleUpdatedDate(m.updated),
      }),
    );
    addon.data.prefs.rows = rows as PrefStyleRow[];

    const tableHelper = new ztoolkit.VirtualizedTable(addon.data.prefs?.window)
      .setContainerId(`${config.addonRef}-table-container`)
      .setProp({
        id: `${config.addonRef}-prefs-table`,
        // Do not use setLocale, as it modifies the Zotero.Intl.strings
        // Set locales directly to columns
        columns: addon.data.prefs?.columns,
        showHeader: true,
        multiSelect: true,
        staticColumns: true,
        disableFontSizeScaling: true,
      })
      .setProp("getRowCount", () => addon.data.prefs?.rows.length || 0)
      .setProp("getRowData", (index) => {
        const r = addon.data.prefs?.rows[index];
        return r
          ? { name: r.name, updated: r.updated }
          : { name: "no data", updated: "" };
      })
      // When pressing delete, delete selected line and refresh table.
      // Returning false to prevent default event.
      .setProp("onKeyDown", (event: KeyboardEvent) => {
        if (
          event.key == "Delete" ||
          (Zotero.isMac && event.key == "Backspace")
        ) {
          void removeSelectedStyles(tableHelper);
          return false;
        }
        return true;
      })
      // For find-as-you-type
      .setProp(
        "getRowString",
        (index) => addon.data.prefs?.rows[index].name || "",
      )
      // Render the table.
      .render(-1, () => {
        // Fix: table may show partially blank until scrolled.
        // Delay invalidate to ensure DOM layout is complete
        // (matching Zotero's setTimeout approach in preferences_cite.jsx).
        setTimeout(() => {
          tableHelper.treeInstance?.invalidate();
        });
        resolve();
      });
    addon.data.prefs.tableHelper = tableHelper;
    bindStyleButtons(tableHelper);
  });
}

function bindPrefEvents() {
  // Port configuration is managed by Zotero, not by the plugin.
}

function bindStyleButtons(tableHelper: VirtualizedTableHelper) {
  const win = addon.data.prefs!.window;
  const importBtn = win.document.querySelector(
    `#${config.addonRef}-style-import`,
  ) as HTMLButtonElement | null;
  const deleteBtn = win.document.querySelector(
    `#${config.addonRef}-style-delete`,
  ) as HTMLButtonElement | null;
  if (importBtn) {
    importBtn.addEventListener("click", async () => {
      const imported = await promptImportStyle();
      if (imported) {
        await updatePrefsUI();
      }
    });
  }
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      await removeSelectedStyles(tableHelper);
    });
  }
}

function bindIntegrationButtons() {
  const win = addon.data.prefs!.window;
  const promptWindow = win as unknown as mozIDOMWindowProxy;

  // ── WPS Add‑in buttons ────────────────────────────────
  const wpsInstallBtn = win.document.querySelector(
    `#${config.addonRef}-wps-addon-install`,
  ) as HTMLButtonElement | null;
  const wpsUninstallBtn = win.document.querySelector(
    `#${config.addonRef}-wps-addon-uninstall`,
  ) as HTMLButtonElement | null;

  const setWPSButtonsDisabled = (disabled: boolean) => {
    if (wpsInstallBtn) wpsInstallBtn.disabled = disabled;
    if (wpsUninstallBtn) wpsUninstallBtn.disabled = disabled;
  };

  if (wpsInstallBtn) {
    wpsInstallBtn.onclick = async () => {
      const installIdleLabel =
        wpsInstallBtn.textContent || t("prefs-wps-addon-install");
      const uninstallIdleLabel =
        wpsUninstallBtn?.textContent || t("prefs-wps-addon-uninstall");
      setWPSButtonsDisabled(true);
      wpsInstallBtn.textContent = t("prefs-wps-addon-installing");

      try {
        const result = await installWPSAddin();
        if (result.success) {
          Services.prompt.alert(
            promptWindow,
            t("prefs-wps-addon-title"),
            t("prefs-wps-addon-install-success", {
              args: { path: result.targetDir },
            }),
          );
          return;
        }

        Services.prompt.alert(
          promptWindow,
          t("prefs-wps-addon-title"),
          t("prefs-wps-addon-install-failed", {
            args: { message: result.message },
          }),
        );
      } catch (error) {
        ztoolkit.logError(error);
        Services.prompt.alert(
          promptWindow,
          t("prefs-wps-addon-title"),
          t("prefs-wps-addon-install-failed", {
            args: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        );
      } finally {
        setWPSButtonsDisabled(false);
        wpsInstallBtn.textContent = installIdleLabel;
        if (wpsUninstallBtn) wpsUninstallBtn.textContent = uninstallIdleLabel;
      }
    };
  }

  if (wpsUninstallBtn) {
    wpsUninstallBtn.onclick = async () => {
      const installIdleLabel =
        wpsInstallBtn?.textContent || t("prefs-wps-addon-install");
      const uninstallIdleLabel =
        wpsUninstallBtn.textContent || t("prefs-wps-addon-uninstall");
      setWPSButtonsDisabled(true);
      wpsUninstallBtn.textContent = t("prefs-wps-addon-uninstalling");

      try {
        const result = await uninstallWPSAddin();
        if (result.success) {
          Services.prompt.alert(
            promptWindow,
            t("prefs-wps-addon-title"),
            t("prefs-wps-addon-uninstall-success"),
          );
          return;
        }

        Services.prompt.alert(
          promptWindow,
          t("prefs-wps-addon-title"),
          t("prefs-wps-addon-uninstall-failed", {
            args: { message: result.message },
          }),
        );
      } catch (error) {
        ztoolkit.logError(error);
        Services.prompt.alert(
          promptWindow,
          t("prefs-wps-addon-title"),
          t("prefs-wps-addon-uninstall-failed", {
            args: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        );
      } finally {
        setWPSButtonsDisabled(false);
        wpsUninstallBtn.textContent = uninstallIdleLabel;
        if (wpsInstallBtn) wpsInstallBtn.textContent = installIdleLabel;
      }
    };
  }

  // ── Word Add‑in buttons ───────────────────────────────
  const wordInstallBtn = win.document.querySelector(
    `#${config.addonRef}-word-addon-install`,
  ) as HTMLButtonElement | null;
  const wordUninstallBtn = win.document.querySelector(
    `#${config.addonRef}-word-addon-uninstall`,
  ) as HTMLButtonElement | null;

  const setWordButtonsDisabled = (disabled: boolean) => {
    if (wordInstallBtn) wordInstallBtn.disabled = disabled;
    if (wordUninstallBtn) wordUninstallBtn.disabled = disabled;
  };

  if (wordInstallBtn) {
    wordInstallBtn.onclick = async () => {
      const installIdleLabel =
        wordInstallBtn.textContent || t("prefs-word-addon-install");
      const uninstallIdleLabel =
        wordUninstallBtn?.textContent || t("prefs-word-addon-uninstall");

      try {
        if (!confirmWordAddinInstall(promptWindow)) {
          return;
        }

        setWordButtonsDisabled(true);
        wordInstallBtn.textContent = t("prefs-word-addon-installing");

        const result = await installWordAddin();
        if (result.success) {
          Services.prompt.alert(
            promptWindow,
            t("prefs-word-addon-title"),
            t("prefs-word-addon-install-success", {
              args: { path: result.manifestPath },
            }),
          );
          return;
        }

        Services.prompt.alert(
          promptWindow,
          t("prefs-word-addon-title"),
          t("prefs-word-addon-install-failed", {
            args: { message: result.message },
          }),
        );
      } catch (error) {
        ztoolkit.logError(error);
        Services.prompt.alert(
          promptWindow,
          t("prefs-word-addon-title"),
          t("prefs-word-addon-install-failed", {
            args: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        );
      } finally {
        setWordButtonsDisabled(false);
        wordInstallBtn.textContent = installIdleLabel;
        if (wordUninstallBtn) wordUninstallBtn.textContent = uninstallIdleLabel;
      }
    };
  }

  if (wordUninstallBtn) {
    wordUninstallBtn.onclick = async () => {
      const installIdleLabel =
        wordInstallBtn?.textContent || t("prefs-word-addon-install");
      const uninstallIdleLabel =
        wordUninstallBtn.textContent || t("prefs-word-addon-uninstall");
      setWordButtonsDisabled(true);
      wordUninstallBtn.textContent = t("prefs-word-addon-uninstalling");

      try {
        const result = await uninstallWordAddin();
        if (result.success) {
          Services.prompt.alert(
            promptWindow,
            t("prefs-word-addon-title"),
            t("prefs-word-addon-uninstall-success"),
          );
          return;
        }

        Services.prompt.alert(
          promptWindow,
          t("prefs-word-addon-title"),
          t("prefs-word-addon-uninstall-failed", {
            args: { message: result.message },
          }),
        );
      } catch (error) {
        ztoolkit.logError(error);
        Services.prompt.alert(
          promptWindow,
          t("prefs-word-addon-title"),
          t("prefs-word-addon-uninstall-failed", {
            args: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        );
      } finally {
        setWordButtonsDisabled(false);
        wordUninstallBtn.textContent = uninstallIdleLabel;
        if (wordInstallBtn) wordInstallBtn.textContent = installIdleLabel;
      }
    };
  }
}

async function removeSelectedStyles(tableHelper: PreferenceTableHelper) {
  const selection = tableHelper.treeInstance.selection;
  const styleIds: string[] = [];
  (addon.data.prefs!.rows as PrefStyleRow[]).forEach((row, i) => {
    if (selection.isSelected(i)) {
      styleIds.push(row.id);
    }
  });
  if (!styleIds.length) {
    return;
  }
  const removed = await deleteStylesById(styleIds);
  if (removed) {
    await updatePrefsUI();
  }
}
