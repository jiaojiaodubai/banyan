import type {
  ColumnOptions,
  VirtualizedTableHelper,
} from "zotero-plugin-toolkit";
import type { FieldCheckEntry } from "@banyan/core/validation/itemFieldValidators";
import { useL10n } from "../utils/locale";
import { unwrapDialogIO } from "../utils/window";
import type {
  ItemFieldCheckReport,
  ItemFieldValidatorDialogIO,
} from "../../typings/itemFieldValidator";
import { createLogger } from "../utils/logger";

const log = createLogger("item-field-validator-dialog");

const t = useL10n(["itemFieldValidatorDialog.ftl"]);

const TREE_ID = "banyan-item-field-validator";
const RESULT_COLUMN_KEY = "banyanFieldCheckResult";
const DETAIL_TABLE_ID = "banyan-item-field-validator-details";

type CheckStatus = "pass" | "fail" | "error";

type CheckCounts = {
  total: number;
  pass: number;
  fail: number;
  error: number;
};

/** One check row in the fixed "title / description / result" detail table. */
type DetailRow = {
  title: string;
  description: string;
  status: CheckStatus;
  message: string;
};

type ItemTreeColumnOption = {
  dataKey: string;
  label?: string;
  hidden?: boolean;
  showInColumnPicker?: boolean;
  width?: number;
  minWidth?: number;
  flex?: number;
  fixedWidth?: boolean;
  sortable?: boolean;
  className?: string;
  renderCell?: (
    index: number,
    data: string,
    column: ItemTreeColumnOption,
    isFirstColumn?: boolean,
    doc?: Document,
  ) => Element;
  [key: string]: unknown;
};

let reportsByItemID = new Map<string, ItemFieldCheckReport>();
let itemsView: _ZoteroTypes.CollectionViewItemTree | null = null;

let detailRows: DetailRow[] = [];
let detailTableHelper: VirtualizedTableHelper | null = null;
/** Sort chosen on the detail table; kept while switching items. */
let detailSort: { key: string; ascending: 1 | -1 } | null = null;

window.addEventListener("load", initDialog);
window.addEventListener("unload", destroy);

async function initDialog(): Promise<void> {
  const io = unwrapDialogIO<ItemFieldValidatorDialogIO>(window.arguments?.[0]);
  if (!io) {
    log.error("window IO is missing");
    return;
  }

  for (const report of io.reports) {
    reportsByItemID.set(report.itemId, report);
  }

  renderHeader(io);
  await initItemsList(io.reports);
}

function renderHeader(reportData: ItemFieldValidatorDialogIO): void {
  let passedItems = 0;
  let problemItems = 0;
  let noneItems = 0;
  let passedChecks = 0;
  let failedChecks = 0;
  let erroredChecks = 0;

  for (const report of reportData.reports) {
    const counts = countChecks(report.checks);
    if (!counts.total) {
      noneItems++;
    } else if (counts.fail || counts.error) {
      problemItems++;
    } else {
      passedItems++;
    }
    passedChecks += counts.pass;
    failedChecks += counts.fail;
    erroredChecks += counts.error;
  }

  setText(
    "report-style",
    t("item-field-validator-report-style", {
      args: { style: reportData.styleTitle },
    }),
  );
  setText(
    "report-summary-items",
    t("item-field-validator-report-items", {
      args: {
        items: reportData.reports.length,
        passed: passedItems,
        failed: problemItems,
        skipped: noneItems,
      },
    }),
  );
  setText(
    "report-summary-checks",
    t("item-field-validator-report-checks", {
      args: {
        checks: passedChecks + failedChecks + erroredChecks,
        passed: passedChecks,
        failed: failedChecks,
        errors: erroredChecks,
      },
    }),
  );
}

/**
 * The report's top half is an ordinary item list: the standard columns plus one
 * result column that cannot be removed, and the column picker for every other
 * column. Selection is single and drives the fixed detail table below.
 */
