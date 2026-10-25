import { VirtualizedTableHelper } from "zotero-plugin-toolkit";
import { config } from "../../package.json";
import {
  getStyleOptionState,
  loadStyles,
  promptImportStyle,
} from "../modules/styles";
import { createXULElementCompat, ParameterPanel } from "../ui/parameterPanel";
import { getEffectiveItemMenuStyleId } from "../modules/itemMenu";
import { pickDefaultStyleId } from "../modules/styleSelection";
import { useL10n } from "../utils/locale";
import { formatStyleUpdatedDate } from "../utils/styleUpdated";
import { unwrapDialogIO } from "../utils/window";
import type { StyleRequestData, StyleResponseData } from "../../typings/server";
import { StyleSummary } from "../../typings/styleIndex";
import type {
  StyleOptionParam,
  StyleOptionValues,
} from "@banyan/core/types/style";
import {
  resolveStyleOptionState,
  type StyleOptionState,
} from "@banyan/core/validation/paramValues";
import { createLogger } from "../utils/logger";

const log = createLogger("style-dialog");

export type IO = {
  data?: StyleRequestData;
  resolve: (style: StyleResponseData) => void;
};

let io: IO | null = null;
let resolved = false;
let rowsAll: StyleSummary[] = [];
let rows: StyleSummary[] = [];
let selected: StyleSummary | null = null;
let tableHelper: VirtualizedTableHelper | null = null;

/** One draft per style: switching back and forth keeps what the user changed. */
const drafts = new Map<string, StyleOptionValues>();

let optionParams: StyleOptionParam[] = [];
let optionState: StyleOptionState = {
  storedValues: {},
  valueSources: {},
  effectiveValues: {},
  states: {},
};
let optionPanel: ParameterPanel<StyleOptionParam> | null = null;
let optionsValid = true;
let detailRequest = 0;
/** Style whose detail pane (and therefore option controls) is on screen. */
let detailReadyId = "";
let splitPointerID: number | null = null;

let confirmButton: HTMLButtonElement | null = null;
let titleEl: HTMLElement | null = null;
let metaEl: HTMLElement | null = null;
let descriptionEl: HTMLElement | null = null;
let optionsEl: HTMLElement | null = null;
let optionsSection: HTMLElement | null = null;

const t = useL10n(["styleDialog.ftl", "citationDialog.ftl"]);

window.addEventListener("load", initstyleDialog);
window.addEventListener("unload", () => {
  if (!resolved) {
    io?.resolve(null);
  }
});

async function initstyleDialog(): Promise<void> {
  const arg = unwrapDialogIO<IO>(window.arguments?.[0]);
  if (!arg) {
    log.error("window IO is missing");
    return;
  }
  io = arg;

  titleEl = document.getElementById("style-detail-title") as HTMLElement | null;
  metaEl = document.getElementById("style-detail-meta") as HTMLElement | null;
  descriptionEl = document.getElementById(
    "style-detail-description",
  ) as HTMLElement | null;
  optionsSection = document.getElementById(
    "style-options-section",
  ) as HTMLElement | null;
  optionsSection?.setAttribute("aria-label", t("style-dialog-options"));
  optionsEl = document.getElementById("style-options") as HTMLElement | null;
  confirmButton = document.getElementById(
    "confirm",
  ) as HTMLButtonElement | null;

  focusSearchBox();
  rowsAll = getAllRows();
  rows = rowsAll;
  seedDrafts();

  // Prefer the style the caller asked for, then the style already chosen for
  // the item menu (explicitly or as the last rendering style), then the first
  // style in the list.
  const defaultStyleId = pickDefaultStyleId(
    rowsAll.map((row) => row.id),
    io?.data?.id,
    getEffectiveItemMenuStyleId(),
  );
  selected =
    rowsAll.find((row) => row.id === defaultStyleId) ?? rowsAll[0] ?? null;

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
      if (index === undefined) return;
      const row = rows[index];
      if (!row) return;
      selected = row;
      void showSelectedStyle();
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
  bindPaneSplitter();
  await showSelectedStyle();
}

