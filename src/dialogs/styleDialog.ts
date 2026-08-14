import { VirtualizedTableHelper } from "zotero-plugin-toolkit";
import { config } from "../../package.json";
import { loadStyles, promptImportStyle } from "../modules/styles";
import { useL10n } from "../utils/locale";
import { formatStyleUpdatedDate } from "../utils/styleUpdated";
import type { StyleIdentifier, StyleResponseData } from "../../typings/server";
import { StyleSummary } from "../../typings/style";

export type IO = {
  data?: StyleIdentifier;
  resolve: (style: StyleResponseData) => void;
};

let io: IO | null = null;
let resolved = false;
let rowsAll: StyleSummary[] = [];
let rows: StyleSummary[] = [];
let selected: StyleSummary | null = null;
let tableHelper: VirtualizedTableHelper | null = null;

const t = useL10n(["styleDialog.ftl"]);

window.addEventListener("load", initstyleDialog);
window.addEventListener("unload", () => {
  if (!resolved) {
    io?.resolve(null);
  }
});

async function initstyleDialog(): Promise<void> {
  io = window.arguments[0].wrappedJSObject as IO;
  // Focus the search box as early as possible so the user can type immediately.
  focusSearchBox();
  rowsAll = getAllRows();
  rows = rowsAll;
  // Select specified style if provided, or first style as default
  selected =
    rowsAll.find((row) => row.id === io?.data?.id) ?? rowsAll[0] ?? null;
  tableHelper = new ztoolkit.VirtualizedTable(window)
    .setContainerId("table-container")
    .setProp({
      id: `${config.addonRef}-styles-table`,
      columns: [
        {
          dataKey: "title",
          label: t("style-table-title"),
          fixedWidth: false,
          width: 150,
        },
        {
          dataKey: "updated",
          label: t("style-table-detail"),
          fixedWidth: true,
          width: 90,
        },
      ],
      showHeader: true,
      multiSelect: false,
      staticColumns: true,
      disableFontSizeScaling: true,
    })
    .setProp("onSelectionChange", (selection) => {
      const index = selection.selected.values().next().value;
      //  When clear selection, index will be undefined, don't update selected
      if (index === undefined) return;
      selected = rows[index];
    })
    .setProp("onActivate", onConfirm)
    .setProp("onItemContextMenu", () => {
      // Suppress the toolkit default context-menu handler; this dialog has no row actions.
    });
  await updateTable();
  // The virtualized table render may reset the active element; restore focus.
  focusSearchBox();
  bindSearch();
  bindButtons();
  bindShortcut();
}

function focusSearchBox(): void {
  const searchBox = document.getElementById("search") as
    (HTMLElement & { inputField?: HTMLInputElement }) | null;
  // XUL search-textbox exposes its inner <input> via `inputField`;
  // falling back to the element itself keeps plain HTML inputs working too.
  const input = searchBox?.inputField ?? searchBox;
  if (!input) return;
  input.focus();
  if (input instanceof HTMLInputElement) {
    try {
      input.select();
    } catch {
      // ignore
    }
  }
}

function getAllRows(): StyleSummary[] {
  return Array.from(addon.data.styles.files.values())
    .map((style) => {
      return {
        id: style.id,
        title: style.title,
        citationType: style.citationType,
        description: style.description,
        updated: formatStyleUpdatedDate(style.updated),
      };
    })
    .toSorted((a, b) => a.title.localeCompare(b.title));
}

async function updateTable(): Promise<void> {
  const index = rows.findIndex((row) => row.id === selected?.id);
  return new Promise<void>((resolve) => {
    tableHelper
      ?.setProp("getRowCount", () => rows.length)
      .setProp("getRowData", (index: number) => rows[index] ?? {})
      .setProp("getRowString", (index: number) => rows[index]?.title ?? "")
      // Render with selected index, or first row if no selection
      .render(index, () => resolve());
  });
}

function bindSearch(): void {
  const searchBox = document.getElementById(
    "search",
  ) as HTMLInputElement | null;
  searchBox?.addEventListener("command", () => search(searchBox.value));
}

async function search(query: string) {
  const trimmed = query.trim().toLowerCase();
  // Common case: empty query, show all styles directly
  if (trimmed === "") {
    rows = rowsAll;
  } else {
    rows = rowsAll.filter((row) => {
      const haystack = [row.title, row.updated].join("|").toLowerCase();
      return haystack.includes(trimmed);
    });
  }
  await updateTable();
}

function bindShortcut(): void {
  window.addEventListener("keydown", onKeydown);
}

const onKeydown = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    focusSearchBox();
  }
};

function bindButtons(): void {
  document.getElementById("confirm")?.addEventListener("click", onConfirm);
  document.getElementById("import")?.addEventListener("click", onImport);
}

async function onImport() {
  const imported = await promptImportStyle();
  if (!imported) return;
  await loadStyles();
  rowsAll = getAllRows();
  await updateTable();
}

function onConfirm() {
  io?.resolve(selected ?? rowsAll[0] ?? null);
  resolved = true;
  window.close();
}