async function initItemsList(
  reports: readonly ItemFieldCheckReport[],
): Promise<void> {
  const container = document.getElementById("report-tree-container");
  if (!container) {
    return;
  }

  const items = reports
    .map((report) => Zotero.Items.get(Number(report.itemId)))
    .filter((item): item is Zotero.Item => Boolean(item));
  if (!items.length) {
    container.setAttribute("hidden", "true");
    return;
  }

  try {
    const loader = window.require;
    const CollectionViewItemTree = loader("zotero/collectionViewItemTree");
    const { COLUMNS } = loader("zotero/itemTreeColumns") as {
      COLUMNS: ItemTreeColumnOption[];
    };

    const columns: ItemTreeColumnOption[] = COLUMNS.map((column) => {
      const clone = { ...column };
      clone.hidden = !["title", "firstCreator", "date"].includes(clone.dataKey);
      return clone;
    });
    columns.push({
      dataKey: RESULT_COLUMN_KEY,
      label: t("item-field-validator-column-result"),
      // Always visible and not offered in the column picker: it is the report.
      hidden: false,
      showInColumnPicker: false,
      width: 120,
      minWidth: 100,
      sortable: true,
      renderCell: renderItemResultCell,
    });

    const tree: _ZoteroTypes.CollectionViewItemTree =
      await CollectionViewItemTree.init(container, {
        id: TREE_ID,
        dragAndDrop: false,
        // Other standard columns can be added; the result column is not in the
        // picker, so it can never be turned off.
        columnPicker: true,
        regularOnly: true,
        multiSelect: false,
        columns,
        getExtraField: (item: Zotero.Item, key: string) =>
          key === RESULT_COLUMN_KEY ? getResultSortKey(item) : undefined,
        onSelectionChange: () => {
          renderDetails(itemsView?.getSelectedItems?.()[0] ?? null);
        },
        onActivate: (_event: Event, activated: Zotero.Item[]) => {
          const item = activated[0];
          if (!item) return;
          const mainWindow = Zotero.getMainWindow();
          void Zotero.getActiveZoteroPane()?.selectItem(item.id);
          if (mainWindow) {
            // @ts-expect-error activate is not typed
            Zotero.Utilities.Internal.activate(mainWindow);
          }
        },
      });
    itemsView = tree;
    await tree.changeCollectionTreeRow(makeResultCollectionTreeRow(items));
    // Show the first item's checks without requiring a click.
    window.setTimeout(() => {
      try {
        const selection = tree.selection as unknown as
          { select?: (index: number) => void } | undefined;
        selection?.select?.(0);
      } catch (error) {
        log.debug("无法预选检查报告的第一行", error);
      }
    });
  } catch (error) {
    log.error("初始化字段检查报告列表失败", error);
    container.textContent = t("item-field-validator-empty");
  }
}

function renderItemResultCell(
  _index: number,
  data: string,
  column: ItemTreeColumnOption,
  _isFirstColumn?: boolean,
  doc: Document = document,
): Element {
  const cell = doc.createElement("span");
  cell.className =
    `cell ${column.className ?? ""} banyan-validator-result`.trim();
  const [, status = "none", itemID = ""] = data.split("\u0000");
  const icon = doc.createElement("span");
  icon.className = `banyan-validator-status-icon is-${status}`;
  icon.setAttribute("aria-hidden", "true");
  const label = doc.createElement("span");
  label.className = "label";
  label.textContent = statusText(status as CheckStatus);
  cell.append(icon, label);

  const report = reportsByItemID.get(itemID);
  const details = report ? formatCheckDetails(report) : "";
  if (details) {
    cell.title = details;
  }
  return cell;
}

/** `rank \0 status \0 itemID`: the rank makes issue rows sort first. */
function getResultSortKey(item: Zotero.Item): string {
  const report = reportsByItemID.get(String(item.id));
  const status = report ? itemStatus(countChecks(report.checks)) : "none";
  const rank = { error: 0, fail: 1, none: 2, pass: 3 }[status];
  return `${rank}\u0000${status}\u0000${item.id}`;
}

