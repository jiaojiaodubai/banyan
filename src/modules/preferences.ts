import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
import { useL10n } from "../utils/locale";
import { formatStyleUpdatedDate } from "../utils/styleUpdated";
import {
  deleteStylesById,
  getFieldPresetStyles,
  onStyleIndexChanged,
  promptImportStyle,
} from "./styles";
import { refreshItemMenu } from "./menu";
import {
  FIELD_PRESET_DISABLED,
  FIELD_PRESET_STYLE_PREF,
  getPresetSourceSelection,
} from "./itemFieldPresets";
import { VirtualizedTableHelper } from "zotero-plugin-toolkit";
import type { StyleFile } from "../../typings/styleIndex";
import { isWindowAlive } from "../utils/window";
import {
  installWPSAddin,
  uninstallWPSAddin,
  installWordTemplate,
  uninstallWordTemplate,
} from "./integration";
import { createLogger } from "../utils/logger";

const log = createLogger("preferences");

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
  "mainLibrary" | "followAppSelection" | "lastSelected";

function isCitationDialogInitialCollectionMode(
  value: string,
): value is CitationDialogInitialCollectionMode {
  return ["mainLibrary", "followAppSelection", "lastSelected"].includes(value);
}

function bindCitationDialogInitialCollectionMode(): void {
  const win = addon.data.prefs!.window;
  const radioGroup = win.document.querySelector(
    `#${config.addonRef}-citationDialogInitialCollectionMode`,
  ) as XUL.RadioGroup | null;
  if (!radioGroup) return;

  const current = getPref(CITATION_DIALOG_INITIAL_COLLECTION_MODE_PREF);
  radioGroup.value =
    typeof current === "string" &&
    isCitationDialogInitialCollectionMode(current)
      ? current
      : "mainLibrary";
  radioGroup.addEventListener("command", () => {
    const value = radioGroup.value as CitationDialogInitialCollectionMode;
    setPref(CITATION_DIALOG_INITIAL_COLLECTION_MODE_PREF, value);
  });
}

/** The preferences window while it is open, or null. */
function getPrefsWindow(): Window | null {
  const win = addon.data.prefs?.window;
  // The pane can be closed while the style index keeps changing, and reading a
  // closed window's document throws: every caller here only wants to act while
  // the pane is on screen.
  return win && isWindowAlive(win) ? win : null;
}

/**
 * Fill the "Quick Marks" menu source list: the two fixed options plus one entry
 * per style that declares `ITEM_FIELD_PRESETS`.
 */
function updateFieldPresetStyleOptions(): void {
  const win = getPrefsWindow();
  if (!win) return;
  const menulist = win.document.querySelector(
    `#${config.addonRef}-fieldPresetStyleId`,
  ) as (XUL.MenuList & { selectedItem?: Element | null }) | null;
  if (!menulist) return;

  const popup = menulist.querySelector("menupopup");
  if (!popup) return;
  while (popup.firstChild) {
    popup.removeChild(popup.firstChild);
  }

  const doc = win.document;
  const append = (label: string, value: string): XUL.MenuItem => {
    const item = doc.createXULElement("menuitem") as XUL.MenuItem;
    item.setAttribute("label", label);
    item.setAttribute("value", value);
    popup.appendChild(item);
    return item;
  };

  const t = useL10n(["preferences.ftl"]);
  const lastUsed = append(t("prefs-field-preset-option-last"), "");
  const disabled = append(
    t("prefs-field-preset-option-disabled"),
    FIELD_PRESET_DISABLED,
  );

  const declared = getFieldPresetStyles();
  for (const style of declared) {
    append(style.title, style.id);
  }

  // A stored style that is not in the list (deleted, or no longer declaring
  // marks) falls back to "Last used" here; the stored preference is left alone,
  // so a choice survives the moments when the index is empty while styles load.
  const current = String(getPref(FIELD_PRESET_STYLE_PREF) ?? "");
  const selected = getPresetSourceSelection(
    current,
    declared.map((style) => style.id),
  );
  if (selected === "") {
    menulist.selectedItem = lastUsed;
  } else if (selected === FIELD_PRESET_DISABLED) {
    menulist.selectedItem = disabled;
  } else {
    menulist.selectedItem =
      (popup.querySelector(
        `menuitem[value="${CSS.escape(selected)}"]`,
      ) as XUL.MenuItem | null) ?? lastUsed;
  }

  // The list is rebuilt whenever the style index changes, which would otherwise
  // stack one listener per rebuild on the same element.
  if (!menulist.hasAttribute("data-field-preset-bound")) {
    menulist.setAttribute("data-field-preset-bound", "true");
    menulist.addEventListener("command", () => {
      setPref(FIELD_PRESET_STYLE_PREF, String(menulist.value ?? ""));
      refreshItemMenu();
    });
  }
}

export function registerPrefs() {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: t("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.svg`,
  });
  // Keep the mark-source list in step with the style index while the pane
  // is open (a style imported, saved, deleted elsewhere, or losing its marks).
  // `updateFieldPresetStyleOptions()` returns early when the window is closed.
  onStyleIndexChanged(updateFieldPresetStyleOptions);
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
  updateFieldPresetStyleOptions();
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
    // The style list drives both the table and the mark-source options.
    updateFieldPresetStyleOptions();
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
        await addon.api.reloadStyles();
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
        log.error("Failed to install WPS add-on", error);
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
        log.error("Failed to uninstall WPS add-on", error);
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

  // ── Word template buttons ──────────────────────────
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
        setWordButtonsDisabled(true);
        wordInstallBtn.textContent = t("prefs-word-addon-installing");

        const result = await installWordTemplate();
        if (result.success) {
          Services.prompt.alert(
            promptWindow,
            t("prefs-word-addon-title"),
            t("prefs-word-addon-install-success", {
              args: { path: result.targetPath },
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
        log.error("Failed to install Word template", error);
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
        const result = await uninstallWordTemplate();
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
        log.error("Failed to uninstall Word template", error);
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