function seedDrafts(): void {
  for (const row of rowsAll) {
    // Keep what the user already changed in this window; only seed new styles.
    if (drafts.has(row.id)) continue;
    const stored =
      row.id === io?.data?.id && io?.data?.options
        ? io.data.options
        : io?.data?.optionsByStyle?.[row.id];
    drafts.set(row.id, { ...(stored ?? {}) });
  }
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
  if (!rows.some((row) => row.id === selected?.id)) {
    // Choose the new row before rendering. `render(-1)` would abort the table
    // update and leave the detail pane on a style the filter hides.
    selected = rows[0] ?? null;
  }
  await updateTable();
  if (selected) {
    await showSelectedStyle();
  }
}

function bindShortcut(): void {
  window.addEventListener("keydown", onKeydown);
}

function bindPaneSplitter(): void {
  const splitter = document.getElementById("pane-splitter");
  if (!splitter) return;
  splitter.addEventListener("pointerdown", onSplitPointerDown);
  splitter.addEventListener("dblclick", resetPaneSplitter);
  window.addEventListener("pointermove", onSplitPointerMove);
  window.addEventListener("pointerup", onSplitPointerUp);
  window.addEventListener("pointercancel", onSplitPointerUp);
  window.addEventListener("resize", clampPaneSplitter);
}

function onSplitPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  splitPointerID = event.pointerId;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onSplitPointerMove(event: PointerEvent): void {
  if (splitPointerID !== event.pointerId) return;
  const main = document.querySelector("main");
  if (!main) return;
  const rect = main.getBoundingClientRect();
  setListWidth(event.clientX - rect.left, rect.width);
}

function onSplitPointerUp(event: PointerEvent): void {
  if (splitPointerID === event.pointerId) {
    splitPointerID = null;
  }
}

function resetPaneSplitter(): void {
  const list = document.getElementById("style-list-pane") as HTMLElement | null;
  if (!list) return;
  list.style.removeProperty("flex");
}

function clampPaneSplitter(): void {
  const list = document.getElementById("style-list-pane") as HTMLElement | null;
  if (!list) return;
  if (list.style.flex) {
    setListWidth(list.getBoundingClientRect().width);
  }
}

/** Keep the splitter between the two panes' declared minimum widths. */
function setListWidth(width: number, containerWidth?: number): void {
  const main = document.querySelector("main");
  const list = document.getElementById("style-list-pane") as HTMLElement | null;
  const splitter = document.getElementById(
    "pane-splitter",
  ) as HTMLElement | null;
  if (!main || !list || !splitter) return;

  const bounds = splitterBounds(main, list, splitter, containerWidth);
  const clamped = Math.min(Math.max(width, bounds.minList), bounds.max);
  list.style.flex = `0 1 ${clamped}px`;
}

function splitterBounds(
  main: Element,
  list: HTMLElement,
  splitter: HTMLElement,
  containerWidth?: number,
): { minList: number; max: number } {
  const total = containerWidth ?? main.getBoundingClientRect().width;
  const splitterWidth = splitter.getBoundingClientRect().width || 5;
  const detail = document.getElementById("style-detail-pane");
  const listStyle = window.getComputedStyle?.(list) ?? null;
  const minList = parseFloat(listStyle?.minWidth ?? "") || 240;
  const detailStyle = detail
    ? (window.getComputedStyle?.(detail) ?? null)
    : null;
  const minDetail = parseFloat(detailStyle?.minWidth ?? "") || 280;
  return {
    minList,
    max: Math.max(minList, total - splitterWidth - minDetail),
  };
}

const onKeydown = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    focusSearchBox();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    onCancel();
  }
};

function bindButtons(): void {
  document.getElementById("confirm")?.addEventListener("click", onConfirm);
  document.getElementById("cancel")?.addEventListener("click", onCancel);
  document.getElementById("import")?.addEventListener("click", onImport);
}

async function onImport() {
  const imported = await promptImportStyle();
  if (!imported) return;
  const previousId = selected?.id;
  await loadStyles();
  rowsAll = getAllRows();
  rows = rowsAll;
  seedDrafts();
  selected = rowsAll.find((row) => row.id === previousId) ?? rowsAll[0] ?? null;
  await updateTable();
  await showSelectedStyle();
}

function onCancel(): void {
  resolved = true;
  io?.resolve(null);
  window.close();
}