function makeResultCollectionTreeRow(items: Zotero.Item[]) {
  const libraryID = Zotero.Libraries?.userLibraryID ?? 1;
  return {
    id: "banyan-field-check-report-row",
    view: {},
    ref: { libraryID },
    visibilityGroup: "",
    isSearchMode: () => true,
    isSearch: () => true,
    isLibrary: () => false,
    isCollection: () => false,
    isPublications: () => false,
    isDuplicates: () => false,
    isFeeds: () => false,
    isFeedsOrFeed: () => false,
    isTrash: () => false,
    isShare: () => false,
    getItems: async () => items,
    setSearch: () => undefined,
  };
}

/**
 * The selected item's checks, in a fixed three-column table.
 */
function renderDetails(item: Zotero.Item | null | undefined): void {
  const pane = document.getElementById("report-details") as HTMLElement | null;
  const container = document.getElementById(
    "report-details-table-container",
  ) as HTMLElement | null;
  if (!pane || !container) return;

  const report = item ? reportsByItemID.get(String(item.id)) : undefined;
  if (!report) {
    pane.setAttribute("hidden", "true");
    detailRows = [];
    // Keep the mounted table. Clearing the container detaches the React tree,
    // and creating a second VirtualizedTableHelper on the same container starts
    // another React root while the first one stays registered in the window.
    container.style.removeProperty("height");
    return;
  }

  pane.removeAttribute("hidden");
  detailRows = report.checks.map((check) => ({
    title: check.description,
    description: formatCheckDetail(check),
    status: check.status,
    message: formatCheckDetail(check),
  }));
  sortDetailRows();

  const emptyEl = document.getElementById(
    "report-details-empty",
  ) as HTMLElement | null;
  const hasChecks = detailRows.length > 0;
  container.hidden = !hasChecks;
  if (emptyEl) emptyEl.hidden = hasChecks;
  if (!hasChecks) {
    container.style.removeProperty("height");
    return;
  }

  // A small table: size it to its rows so the list above keeps the space.
  container.style.height = `${Math.min(240, 32 + detailRows.length * 28)}px`;

  if (!detailTableHelper) {
    detailTableHelper = createDetailTable();
  }
  detailTableHelper
    .setProp("getRowCount", () => detailRows.length)
    .setProp("getRowData", (index: number) => {
      const row = detailRows[index];
      return {
        title: row?.title ?? "",
        description: row?.description ?? "",
        result: row ? statusText(row.status) : "",
      };
    })
    .setProp("getRowString", (index: number) => detailRows[index]?.title ?? "");
  detailTableHelper.render(-1, () => undefined);
}

function sortDetailRows(): void {
  if (!detailSort) return;
  const { key, ascending } = detailSort;
  const rank: Record<CheckStatus, number> = { error: 0, fail: 1, pass: 2 };
  detailRows.sort((a, b) => {
    let result: number;
    if (key === "result") {
      result = rank[a.status] - rank[b.status];
    } else if (key === "title") {
      result = a.title.localeCompare(b.title, Zotero.locale);
    } else {
      result = a.description.localeCompare(b.description, Zotero.locale);
    }
    return result * ascending;
  });
}

function createDetailTable(): VirtualizedTableHelper {
  const columns: ItemTreeColumnOption[] = [
    {
      dataKey: "title",
      label: t("item-field-validator-column-title"),
      width: 220,
      fixedWidth: false,
      className: "title",
      renderCell: renderDetailTitleCell,
    },
    {
      dataKey: "description",
      label: t("item-field-validator-column-description"),
      flex: 1,
      minWidth: 160,
      className: "description",
      renderCell: renderDetailDescriptionCell,
    },
    {
      dataKey: "result",
      label: t("item-field-validator-column-result"),
      width: 120,
      minWidth: 90,
      className: "result",
      renderCell: renderDetailResultCell,
    },
  ];

  return new ztoolkit.VirtualizedTable(window)
    .setContainerId("report-details-table-container")
    .setProp({
      id: DETAIL_TABLE_ID,
      columns: columns as unknown as ColumnOptions[],
      showHeader: true,
      multiSelect: false,
      // `staticColumns` would also disable the resizers; the three columns are
      // fixed, but their widths should follow the user's drags.
      staticColumns: false,
      disableFontSizeScaling: true,
    })
    .setProp("onColumnSort", (columnIndex: number, ascending: 1 | -1) => {
      const key = columns[columnIndex]?.dataKey;
      if (!key) return;
      detailSort = { key, ascending };
      sortDetailRows();
      detailTableHelper?.render(-1, () => undefined);
    })
    .setProp("getRowCount", () => detailRows.length)
    .setProp("getRowData", (index: number) => {
      const row = detailRows[index];
      return {
        title: row?.title ?? "",
        description: row?.description ?? "",
        result: row ? statusText(row.status) : "",
      };
    });
}

