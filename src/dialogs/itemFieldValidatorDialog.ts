import type { FieldCheckEntry } from "../../typings/itemFieldValidator";
import { useL10n } from "../utils/locale";
import { unwrapDialogIO } from "../utils/window";
import type {
  ItemFieldCheckReport,
  ItemFieldValidatorDialogIO,
} from "../../typings/itemFieldValidator";
import { createLogger } from "../utils/logger";

const log = createLogger("item-field-validator-dialog");

const t = useL10n(["itemFieldValidatorDialog.ftl"]);

function logFailure(message: string, error?: unknown): void {
  const detail =
    error === undefined
      ? ""
      : `: ${error instanceof Error ? error.message : String(error)}`;
  log.warn(`${message}${detail}`);
}

type ItemRow = {
  kind: "item";
  report: ItemFieldCheckReport;
  expanded: boolean;
  index: number;
};

type CheckRow = {
  kind: "check";
  check: FieldCheckEntry;
  parentIndex: number;
};

type VisibleRow = ItemRow | CheckRow;

type CheckCounts = {
  total: number;
  pass: number;
  fail: number;
  error: number;
};

type TreeInstance = {
  invalidate: () => void;
  focus: () => void;
  selection: {
    select: (index: number) => void;
    clearSelection: () => void;
  };
};

let itemRows: ItemRow[] = [];
let visibleRows: VisibleRow[] = [];
let tree: TreeInstance | null = null;
let root: {
  render: (element: unknown) => void;
  unmount: () => void;
} | null = null;

window.addEventListener("load", initDialog);
window.addEventListener("unload", destroyTree);

function initDialog(): void {
  const io = unwrapDialogIO<ItemFieldValidatorDialogIO>(window.arguments?.[0]);
  if (!io) {
    logFailure("window IO is missing");
    return;
  }

  renderHeader(io);
  buildItemRows(io.reports);
  rebuildVisibleRows();
  bindButtons();
  initTree();
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

  const empty = document.getElementById("report-empty");
  if (empty) {
    if (reportData.reports.length) {
      empty.setAttribute("hidden", "true");
    } else {
      empty.removeAttribute("hidden");
    }
  }
}

function buildItemRows(reports: readonly ItemFieldCheckReport[]): void {
  itemRows = reports.map((report) => ({
    kind: "item",
    report,
    expanded: hasIssues(report.checks),
    index: -1,
  }));
}

function rebuildVisibleRows(): void {
  visibleRows = [];
  for (const item of itemRows) {
    item.index = visibleRows.length;
    visibleRows.push(item);
    if (!item.expanded) {
      continue;
    }
    for (const check of item.report.checks) {
      visibleRows.push({
        kind: "check",
        check,
        parentIndex: item.index,
      });
    }
  }
}

function initTree(): void {
  const container = document.getElementById("report-tree-container");
  if (!container) {
    return;
  }

  try {
    const loader = window.require;
    const React = loader("react");
    const ReactDOM = loader("react-dom");
    const { VirtualizedTree, makeRowRenderer } = loader(
      "components/virtualized-table",
    );
    const { IntlProvider } = loader("react-intl");

    const baseRenderItem = makeRowRenderer(getRowData);
    const renderItem = (
      index: number,
      selection: unknown,
      oldElem: HTMLElement | null,
      columns: unknown,
    ): Node =>
      decorateRow(baseRenderItem(index, selection, oldElem, columns), index);

    const props = {
      id: "banyan-item-field-validator-tree",
      getRowCount: () => visibleRows.length,
      getRowData,
      renderItem,
      columns: [
        {
          dataKey: "name",
          label: t("item-field-validator-column-name"),
          flex: 1,
          minWidth: 220,
        },
        {
          dataKey: "detail",
          label: t("item-field-validator-column-detail"),
          flex: 2,
          minWidth: 220,
        },
        {
          dataKey: "result",
          label: t("item-field-validator-column-result"),
          fixedWidth: true,
          width: 120,
        },
      ],
      showHeader: true,
      multiSelect: false,
      staticColumns: true,
      disableFontSizeScaling: true,
      getParentIndex,
      isContainer,
      isContainerEmpty,
      isContainerOpen,
      onToggleOpenState: toggleOpenState,
      getRowString: (index: number) => String(getRowData(index).name ?? ""),
      onActivate: (_event: Event, indexes?: readonly number[]) => {
        if (typeof indexes?.[0] === "number") {
          toggleOpenState(indexes[0]);
        }
      },
      onSelectionChange: () => {
        // The report is read-only; selection only drives native focus/scroll.
      },
      ref: (ref: TreeInstance | null) => {
        tree = ref;
      },
      role: "tree",
      label: t("item-field-validator-tree-label"),
    };

    root = ReactDOM.createRoot(container);
    root?.render(
      React.createElement(
        IntlProvider,
        { locale: Zotero.locale, messages: Zotero.Intl.strings },
        React.createElement(VirtualizedTree, props),
      ),
    );
  } catch (error) {
    logFailure("初始化字段检查报告树失败", error);
    container.textContent = t("item-field-validator-tree-error");
  }
}