function onConfirm(): void {
  if (!selected) {
    resolved = true;
    io?.resolve(null);
    window.close();
    return;
  }
  // The option controls of the previous selection must not be confirmed for
  // this one; wait until its detail pane is ready.
  if (detailReadyId !== selected.id) return;
  if (optionPanel && !optionPanel.isValid()) {
    optionsValid = false;
    updateConfirmState();
    if (!optionPanel.focusFirstInvalid()) optionPanel.focusFirst();
    return;
  }
  const stored = drafts.get(selected.id) ?? {};
  const { storedValues } = resolveStyleOptionState(optionParams, stored);
  resolved = true;
  io?.resolve({ ...selected, options: storedValues });
  window.close();
}

async function showSelectedStyle(): Promise<void> {
  const row = selected;
  if (!row) {
    clearDetail();
    return;
  }

  // Until the new detail arrives, confirm must not use the previous style's
  // control declarations.
  detailReadyId = "";
  updateConfirmState();

  const request = ++detailRequest;
  let next: Awaited<ReturnType<typeof getStyleOptionState>>;
  try {
    next = await getStyleOptionState(row, drafts.get(row.id));
  } catch (e) {
    log.error("读取样式全局选项失败", e);
    if (request !== detailRequest) return;
    clearDetail();
    return;
  }
  if (request !== detailRequest) return;

  optionParams = next.params;
  optionState = next.state;
  // The resolver owns the normalization: an option the current style version
  // does not declare has no meaning for it, and `onConfirm` sends exactly these
  // `storedValues`, so keeping unknown keys in the draft would change nothing.
  drafts.set(row.id, { ...next.state.storedValues });

  renderDetail(row);
  detailReadyId = row.id;
  updateConfirmState();
}

function clearDetail(): void {
  detailReadyId = "";
  optionPanel = null;
  optionParams = [];
  optionState = {
    storedValues: {},
    valueSources: {},
    effectiveValues: {},
    states: {},
  };
  if (titleEl) titleEl.textContent = "";
  if (metaEl) metaEl.textContent = "";
  if (descriptionEl) descriptionEl.textContent = "";
  if (optionsEl) optionsEl.replaceChildren();
  if (optionsSection) optionsSection.hidden = true;
  updateConfirmState();
}

function renderDetail(row: StyleSummary): void {
  if (titleEl) titleEl.textContent = row.title;
  if (metaEl) {
    metaEl.textContent = [
      citationTypeLabel(row.citationType),
      row.updated
        ? t("style-dialog-updated", { args: { date: row.updated } })
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (descriptionEl) {
    descriptionEl.textContent = row.description?.trim() ?? "";
  }

  const hasOptions = optionParams.length > 0;
  if (optionsSection) optionsSection.hidden = !hasOptions;
  if (!optionsEl) return;

  if (!hasOptions) {
    optionsEl.replaceChildren();
    optionPanel = null;
    optionsValid = true;
    updateConfirmState();
    return;
  }

  optionsValid = true;
  // The draft and the panel share one values object, so every edit is already
  // in the draft when the user confirms.
  const values = { ...optionState.storedValues };
  drafts.set(row.id, values);
  optionPanel = new ParameterPanel<StyleOptionParam>({
    container: optionsEl,
    controls: optionParams,
    values,
    mode: "xul",
    createXULElementCompat,
    getState: (control) =>
      optionState.states[control.id] ?? {
        mode: "free",
        value: optionState.effectiveValues[control.id] ?? "",
      },
    onChange: () => {
      optionState = resolveStyleOptionState(optionParams, drafts.get(row.id));
    },
    onValidityChange: (valid) => {
      optionsValid = valid;
      updateConfirmState();
    },
  });
  optionPanel.render();
  updateConfirmState();
}

function updateConfirmState(): void {
  if (!confirmButton) return;
  confirmButton.disabled =
    detailReadyId !== selected?.id || Boolean(optionPanel && !optionsValid);
}

function citationTypeLabel(type: StyleSummary["citationType"]): string {
  return type === "note-citation"
    ? t("style-dialog-citation-type-note")
    : t("style-dialog-citation-type-intext");
}