function renderDetailTitleCell(
  index: number,
  _data: string,
  column: ItemTreeColumnOption,
): Element {
  return renderTextCell(index, column, "title");
}

function renderDetailDescriptionCell(
  index: number,
  _data: string,
  column: ItemTreeColumnOption,
): Element {
  const cell = renderTextCell(index, column, "description");
  const row = detailRows[index];
  if (row?.message) {
    cell.title = row.message;
  }
  return cell;
}

function renderDetailResultCell(
  index: number,
  _data: string,
  column: ItemTreeColumnOption,
): Element {
  const cell = createCell(column);
  const row = detailRows[index];
  if (!row) return cell;
  const icon = document.createElement("span");
  icon.className = `banyan-validator-status-icon is-${row.status}`;
  icon.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = statusText(row.status);
  cell.append(icon, label);
  if (row.message) {
    cell.title = row.message;
  }
  return cell;
}

function renderTextCell(
  index: number,
  column: ItemTreeColumnOption,
  key: "title" | "description",
): HTMLSpanElement {
  const cell = createCell(column);
  const row = detailRows[index];
  if (!row) return cell;
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = row[key];
  cell.appendChild(label);
  return cell;
}

function createCell(column: ItemTreeColumnOption): HTMLSpanElement {
  const cell = document.createElement("span");
  cell.className = ["cell", column.className].filter(Boolean).join(" ");
  return cell;
}

function countChecks(checks: readonly FieldCheckEntry[]): CheckCounts {
  const counts: CheckCounts = {
    total: checks.length,
    pass: 0,
    fail: 0,
    error: 0,
  };
  for (const check of checks) {
    counts[check.status]++;
  }
  return counts;
}

function itemStatus(counts: CheckCounts): CheckStatus | "none" {
  if (!counts.total) return "none";
  if (counts.error) return "error";
  if (counts.fail) return "fail";
  return "pass";
}

function statusText(status: CheckStatus): string {
  switch (status) {
    case "pass":
      return t("item-field-validator-status-pass");
    case "fail":
      return t("item-field-validator-status-fail");
    default:
      return t("item-field-validator-status-error");
  }
}

/** One line per non-passing check, used as the result cell's tooltip. */
function formatCheckDetails(report: ItemFieldCheckReport): string {
  return report.checks
    .filter((check) => check.status !== "pass")
    .map((check) => {
      const detail = formatCheckDetail(check);
      return detail
        ? `• ${check.description}: ${detail}`
        : `• ${check.description}`;
    })
    .join("\n");
}

function formatCheckDetail(check: FieldCheckEntry): string {
  if (check.status === "pass") {
    return "";
  }
  if (check.status === "error") {
    if (check.error === "invalid-result") {
      return t("item-field-validator-check-invalid-result");
    }
    if (check.error === "timeout") {
      return t("item-field-validator-check-timeout");
    }
    return check.messages.length
      ? t("item-field-validator-check-error", {
          args: { message: check.messages.join(" · ") },
        })
      : t("item-field-validator-check-error-unknown");
  }
  return check.messages.join(" · ");
}

function setText(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function destroy(): void {
  itemsView?.unregister();
  itemsView = null;
  detailTableHelper = null;
  detailRows = [];
  reportsByItemID = new Map();
}