function getRowData(index: number): Record<string, string> {
  const row = visibleRows[index];
  if (!row) {
    return { name: "", detail: "", result: "" };
  }

  if (row.kind === "item") {
    const counts = countChecks(row.report.checks);
    return {
      name: row.report.title,
      detail: formatItemDetail(row.report),
      result: formatItemResult(counts),
      status: itemStatus(counts),
    };
  }

  return {
    name: row.check.description,
    detail: formatCheckDetail(row.check),
    result: statusLabel(row.check.status),
    status: row.check.status,
  };
}

function decorateRow(node: Node, index: number): Node {
  if (!isElementNode(node)) {
    return node;
  }

  const row = visibleRows[index];
  node.classList.add("banyan-validator-row");
  if (row?.kind === "check") {
    node.classList.add(
      "banyan-validator-check-row",
      `banyan-validator-${row.check.status}`,
    );
    const firstCell = node.querySelector(".cell");
    if (firstCell) {
      const icon = (node.ownerDocument ?? document).createElement("span");
      icon.className = `banyan-validator-status banyan-validator-status-${row.check.status}`;
      icon.textContent = statusGlyph(row.check.status);
      icon.setAttribute("aria-hidden", "true");
      firstCell.prepend(icon);
    }
  } else {
    node.classList.add("banyan-validator-item-row");
  }

  for (const cell of node.querySelectorAll(".cell")) {
    if (cell.textContent) {
      cell.setAttribute("title", cell.textContent);
    }
  }
  return node;
}

function getParentIndex(index: number): number {
  const row = visibleRows[index];
  return row?.kind === "check" ? row.parentIndex : -1;
}

function isContainer(index: number): boolean {
  const row = visibleRows[index];
  return row?.kind === "item" && row.report.checks.length > 0;
}

function isContainerEmpty(index: number): boolean {
  const row = visibleRows[index];
  return row?.kind !== "item" || row.report.checks.length === 0;
}

function isContainerOpen(index: number): boolean {
  const row = visibleRows[index];
  return row?.kind === "item" && row.expanded;
}

function toggleOpenState(index: number): void {
  const row = visibleRows[index];
  if (!row || row.kind !== "item" || !row.report.checks.length) {
    return;
  }

  row.expanded = !row.expanded;
  rebuildVisibleRows();
  tree?.invalidate();
  const itemIndex = row.index;
  window.setTimeout(() => {
    tree?.selection.select(itemIndex);
  });
}

function bindButtons(): void {
  document.getElementById("expand-all")?.addEventListener("click", () => {
    for (const item of itemRows) {
      item.expanded = item.report.checks.length > 0;
    }
    rebuildVisibleRows();
    tree?.invalidate();
    tree?.selection.clearSelection();
  });

  document.getElementById("collapse-all")?.addEventListener("click", () => {
    for (const item of itemRows) {
      item.expanded = false;
    }
    rebuildVisibleRows();
    tree?.invalidate();
    tree?.selection.clearSelection();
  });

  document.getElementById("close-button")?.addEventListener("click", () => {
    window.close();
  });
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

function hasIssues(checks: readonly FieldCheckEntry[]): boolean {
  return checks.some((check) => check.status !== "pass");
}

function itemStatus(counts: CheckCounts): "pass" | "fail" | "error" | "none" {
  if (!counts.total) return "none";
  if (counts.error) return "error";
  if (counts.fail) return "fail";
  return "pass";
}

function formatItemDetail(report: ItemFieldCheckReport): string {
  return [report.itemTypeLabel, report.firstCreator, report.year]
    .filter(Boolean)
    .join(" · ");
}

function formatItemResult(counts: CheckCounts): string {
  if (!counts.total) {
    return t("item-field-validator-status-none");
  }
  if (counts.error) {
    return t("item-field-validator-item-result-error", {
      args: { count: counts.error },
    });
  }
  if (counts.fail) {
    return t("item-field-validator-item-result-fail", {
      args: { count: counts.fail },
    });
  }
  return t("item-field-validator-item-result-pass", {
    args: { count: counts.total },
  });
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

function statusLabel(status: FieldCheckEntry["status"]): string {
  switch (status) {
    case "pass":
      return t("item-field-validator-status-pass");
    case "fail":
      return t("item-field-validator-status-fail");
    default:
      return t("item-field-validator-status-error");
  }
}

function statusGlyph(status: FieldCheckEntry["status"]): string {
  switch (status) {
    case "pass":
      return "✓";
    case "fail":
      return "✗";
    default:
      return "!";
  }
}

function setText(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

/**
 * The row node may be created by Zotero's module realm rather than this dialog;
 * a bare `instanceof Element` would then be false. `nodeType` is realm-neutral.
 */
function isElementNode(node: Node): node is Element {
  return node.nodeType === 1;
}

function destroyTree(): void {
  try {
    root?.unmount();
  } catch (error) {
    logFailure("卸载字段检查报告树失败", error);
  }
  root = null;
  tree = null;
  visibleRows = [];
  itemRows = [];
}
