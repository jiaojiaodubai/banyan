import { config } from "../../package.json";
import { useL10n } from "../utils/locale";
import { deleteStylesById, promptImportStyle } from "./styles";
import { VirtualizedTableHelper } from "zotero-plugin-toolkit";
import { StyleFile } from "../../typings/style";
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
  description?: string;
  filename: string;
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
    };
  } else {
    addon.data.prefs.window = _window;
  }
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
        updated: m.updated,
        description: m.description,
        filename: m.filename,
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
        if (event.key === "Enter") {
          void openPreviewWindow(tableHelper);
          return false;
        }
        return true;
      })
      // Double-click activate: open containing folder and reveal file
      .setProp("onActivate", (_ev: Event) => {
        void openSelectedStyleInFolder(tableHelper);
        return true;
      })
      // For find-as-you-type
      .setProp(
        "getRowString",
        (index) => addon.data.prefs?.rows[index].name || "",
      )
      // Render the table.
      .render(-1, () => resolve());
    setTimeout(() => tableHelper.treeInstance.invalidate());
    ztoolkit.log("Preference table rendered!");
    bindStyleButtons(tableHelper);
  });
}

/**
 * 绑定首选项面板的事件监听器
 * 该函数用于为Zotero插件的首选项面板中的复选框和输入框添加事件监听
 */
function bindPrefEvents() {
  // 为启用复选框添加command事件监听
  addon.data
    .prefs!.window.document?.querySelector(
      `#${config.addonRef}-enable`, // 选择器定位到启用复选框
    )
    ?.addEventListener("command", (e: Event) => {
      // 添加command事件监听
      ztoolkit.log(e);
      addon.data.prefs!.window.alert(
        `Successfully changed to ${(e.target as XULCheckboxElement).checked}!`,
      );
    });

  addon.data
    .prefs!.window.document?.querySelector(`#${config.addonRef}-input`)
    ?.addEventListener("change", (e: Event) => {
      ztoolkit.log(e);
      addon.data.prefs!.window.alert(
        `Successfully changed to ${(e.target as HTMLInputElement).value}!`,
      );
    });

  // Port configuration is managed by Zotero, not by the plugin
  // No port change listener needed
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
      setWordButtonsDisabled(true);
      wordInstallBtn.textContent = t("prefs-word-addon-installing");

      try {
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

async function openSelectedStyleInFolder(tableHelper: PreferenceTableHelper) {
  try {
    const rows: PrefStyleRow[] =
      (addon.data.prefs!.rows as PrefStyleRow[]) || [];
    const selection = tableHelper.treeInstance.selection;
    const selected: PrefStyleRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (selection.isSelected(i)) selected.push(rows[i]);
    }
    if (selected.length !== 1) return;
    const row = selected[0];
    const fullPath = PathUtils.join(
      Zotero.DataDirectory.dir,
      "banyan",
      row.filename,
    );
    Zotero.File.reveal(fullPath);
  } catch (e) {
    ztoolkit.log(`Open containing folder failed: ${e}`);
  }
}

async function openPreviewWindow(tableHelper: PreferenceTableHelper) {
  try {
    const rows: PrefStyleRow[] =
      (addon.data.prefs!.rows as PrefStyleRow[]) || [];
    const selection = tableHelper.treeInstance.selection;
    const selected: PrefStyleRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (selection.isSelected(i)) selected.push(rows[i]);
    }
    if (selected.length !== 1) return;
    const row = selected[0];
    // Placeholder preview window using toolkit dialog
    const dialog = new ztoolkit.Dialog(6, 1)
      .addCell(0, 0, {
        tag: "h2",
        properties: { innerHTML: "Style Preview" },
      })
      .addCell(1, 0, {
        tag: "p",
        properties: {
          innerHTML: `TODO: implement preview for <b>${row.name}</b>`,
        },
      })
      .addButton("Close", "close")
      .open("Style Preview");
    // no need to store globally; auto-close handled by dialog helper
    void dialog;
  } catch (e) {
    ztoolkit.log(`Open preview failed: ${e}`);
  }
}
