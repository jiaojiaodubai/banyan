import type { CitationContext } from "../../../typings/style";
import type { CitationSource, Cite } from "../../../typings/style";
import type { TextUnit } from "../../../typings/unit";
import type {
  CitationRequestData,
  CitationResponseData,
} from "../../../typings/server";
import type { IO as CitationDialogIO } from "../citationDialog";
import { VirtualizedTableHelper } from "zotero-plugin-toolkit";
import { createStyle } from "../../modules/sandbox";
import {
  getStyleEditorAssets,
  parseStyleEditorJSCompilerOptions,
  type StyleEditorAssets,
} from "../../modules/styleEditor";
import { renderUnitsToFragment } from "../../components/richTextEditor";
import { useL10n } from "../../utils/locale";
import { parseBanyanEntryLink } from "../../utils/html";
import { updateStyleCodeUpdatedTimestamp } from "../../utils/styleUpdated";
import {
  ensureDataDir,
  getStyleFilePathById,
  loadStyles,
  readStyleFile,
  saveStyleCodeById,
} from "../../modules/styles";
import { parseStyleSnippets, type SnippetItem } from "./snippets";
import {
  formatRuntimeErrorDetails,
  getErrorDebugString,
  type FormattedRuntimeError,
} from "./runtimeErrors";

type MonacoEditor = {
  getValue: () => string;
  setValue: (value: string) => void;
  getModel: () => MonacoModel | null;
  focus: () => void;
  setPosition?: (position: { lineNumber: number; column: number }) => void;
  revealPositionInCenter?: (position: {
    lineNumber: number;
    column: number;
  }) => void;
  trigger: (source: string, handlerId: string, payload: unknown) => void;
  updateOptions?: (options: Record<string, unknown>) => void;
};

type MonacoAPI = {
  editor: {
    setTheme: (theme: string) => void;
    setModelMarkers: (
      model: unknown,
      owner: string,
      markers: MonacoMarker[],
    ) => void;
    EndOfLineSequence: { LF: number };
  };
  MarkerSeverity: {
    Error: number;
    Warning: number;
  };
  languages: {
    typescript: {
      ScriptTarget?: {
        ES2022?: number;
        ESNext?: number;
        Latest?: number;
        [target: string]: number | undefined;
      };
      ModuleKind?: {
        ESNext?: number;
        [moduleKind: string]: number | undefined;
      };
      ModuleResolutionKind?: {
        NodeJs?: number;
        Node10?: number;
        [moduleResolutionKind: string]: number | undefined;
      };
      javascriptDefaults: {
        setDiagnosticsOptions: (options: Record<string, unknown>) => void;
        setCompilerOptions: (options: Record<string, unknown>) => void;
        addExtraLib: (content: string, filePath?: string) => void;
      };
    };
    CompletionItemKind?: {
      Snippet?: number;
    };
    CompletionItemInsertTextRule?: {
      InsertAsSnippet?: number;
    };
    registerCompletionItemProvider?: (
      language: string,
      provider: {
        provideCompletionItems: () => { suggestions: MonacoCompletionEntry[] };
      },
    ) => unknown;
  };
};

type MonacoModel = {
  onDidChangeContent?: (listener: () => void) => void;
};

type MonacoLoaderResult = {
  monaco: MonacoAPI;
  editor: MonacoEditor;
};

type FrameMonacoWindow = Window & {
  loadMonaco?: (opts: Record<string, unknown>) => Promise<MonacoLoaderResult>;
};

type VirtualizedColumnLike = {
  className?: string;
};

type SelectionLike = {
  selected?: {
    values?: () => Iterator<number>;
  };
};

const DEFAULT_EDITOR_FONT_SIZE = 13;
const MIN_EDITOR_FONT_SIZE = 10;
const MAX_EDITOR_FONT_SIZE = 28;
const MONACO_FONT_FAMILY = "Monaco, Consolas, Inconsolata, monospace";
type ViewPanel = "input" | "output";
type OutputViewMode = "preview" | "lint" | "help";

type TemplateItem = {
  id: string;
  title: string;
  path: string;
};

type MonacoCompletionEntry = {
  label: string;
  kind: number;
  insertText: string;
  insertTextRules: number;
  detail?: string;
  documentation?: string;
  filterText?: string;
};

let editorFontSize = DEFAULT_EDITOR_FONT_SIZE;
let bottomPreviewHeightPx: number | null = null;
let rightPreviewWidthPx: number | null = null;
let citationRows: CitationRow[] = [];
let selectedCitationRowId: string | null = null;
let outputViewMode: OutputViewMode = "help";
let citationRowsTableHelper: VirtualizedTableHelper | null = null;

type DataStyleMenuItem = {
  title: string;
  fullPath: string;
};

type ItemTypeHelpMenuItem = {
  itemType: string;
  typeName: string;
  label: string;
};

type ESLintMessage = {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: 1 | 2;
  message: string;
  ruleId?: string | null;
};

type ESLintResult = {
  messages: ESLintMessage[];
};

type ESLintRuntimeStrategy = {
  commandPath: string;
  reason: string;
};

type MonacoMarker = {
  startLineNumber: number;
  endLineNumber: number;
  startColumn: number;
  endColumn: number;
  message: string;
  severity: number;
};

type LintSeverity = "error" | "warning";

type LintItem = {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  severity: LintSeverity;
};

type CitationRow = {
  id: string;
  page: number;
  source: CitationSource;
};

const t = useL10n(["styleEditor.ftl", "citationDialog.ftl"]);

const TEMPLATE_MENU_ITEMS: TemplateItem[] = [
  {
    id: "numeric-basic",
    title: "Numeric Basic",
    path: "numeric-basic.js",
  },
  {
    id: "author-date-basic",
    title: "Author-Date Basic",
    path: "author-date-basic.js",
  },
  {
    id: "note-basic",
    title: "Note Basic",
    path: "note-basic.js",
  },
];

let monaco: MonacoAPI | null = null;
let editor: MonacoEditor | null = null;
let helpDocEditor: MonacoEditor | null = null;
let lintTimer: number | null = null;
let lintRunId = 0;
let styleEditorAssets: StyleEditorAssets | null = null;
let eslintCommandCandidatesCache: string[] | null | undefined;
let eslintConfigPathCache: string | null | undefined;
let editorEmptyStateEl: HTMLDivElement | null = null;
let citationRowsEmptyStateEl: HTMLDivElement | null = null;
let itemTypeHelpMenuItems: ItemTypeHelpMenuItem[] = [];
let helpDocEditorInitPromise: Promise<boolean> | null = null;
let helpDocRenderId = 0;
let styleSnippetItemsCache: SnippetItem[] | null = null;
let previewDebugLogs: string[] = [];

const MIN_EDITOR_PANE_WIDTH = 280;
const MIN_PREVIEW_PANE_WIDTH = 260;
const MIN_EDITOR_TOP_HEIGHT = 120;
const MIN_BOTTOM_PREVIEW_HEIGHT = 120;
const MAX_SIDE_BAR_RATIO = 0.5;
const MAX_BOTTOM_PREVIEW_RATIO = 0.5;
const MIN_CITATION_PAGE = 1;
const DEFAULT_LINT_STDIN_FILENAME = "addon/content/styleEditor/banyan-style.js";
const STYLE_SNIPPETS_FILE_NAME = "snippets.jsonc";
const MAX_PREVIEW_DEBUG_LOG_LINES = 120;
let lintStdinFilename = DEFAULT_LINT_STDIN_FILENAME;

const { Subprocess } = ChromeUtils.importESModule(
  "resource://gre/modules/Subprocess.sys.mjs",
) as typeof import("resource://gre/modules/Subprocess.sys.mjs");
type SubprocessReadable =
  import("resource://gre/modules/Subprocess.sys.mjs").SubprocessReadable;
type SubprocessProcess =
  import("resource://gre/modules/Subprocess.sys.mjs").SubprocessProcess;

window.addEventListener("load", () => {
  void initStyleEditor();
});

async function initStyleEditor(): Promise<void> {
  styleEditorAssets = await getStyleEditorAssets();
  try {
    await getStyleSnippetItems();
  } catch (e) {
    ztoolkit.logError(e);
  }
  localizeMenuLabels();
  await initMenuPlaceholders();
  bindActions();
  bindShortcuts();
  initCitationRowsInput();
  bindViewMenuStateSync();
  bindPaneResizer();
  await initMonaco();
  void preloadHelpDocEditor();
  editor?.setValue("");
  renderPreviewPlaceholder();
  setOutputMode("preview");
  syncRightPaneVisibility();
  syncViewMenuChecks();
  setStatus(t("style-editor-status-ready"));
}

function preloadHelpDocEditor(): void {
  void ensureHelpDocEditor();
}

async function initMonaco(): Promise<void> {
  const iframe = document.getElementById(
    "style-editor-iframe",
  ) as HTMLIFrameElement | null;
  if (!iframe?.contentWindow) {
    throw new Error("Monaco iframe not available");
  }

  const prefersDark =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  const frameWindow = iframe.contentWindow as FrameMonacoWindow;
  const loadMonaco = frameWindow.loadMonaco;
  if (typeof loadMonaco !== "function") {
    throw new Error("Monaco loader not available");
  }
  const monacoLoaded = await loadMonaco({
    language: "javascript",
    theme: prefersDark?.matches ? "vs-dark" : "vs-light",
    fontFamily: MONACO_FONT_FAMILY,
    fontSize: editorFontSize,
    insertSpaces: true,
    tabSize: 2,
  });

  monaco = monacoLoaded.monaco as MonacoAPI;
  editor = monacoLoaded.editor as MonacoEditor;
  setEditorFontSize(DEFAULT_EDITOR_FONT_SIZE);

  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  if (!styleEditorAssets) {
    throw new Error("Style editor assets not loaded");
  }
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(
    buildMonacoCompilerOptions(monaco, styleEditorAssets.jsConfigText),
  );
  monaco.languages.typescript.javascriptDefaults.addExtraLib(
    styleEditorAssets.itemTypesDTS,
    "inmemory://addon/content/styleEditor/item.d.ts",
  );
  monaco.languages.typescript.javascriptDefaults.addExtraLib(
    styleEditorAssets.unitTypesDTS,
    "inmemory://addon/content/styleEditor/unit.d.ts",
  );
  monaco.languages.typescript.javascriptDefaults.addExtraLib(
    styleEditorAssets.styleTypesDTS,
    "inmemory://addon/content/styleEditor/style.d.ts",
  );
  monaco.languages.typescript.javascriptDefaults.addExtraLib(
    styleEditorAssets.styleUtilsDTS,
    "inmemory://addon/content/styleEditor/styleUtils.d.ts",
  );

  initEditorEmptyState();

  const model = editor.getModel();
  model?.onDidChangeContent?.(() => {
    updateEditorEmptyState();
    if (lintTimer !== null) {
      window.clearTimeout(lintTimer);
    }
    lintTimer = window.setTimeout(() => {
      void runLint();
      lintTimer = null;
    }, 180);
  });

  if (prefersDark) {
    prefersDark.addEventListener("change", (ev: MediaQueryListEvent) => {
      monaco?.editor.setTheme(ev.matches ? "vs-dark" : "vs-light");
    });
  }

  registerMonacoSnippetCompletions();
}

function buildMonacoCompilerOptions(
  monacoRef: MonacoAPI,
  jsConfigText: string,
): Record<string, unknown> {
  const sharedOptions = parseStyleEditorJSCompilerOptions(jsConfigText);
  const compilerOptions: Record<string, unknown> = {
    allowNonTsExtensions: true,
  };

  copyCompilerOption(sharedOptions, compilerOptions, "allowJs");
  copyCompilerOption(sharedOptions, compilerOptions, "noEmit");
  copyCompilerOption(sharedOptions, compilerOptions, "moduleDetection");
  copyCompilerOption(sharedOptions, compilerOptions, "lib", normalizeLibOption);

  const target = normalizeScriptTarget(monacoRef, sharedOptions.target);
  if (target !== undefined) {
    compilerOptions.target = target;
  }

  const moduleKind = normalizeModuleKind(monacoRef, sharedOptions.module);
  if (moduleKind !== undefined) {
    compilerOptions.module = moduleKind;
  }

  // Internal Monaco diagnostics are intentionally stricter than the exported
  // jsconfig so authors see JSDoc/type problems while editing.
  compilerOptions.checkJs = true;
  return compilerOptions;
}

function copyCompilerOption(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
  normalize?: (value: unknown) => unknown,
): void {
  if (!(key in source)) {
    return;
  }
  target[key] = normalize ? normalize(source[key]) : source[key];
}

function normalizeLibOption(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.toLowerCase() : ""))
    .filter(Boolean);
}

function normalizeScriptTarget(
  monacoRef: MonacoAPI,
  value: unknown,
): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return lookupMonacoEnumValue(monacoRef.languages.typescript.ScriptTarget, [
    value,
    value.toUpperCase(),
    value.replace(/^ES/i, "ES"),
    "Latest",
  ]);
}

function normalizeModuleKind(
  monacoRef: MonacoAPI,
  value: unknown,
): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return lookupMonacoEnumValue(monacoRef.languages.typescript.ModuleKind, [
    value,
    value.toUpperCase(),
    value.replace(/^ES/i, "ES"),
  ]);
}

function lookupMonacoEnumValue(
  source: Record<string, number | undefined> | undefined,
  names: string[],
): number | undefined {
  if (!source) {
    return undefined;
  }
  for (const name of names) {
    const value = source[name];
    if (typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

function registerMonacoSnippetCompletions(): void {
  if (!monaco) return;
  const languages = monaco.languages;
  if (typeof languages.registerCompletionItemProvider !== "function") {
    return;
  }

  const snippetKind = languages.CompletionItemKind?.Snippet ?? 27;
  const insertAsSnippet =
    languages.CompletionItemInsertTextRule?.InsertAsSnippet ?? 4;

  languages.registerCompletionItemProvider("javascript", {
    provideCompletionItems: () => {
      const snippets = styleSnippetItemsCache || [];
      const suggestions: MonacoCompletionEntry[] = [];
      for (const item of snippets) {
        for (const prefix of item.prefixes) {
          suggestions.push({
            label: prefix,
            kind: snippetKind,
            insertText: item.body,
            insertTextRules: insertAsSnippet,
            detail: item.name,
            documentation: item.description,
            filterText: `${prefix} ${item.name}`,
          });
        }
      }
      return { suggestions };
    },
  });
}

function initEditorEmptyState(): void {
  const editorTopPane = document.getElementById(
    "editor-top-pane",
  ) as HTMLElement | null;
  if (!editorTopPane) return;

  editorEmptyStateEl = mountPanelEmptyState(editorTopPane, {
    id: "editor-empty-state",
    text: t("style-editor-editor-hint"),
    onClick: () => {
      editor?.focus();
    },
    interactive: false,
  });
  updateEditorEmptyState();
}

function mountPanelEmptyState(
  container: HTMLElement,
  options: {
    id: string;
    text: string;
    onClick?: () => void;
    interactive?: boolean;
  },
): HTMLDivElement {
  const old = container.querySelector(`#${CSS.escape(options.id)}`);
  old?.remove();

  const overlay = document.createElement("div");
  overlay.id = options.id;
  overlay.className = "panel-empty-state";
  overlay.textContent = options.text;

  if (options.interactive) {
    overlay.classList.add("panel-empty-state-interactive");
  }
  if (options.onClick) {
    overlay.addEventListener("click", options.onClick);
  }

  container.appendChild(overlay);
  return overlay;
}

function updateEditorEmptyState(): void {
  if (!editorEmptyStateEl || !editor) return;
  editorEmptyStateEl.hidden = editor.getValue() !== "";
}

function bindActions(): void {
  const _reservedMenuHandlers = [
    onNewStyle,
    onOpenStyle,
    onApplyTemplate,
    initTemplateOptions,
    refreshPreview,
    saveStyle,
  ];
  void _reservedMenuHandlers;
  bindMenuActions();
}

function bindShortcuts(): void {
  window.addEventListener("keydown", (event: KeyboardEvent) => {
    const action = resolveShortcutAction(event);
    if (!action) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void handleMenuAction(action);
  });
}

function resolveShortcutAction(event: KeyboardEvent): string | null {
  if (event.defaultPrevented || event.isComposing) {
    return null;
  }

  const key = event.key.toLowerCase();
  const accel = event.ctrlKey || event.metaKey;

  if (!accel && !event.altKey && !event.shiftKey && event.key === "F5") {
    return "run.refreshPreview";
  }

  if (!accel || event.altKey) {
    if (!accel && !event.altKey && !event.metaKey && !event.ctrlKey) {
      return event.key === "Delete" ? "edit.delete" : null;
    }
    return null;
  }

  switch (key) {
    case "n":
      return "file.new";
    case "s":
      return event.shiftKey ? null : "file.saveAs";
    case "z":
      return event.shiftKey ? null : "edit.undo";
    case "y":
      return event.shiftKey ? null : "edit.redo";
    case "x":
      return event.shiftKey ? null : "edit.cut";
    case "c":
      return event.shiftKey ? null : "edit.copy";
    case "v":
      return event.shiftKey ? null : "edit.paste";
    case "a":
      return event.shiftKey ? null : "edit.selectAll";
    case "f":
      return event.shiftKey ? null : "edit.find";
    case "0":
      return event.shiftKey ? null : "view.font.reset";
    case "=":
    case "+":
      return "view.font.increase";
    case "-":
      return event.shiftKey ? null : "view.font.decrease";
    default:
      break;
  }

  if (event.code === "NumpadAdd") {
    return "view.font.increase";
  }
  if (event.code === "NumpadSubtract") {
    return "view.font.decrease";
  }

  return null;
}

function initCitationRowsInput(): void {
  citationRows = [];
  selectedCitationRowId = null;
  initCitationRowsEmptyState();

  citationRowsTableHelper = new ztoolkit.VirtualizedTable(window)
    .setContainerId("citation-rows-table-container")
    .setProp({
      id: `${addon.data.config.addonRef}-citation-rows-table`,
      columns: [
        {
          dataKey: "page",
          label: t("style-editor-input-page-column"),
          fixedWidth: true,
          width: 64,
        },
        {
          dataKey: "cites",
          label: t("style-editor-input-cites-column"),
          fixedWidth: false,
          width: 240,
          renderer: (
            index: number,
            _data: string,
            column: VirtualizedColumnLike,
          ) => {
            return renderCitationCitesCell(index, column);
          },
        } as unknown as {
          dataKey: string;
          label: string;
          fixedWidth: boolean;
          width: number;
        },
      ],
      showHeader: true,
      multiSelect: false,
      staticColumns: true,
      disableFontSizeScaling: true,
    })
    .setProp("onSelectionChange", (selection: SelectionLike) => {
      const index = selection?.selected?.values?.().next?.().value;
      if (index === undefined) return;
      const row = citationRows[index];
      if (!row) return;
      selectedCitationRowId = row.id;
      syncCitationRowPageInput();
      updateCitationRowButtons();
    })
    .setProp("onActivate", () => {
      void openSelectedCitationRowDialog();
      return true;
    })
    .setProp("onKeyDown", (event: KeyboardEvent) => {
      if (isCitationRowsAddKey(event)) {
        void addCitationRowAndOpenDialog();
        return false;
      }

      if (isCitationRowsRemoveKey(event)) {
        removeSelectedCitationRow();
        return false;
      }

      if (event.shiftKey && event.key === "ArrowUp") {
        moveSelectedCitationRow(-1);
        return false;
      }

      if (event.shiftKey && event.key === "ArrowDown") {
        moveSelectedCitationRow(1);
        return false;
      }

      if (event.key === "Enter" || event.key === "Insert") {
        void openSelectedCitationRowDialog();
        return false;
      }
      return true;
    })
    .setProp("onItemContextMenu", () => {
      // Reserved for future row actions.
    });

  const pageInput = document.getElementById(
    "citation-row-page-input",
  ) as HTMLInputElement | null;
  pageInput?.addEventListener("change", () => {
    if (!selectedCitationRowId) return;
    onCitationRowPageChanged(selectedCitationRowId, pageInput.value);
  });

  const addBtn = document.getElementById("citation-row-add");
  addBtn?.setAttribute("title", t("style-editor-input-add-tooltip"));
  addBtn?.addEventListener("click", () => {
    void addCitationRowAndOpenDialog();
  });

  const removeBtn = document.getElementById("citation-row-remove");
  removeBtn?.setAttribute("title", t("style-editor-input-remove-tooltip"));
  removeBtn?.addEventListener("click", () => {
    removeSelectedCitationRow();
  });

  const upBtn = document.getElementById("citation-row-up");
  upBtn?.setAttribute("title", t("style-editor-input-move-up-tooltip"));
  upBtn?.addEventListener("click", () => {
    moveSelectedCitationRow(-1);
  });

  const downBtn = document.getElementById("citation-row-down");
  downBtn?.setAttribute("title", t("style-editor-input-move-down-tooltip"));
  downBtn?.addEventListener("click", () => {
    moveSelectedCitationRow(1);
  });

  updateCitationRowButtons();
  void renderCitationRowsTable();
}

function initCitationRowsEmptyState(): void {
  const listWrap = document.getElementById(
    "citation-rows-list-wrap",
  ) as HTMLElement | null;
  if (!listWrap) return;

  citationRowsEmptyStateEl = mountPanelEmptyState(listWrap, {
    id: "citation-rows-empty-state",
    text: t("style-editor-input-empty-hint"),
    onClick: () => {
      void addCitationRowAndOpenDialog();
    },
    interactive: true,
  });
  updateCitationRowsEmptyState();
}

function updateCitationRowsEmptyState(): void {
  if (!citationRowsEmptyStateEl) return;
  citationRowsEmptyStateEl.hidden = citationRows.length > 0;
}

function createCitationRow(): CitationRow {
  return {
    id: crypto.randomUUID(),
    page: MIN_CITATION_PAGE,
    source: {
      cites: [],
      params: {
        sortBy: "cite",
        prefix: "",
        suffix: "",
      },
    },
  };
}

function addCitationRow(options?: { render?: boolean }): string {
  const row = createCitationRow();
  citationRows.push(row);
  citationRows.sort((a, b) => a.page - b.page);
  selectedCitationRowId = row.id;
  updateCitationRowsEmptyState();
  if (options?.render !== false) {
    void renderCitationRowsTable();
  }
  return row.id;
}

async function addCitationRowAndOpenDialog(): Promise<void> {
  const rowId = addCitationRow({ render: false });
  await openCitationDialogForRow(rowId);
}

function removeSelectedCitationRow(): void {
  if (!selectedCitationRowId) return;
  const index = citationRows.findIndex((r) => r.id === selectedCitationRowId);
  if (index < 0) return;

  citationRows.splice(index, 1);
  if (!citationRows.length) {
    selectedCitationRowId = null;
  } else {
    selectedCitationRowId = citationRows[Math.max(0, index - 1)]?.id ?? null;
  }
  void renderCitationRowsTable();
}

function moveSelectedCitationRow(direction: -1 | 1): void {
  if (!selectedCitationRowId) return;
  const index = citationRows.findIndex((r) => r.id === selectedCitationRowId);
  if (index < 0) return;
  const target = index + direction;
  if (target < 0 || target >= citationRows.length) return;

  const next = [...citationRows];
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row);
  if (!isCitationRowsSortedByPage(next)) {
    setStatus(t("style-editor-status-ready") + " (page order constrained)");
    return;
  }
  citationRows = next;
  void renderCitationRowsTable();
}

function isCitationRowsSortedByPage(rows: CitationRow[]): boolean {
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].page < rows[i - 1].page) {
      return false;
    }
  }
  return true;
}

async function renderCitationRowsTable(): Promise<void> {
  if (!citationRowsTableHelper) return;

  updateCitationRowsEmptyState();

  const selectedIndex = citationRows.findIndex(
    (row) => row.id === selectedCitationRowId,
  );

  await new Promise<void>((resolve) => {
    citationRowsTableHelper
      ?.setProp("getRowCount", () => citationRows.length)
      .setProp("getRowData", (index: number) => {
        const row = citationRows[index];
        if (!row) {
          return {
            page: "",
            cites: "",
          };
        }
        return {
          page: String(row.page),
          cites: getCitationCitesSummaryText(
            getCitationSourceCites(row.source),
          ),
        };
      })
      .setProp(
        "getRowString",
        (index: number) =>
          `${citationRows[index]?.page ?? ""} ${getCitationCitesSummaryText(getCitationSourceCites(citationRows[index]?.source)) || t("style-editor-input-cites-placeholder")}`,
      )
      .render(selectedIndex >= 0 ? selectedIndex : -1, () => resolve());
  });

  window.setTimeout(() => {
    citationRowsTableHelper?.treeInstance.invalidate();
  });
  syncCitationRowPageInput();
  updateCitationRowButtons();
  updateCitationRowsEmptyState();
}

function onCitationRowPageChanged(rowId: string, rawValue: string): void {
  const row = citationRows.find((item) => item.id === rowId);
  if (!row) return;

  const prev = row.page;
  const next = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(next) || next < MIN_CITATION_PAGE) {
    row.page = prev;
    syncCitationRowPageInput();
    return;
  }

  row.page = next;
  if (!isCitationRowsSortedByPage(citationRows)) {
    row.page = prev;
    setStatus(t("style-editor-status-ready") + " (page order constrained)");
  }
  void renderCitationRowsTable();
}

function getCitationSourceCites(source: CitationSource | undefined): Cite[] {
  const rawCites = source?.cites as unknown;
  if (!rawCites) {
    return [];
  }

  if (Array.isArray(rawCites)) {
    return rawCites;
  }

  if (typeof rawCites === "object") {
    try {
      return Array.from(rawCites as ArrayLike<Cite>);
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeCitationSource(source: CitationSource): CitationSource {
  return {
    cites: [...getCitationSourceCites(source)],
    params: { ...(source.params ?? {}) },
  };
}

function getCitationCitesSummaryText(cites: Cite[]): string {
  if (!cites.length) {
    return "";
  }
  return cites
    .map((cite) => {
      const item = cite.item;
      const creator = String(item?.firstCreator || "Unknown");
      const year = String(item?.year || "n.d.");
      return `${creator}-${year}`;
    })
    .join("; ");
}

function renderCitationCitesCell(
  index: number,
  column: VirtualizedColumnLike,
): HTMLElement {
  const cell = document.createElement("span");
  cell.className = `cell ${column?.className ?? ""}`.trim();
  const row = citationRows[index];
  const cites = row ? getCitationSourceCites(row.source) : [];
  if (!row || !cites.length) {
    cell.classList.add("citation-cites-placeholder");
    cell.textContent = t("style-editor-input-cites-placeholder");
    return cell;
  }
  cell.textContent = getCitationCitesSummaryText(cites);
  return cell;
}

function hasPendingEmptyCitationRow(): boolean {
  return citationRows.some(
    (row) => getCitationSourceCites(row.source).length === 0,
  );
}

function setToolbarButtonDisabled(
  button: HTMLButtonElement | null,
  disabled: boolean,
): void {
  if (!button) {
    return;
  }

  button.disabled = disabled;
  button.toggleAttribute("disabled", disabled);
}

function setCitationRowButtonTooltip(
  button: HTMLButtonElement | null,
  defaultTooltipKey: string,
  blockedByPendingEmptyRow: boolean,
): void {
  if (!button) {
    return;
  }

  const tooltipKey = blockedByPendingEmptyRow
    ? "style-editor-input-fill-empty-cites-tooltip"
    : defaultTooltipKey;
  button.setAttribute("title", t(tooltipKey));
}

function updateCitationRowButtons(): void {
  const addBtn = document.getElementById(
    "citation-row-add",
  ) as HTMLButtonElement | null;
  const removeBtn = document.getElementById(
    "citation-row-remove",
  ) as HTMLButtonElement | null;
  const upBtn = document.getElementById(
    "citation-row-up",
  ) as HTMLButtonElement | null;
  const downBtn = document.getElementById(
    "citation-row-down",
  ) as HTMLButtonElement | null;

  const index = selectedCitationRowId
    ? citationRows.findIndex((row) => row.id === selectedCitationRowId)
    : -1;

  const hasPendingEmptyRow = hasPendingEmptyCitationRow();
  const disableAdd = hasPendingEmptyRow;
  const disableUp = hasPendingEmptyRow || index <= 0;
  const disableDown =
    hasPendingEmptyRow || index < 0 || index >= citationRows.length - 1;

  setToolbarButtonDisabled(addBtn, disableAdd);
  setToolbarButtonDisabled(removeBtn, index < 0);
  setToolbarButtonDisabled(upBtn, disableUp);
  setToolbarButtonDisabled(downBtn, disableDown);

  setCitationRowButtonTooltip(
    addBtn,
    "style-editor-input-add-tooltip",
    hasPendingEmptyRow,
  );
  setCitationRowButtonTooltip(
    upBtn,
    "style-editor-input-move-up-tooltip",
    hasPendingEmptyRow,
  );
  setCitationRowButtonTooltip(
    downBtn,
    "style-editor-input-move-down-tooltip",
    hasPendingEmptyRow,
  );
}

function syncCitationRowPageInput(): void {
  const pageInput = document.getElementById(
    "citation-row-page-input",
  ) as HTMLInputElement | null;
  if (!pageInput) return;
  const row = citationRows.find((item) => item.id === selectedCitationRowId);
  pageInput.value = String(row?.page ?? MIN_CITATION_PAGE);
}

async function openSelectedCitationRowDialog(): Promise<void> {
  if (!selectedCitationRowId) return;
  await openCitationDialogForRow(selectedCitationRowId);
}

function isCitationRowsAddKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key === "+" || event.code === "NumpadAdd";
}

function isCitationRowsRemoveKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return false;
  }
  return event.key === "-" || event.code === "NumpadSubtract";
}

async function openCitationDialogForRow(rowId: string): Promise<void> {
  const row = citationRows.find((item) => item.id === rowId);
  if (!row || !editor) return;

  try {
    const code = editor.getValue();
    if (!code.trim()) {
      notifyCitationStyleRequired();
      return;
    }

    const parsedStyle = await createStyle(code);
    const styleUI = parsedStyle.UI;

    const result = await openCitationDialog({
      documentId: "style-editor",
      style: styleUI ?? { cite: [], citation: [] },
      source: row.source,
    });
    if (result) {
      row.source = normalizeCitationSource(result);
      selectedCitationRowId = row.id;
      setStatus(t("style-editor-status-ready"));
    }
    updateCitationRowButtons();
    await renderCitationRowsTable();
  } catch (e) {
    setStatus(`${t("style-editor-error-prefix")}: ${String(e)}`);
    ztoolkit.logError(e);
  }
}

function notifyCitationStyleRequired(): void {
  const message = t("style-editor-status-style-required-for-citation");
  setStatus(message);
  try {
    Services.prompt.alert(
      window as unknown as mozIDOMWindowProxy,
      t("style-editor-error-prefix"),
      message,
    );
  } catch {
    // Ignore alert failures in environments where prompt service is unavailable.
  }
}

function openCitationDialog(
  data: CitationRequestData,
): Promise<CitationResponseData | null> {
  return new Promise((resolve, reject) => {
    const io: CitationDialogIO = {
      data,
      resolve,
    };
    try {
      Services.ww.openWindow(
        // @ts-expect-error Services.ww.openWindow has incomplete type definitions
        null,
        `chrome://${addon.data.config.addonRef}/content/citationDialog.xhtml`,
        "banyan-style-editor-citation-dialog",
        "chrome,modal,centerscreen",
        io,
      );
    } catch (e) {
      reject(e);
    }
  });
}

function localizeMenuLabels(): void {
  const nodes = document.querySelectorAll<HTMLElement>("[data-menu-l10n-key]");
  for (const node of nodes) {
    const labelKey = node.dataset.menuL10nKey;
    if (labelKey) {
      node.setAttribute("label", t(labelKey));
    }
    const accessKey = node.dataset.menuAccesskey;
    if (accessKey) {
      node.setAttribute("accesskey", t(accessKey));
    }
  }

  const toolbarButtons = document.querySelectorAll<HTMLElement>(
    "[data-toolbar-tooltip-key]",
  );
  for (const button of toolbarButtons) {
    const tooltipKey = button.dataset.toolbarTooltipKey;
    if (tooltipKey) {
      button.setAttribute("tooltiptext", t(tooltipKey));
    }
  }
}

async function initMenuPlaceholders(): Promise<void> {
  populateTemplateMenu();
  await populateStyleMenu();
  populateItemTypesHelpMenu();
}

function populateTemplateMenu(): void {
  const popup = document.getElementById(
    "mb-file-load-template-popup",
  ) as XULPopupElement | null;
  if (!popup) return;

  popup.replaceChildren();
  for (const item of TEMPLATE_MENU_ITEMS) {
    const menuitem = document.createXULElement("menuitem");
    menuitem.setAttribute("label", item.title);
    menuitem.setAttribute("data-menu-action", `file.loadTemplate.${item.id}`);
    popup.appendChild(menuitem);
  }
}

async function populateStyleMenu(): Promise<void> {
  const popup = document.getElementById(
    "mb-file-load-style-popup",
  ) as XULPopupElement | null;
  if (!popup) return;

  popup.replaceChildren();
  const styles = await getDataStyleMenuItems();
  for (const item of styles) {
    const menuitem = document.createXULElement("menuitem");
    menuitem.setAttribute("label", item.title);
    menuitem.setAttribute(
      "data-menu-action",
      `file.loadStylePath.${encodeURIComponent(item.fullPath)}`,
    );
    popup.appendChild(menuitem);
  }

  if (!styles.length) {
    const empty = document.createXULElement("menuitem");
    empty.setAttribute("label", "(empty)");
    empty.setAttribute("disabled", "true");
    popup.appendChild(empty);
  }
}

function populateItemTypesHelpMenu(): void {
  const popup = document.getElementById(
    "mb-help-item-types-popup",
  ) as XULPopupElement | null;
  if (!popup) return;

  popup.replaceChildren();
  itemTypeHelpMenuItems = [];

  if (!styleEditorAssets) {
    appendDisabledMenuItem(popup, "(empty)");
    return;
  }

  const parsed = parseItemTypeAliases(styleEditorAssets.itemTypesDTS);
  if (!parsed.length) {
    appendDisabledMenuItem(popup, "(empty)");
    return;
  }

  itemTypeHelpMenuItems = parsed
    .map((item) => ({
      ...item,
      label: getLocalizedItemTypeLabel(item.itemType),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  for (const item of itemTypeHelpMenuItems) {
    const menuitem = document.createXULElement("menuitem");
    menuitem.setAttribute("label", item.label);
    menuitem.setAttribute(
      "data-menu-action",
      `help.itemTypes.${encodeURIComponent(item.itemType)}`,
    );
    popup.appendChild(menuitem);
  }
}

function appendDisabledMenuItem(popup: XULPopupElement, label: string): void {
  const empty = document.createXULElement("menuitem");
  empty.setAttribute("label", label);
  empty.setAttribute("disabled", "true");
  popup.appendChild(empty);
}

function parseItemTypeAliases(source: string): Array<{
  itemType: string;
  typeName: string;
}> {
  // Support both module-style declarations (`export type ...`) and
  // globalized declarations (`type ...`) generated for style editor assets.
  const itemTypeRegex =
    /(?:export\s+)?type\s+(\w+Item)\s*=\s*ItemBase<\s*"([^"]+)"\s*>\s*&\s*\{/g;
  const entries = new Map<string, string>();

  for (const match of source.matchAll(itemTypeRegex)) {
    const typeName = match[1];
    const itemType = match[2];
    entries.set(itemType, typeName);
  }

  return Array.from(entries.entries()).map(([itemType, typeName]) => ({
    itemType,
    typeName,
  }));
}

function getLocalizedItemTypeLabel(itemType: string): string {
  const zoteroItemTypes = Zotero.ItemTypes as
    | { getLocalizedString?: (typeName: string) => string }
    | undefined;

  try {
    const localized = zoteroItemTypes?.getLocalizedString?.(itemType);
    if (localized) {
      return localized;
    }
  } catch {
    // Fallback to type identifier when localization is unavailable.
  }

  return itemType;
}

function runViewMenuAction(action: string): void {
  switch (action) {
    case "view.toggle.input":
      applyPanelVisibility("input", isMenuItemChecked("mb-view-toggle-input"));
      return;
    case "view.toggle.preview":
      applyPanelVisibility(
        "output",
        isMenuItemChecked("mb-view-toggle-preview"),
      );
      return;
    case "view.toggle.info":
      applyPanelVisibility("output", isMenuItemChecked("mb-view-toggle-info"));
      return;
    case "view.font.increase":
      setEditorFontSize(editorFontSize + 1);
      return;
    case "view.font.decrease":
      setEditorFontSize(editorFontSize - 1);
      return;
    case "view.font.reset":
      setEditorFontSize(DEFAULT_EDITOR_FONT_SIZE);
      return;
    default:
      return;
  }
}

function applyPanelVisibility(panel: ViewPanel, visible: boolean): void {
  const mapping: Record<ViewPanel, string> = {
    input: "input-panel-block",
    output: "output-panel-block",
  };
  const block = document.getElementById(mapping[panel]) as HTMLElement | null;
  if (!block) return;

  block.style.display = visible ? "" : "none";
  if (panel === "output") {
    const splitter = document.getElementById(
      "editor-bottom-splitter",
    ) as HTMLElement | null;
    if (splitter) {
      splitter.style.display = visible ? "" : "none";
    }
    if (visible && bottomPreviewHeightPx !== null) {
      block.style.height = `${Math.round(bottomPreviewHeightPx)}px`;
    }
  }

  syncRightPaneVisibility();
  syncViewMenuChecks();
}

function syncRightPaneVisibility(): void {
  const rightPane = document.getElementById("right-pane") as HTMLElement | null;
  const rightSplitter = document.getElementById(
    "editor-preview-splitter",
  ) as HTMLElement | null;
  const inputPane = document.getElementById(
    "input-panel-block",
  ) as HTMLElement | null;

  if (!rightPane || !rightSplitter) {
    return;
  }

  const hasVisibleInput = !!inputPane && inputPane.style.display !== "none";

  rightPane.style.display = hasVisibleInput ? "" : "none";
  rightSplitter.style.display = hasVisibleInput ? "" : "none";
}

function syncViewMenuChecks(): void {
  const mapping: Array<{ menuId: string; blockId: string }> = [
    { menuId: "mb-view-toggle-input", blockId: "input-panel-block" },
    { menuId: "mb-view-toggle-preview", blockId: "output-panel-block" },
    { menuId: "mb-view-toggle-info", blockId: "output-panel-block" },
  ];

  for (const item of mapping) {
    const block = document.getElementById(item.blockId) as HTMLElement | null;
    const visible = !!block && block.style.display !== "none";
    setMenuItemChecked(item.menuId, visible);
  }
}

function setOutputMode(mode: OutputViewMode): void {
  if (outputViewMode === mode) {
    return;
  }
  outputViewMode = mode;
  const views: Array<{ mode: OutputViewMode; id: string }> = [
    { mode: "help", id: "output-help-view" },
    { mode: "lint", id: "output-lint-view" },
    { mode: "preview", id: "output-preview-view" },
  ];

  for (const view of views) {
    const node = document.getElementById(view.id);
    if (!node) continue;
    node.classList.toggle("active", view.mode === mode);
  }
}

function bindViewMenuStateSync(): void {
  const popup = document.getElementById("mb-view-popup");
  if (!popup) return;
  popup.addEventListener("popupshowing", () => {
    syncViewMenuChecks();
  });
}

function isMenuItemChecked(menuItemId: string): boolean {
  const node = document.getElementById(menuItemId);
  return node?.getAttribute("checked") === "true";
}

function setMenuItemChecked(menuItemId: string, checked: boolean): void {
  const node = document.getElementById(menuItemId);
  if (!node) return;
  if (checked) {
    node.setAttribute("checked", "true");
  } else {
    node.removeAttribute("checked");
  }
}

function setEditorFontSize(nextSize: number): void {
  editorFontSize = Math.max(
    MIN_EDITOR_FONT_SIZE,
    Math.min(MAX_EDITOR_FONT_SIZE, nextSize),
  );
  const options = {
    fontSize: editorFontSize,
    fontFamily: MONACO_FONT_FAMILY,
  };
  editor?.updateOptions?.(options);
  helpDocEditor?.updateOptions?.(options);
}

async function getDataStyleMenuItems(): Promise<DataStyleMenuItem[]> {
  const dirPath = await ensureDataDir();
  const styleMetaByFilename = new Map<string, { title?: string; id: string }>();
  for (const style of addon.data.styles.files.values()) {
    styleMetaByFilename.set(style.filename, {
      title: style.title,
      id: style.id,
    });
  }

  const children = await IOUtils.getChildren(dirPath).catch(
    () => [] as string[],
  );
  const items: DataStyleMenuItem[] = [];
  for (const fullPath of children) {
    if (!fullPath.endsWith(".js")) {
      continue;
    }
    const filename = PathUtils.filename(fullPath);
    const meta = styleMetaByFilename.get(filename);
    const fallbackTitle = filename.replace(/\.js$/i, "");
    items.push({
      title: meta?.title || meta?.id || fallbackTitle,
      fullPath,
    });
  }
  return items.sort((a, b) => a.title.localeCompare(b.title));
}

function bindMenuActions(): void {
  const nodes = document.querySelectorAll<HTMLElement>("[data-menu-action]");
  for (const node of nodes) {
    const action = node.dataset.menuAction;
    if (!action) continue;

    node.addEventListener("command", (ev: Event) => {
      ev.preventDefault();
      void handleMenuAction(action);
    });
  }
}

async function handleMenuAction(action: string): Promise<void> {
  if (action === "file.new") {
    onNewStyle();
    return;
  }

  if (action === "file.loadStyle") {
    await onOpenStyle();
    return;
  }

  if (action === "file.saveAs") {
    await saveStyle();
    return;
  }

  if (action.startsWith("file.loadTemplate.")) {
    const templateId = action.slice("file.loadTemplate.".length);
    await openTemplateById(templateId);
    return;
  }

  if (action.startsWith("file.loadStylePath.")) {
    const encoded = action.slice("file.loadStylePath.".length);
    const fullPath = decodeURIComponent(encoded);
    await openStyleFromPath(fullPath);
    return;
  }

  if (action.startsWith("edit.")) {
    runEditMenuAction(action);
    return;
  }

  if (action.startsWith("view.")) {
    runViewMenuAction(action);
    return;
  }

  if (action.startsWith("run.")) {
    await runRuntimeAction(action);
    return;
  }

  if (action.startsWith("help.")) {
    runHelpMenuAction(action);
    return;
  }

  ztoolkit.log(`[style-editor menu] ${action}`);
}

async function runRuntimeAction(action: string): Promise<void> {
  if (action === "run.refreshPreview") {
    applyPanelVisibility("output", true);
    setOutputMode("preview");
    await refreshPreview();
    return;
  }
  if (action === "run.formatLint") {
    applyPanelVisibility("output", true);
    setOutputMode("lint");
    await runLint();
    return;
  }
}

function runHelpMenuAction(action: string): void {
  if (!styleEditorAssets) {
    return;
  }

  if (action.startsWith("help.itemTypes.")) {
    const encodedItemType = action.slice("help.itemTypes.".length);
    const itemType = decodeURIComponent(encodedItemType);
    const menuItem = itemTypeHelpMenuItems.find(
      (item) => item.itemType === itemType,
    );
    const title = menuItem
      ? `${t("style-editor-menu-help-item-types")} - ${menuItem.label}`
      : `${t("style-editor-menu-help-item-types")} - ${itemType}`;
    const content = renderResolvedItemTypesDTS(
      styleEditorAssets.itemTypesDTS,
      itemType,
    );

    applyPanelVisibility("output", true);
    setOutputMode("help");
    renderInfoDocument(title, content);
    setStatus(`${t("style-editor-status-ready")}: ${title}`);
    return;
  }

  const helpDocs: Record<string, { title: string; content: string }> = {
    "help.utilityFunctions": {
      title: t("style-editor-menu-help-utility-functions"),
      content: styleEditorAssets.styleUtilsDTS,
    },
    "help.itemTypes": {
      title: t("style-editor-menu-help-item-types"),
      content: renderResolvedItemTypesDTS(styleEditorAssets.itemTypesDTS),
    },
  };

  const doc = helpDocs[action];
  if (!doc) {
    return;
  }

  applyPanelVisibility("output", true);
  setOutputMode("help");
  renderInfoDocument(doc.title, doc.content);
  setStatus(`${t("style-editor-status-ready")}: ${doc.title}`);
}

function renderResolvedItemTypesDTS(
  source: string,
  targetItemType?: string,
): string {
  try {
    const baseMatch = source.match(
      /(?:export\s+)?type\s+ItemBase<[\s\S]*?>\s*=\s*\{\n([\s\S]*?)\n\};/m,
    );
    if (!baseMatch) return source;

    const baseBody = baseMatch[1]
      .replace(/^[ \t]*\[field:\s*string\]:\s*string;\s*$/m, "")
      .trimEnd();

    const itemTypeRegex =
      /(?:export\s+)?type\s+(\w+Item)\s*=\s*ItemBase<\s*"([^"]+)"\s*>\s*&\s*\{\n([\s\S]*?)\n\};/g;
    const resolvedBlocks: string[] = [];
    const unionMembers: string[] = [];

    for (const match of source.matchAll(itemTypeRegex)) {
      const typeName = match[1];
      const itemType = match[2];
      const itemTypeLiteral = `"${itemType}"`;
      const rawBody = match[3];

      if (targetItemType && itemType !== targetItemType) {
        continue;
      }

      unionMembers.push(typeName);

      const creatorsMatch = rawBody.match(
        /^[ \t]*creators\?:\s*Creator<([\s\S]*?)>\[];\s*$/m,
      );

      const specificBody = rawBody
        .replace(/^[ \t]*creators\?:\s*Creator<[\s\S]*?>\[];\s*$/m, "")
        .trimEnd();

      const resolvedBase = baseBody.replace(
        /\bitemType:\s*T;/,
        `itemType: ${itemTypeLiteral};`,
      );

      let creatorsExpanded = "";
      if (creatorsMatch) {
        const creatorTypeUnion = creatorsMatch[1].trim().replace(/\s+/g, " ");
        creatorsExpanded = `\n  creators?: (\n    | { creatorType: ${creatorTypeUnion}; firstName: string; lastName: string; name?: never }\n    | { creatorType: ${creatorTypeUnion}; firstName?: never; lastName?: never; name: string }\n  )[];`;
      }

      resolvedBlocks.push(
        `export type ${typeName} = {\n${resolvedBase}\n${specificBody}${creatorsExpanded}\n};`,
      );
    }

    if (!resolvedBlocks.length) {
      return source;
    }

    if (targetItemType) {
      return [
        `// Resolved item type definition for ${targetItemType}`,
        ...resolvedBlocks,
        "",
      ].join("\n");
    }

    const resolvedUnion = `export type Item =\n  | ${unionMembers.join("\n  | ")};`;

    return [
      "// Resolved item type definitions (ItemBase/Creator dereferenced)",
      ...resolvedBlocks,
      "",
      resolvedUnion,
      "",
    ].join("\n");
  } catch {
    return source;
  }
}

function runEditMenuAction(action: string): void {
  const monacoCommandMap: Record<string, string> = {
    "edit.undo": "undo",
    "edit.redo": "redo",
    "edit.cut": "editor.action.clipboardCutAction",
    "edit.copy": "editor.action.clipboardCopyAction",
    "edit.paste": "editor.action.clipboardPasteAction",
    "edit.delete": "deleteLeft",
    "edit.selectAll": "editor.action.selectAll",
    "edit.find": "actions.find",
  };

  const editorCommand = monacoCommandMap[action];
  if (editorCommand && triggerEditorAction(editorCommand)) {
    return;
  }

  const execCommandMap: Record<string, string> = {
    "edit.undo": "undo",
    "edit.redo": "redo",
    "edit.cut": "cut",
    "edit.copy": "copy",
    "edit.paste": "paste",
    "edit.delete": "delete",
    "edit.selectAll": "selectAll",
  };
  const fallback = execCommandMap[action];
  if (fallback) {
    try {
      document.execCommand(fallback);
      return;
    } catch (e) {
      ztoolkit.logError(e);
    }
  }

  ztoolkit.log(`[style-editor menu] unsupported edit action: ${action}`);
}

function triggerEditorAction(commandId: string): boolean {
  if (!editor) return false;
  try {
    editor.focus();
    editor.trigger("banyan-menu", commandId, undefined);
    return true;
  } catch {
    return false;
  }
}

function bindPaneResizer(): void {
  const main = document.querySelector("main") as HTMLElement | null;
  const centerPane = document.getElementById(
    "center-pane",
  ) as HTMLElement | null;
  const rightPane = document.getElementById("right-pane") as HTMLElement | null;
  const rightSplitter = document.getElementById(
    "editor-preview-splitter",
  ) as HTMLElement | null;
  const bottomSplitter = document.getElementById(
    "editor-bottom-splitter",
  ) as HTMLElement | null;
  const bottomPreviewBlock = document.getElementById(
    "output-panel-block",
  ) as HTMLElement | null;
  if (!main || !centerPane || !rightPane || !rightSplitter) {
    return;
  }

  type ResizerConfig = {
    splitterEl: HTMLElement;
    cursorClass: "resizing-panes" | "resizing-panes-y";
    axis: "x" | "y";
    minSize: number;
    getInitialSize: () => number;
    getMaxSizeFromLayout: () => number;
    getStoredSize: () => number | null;
    setStoredSize: (size: number) => void;
    applySizeStyle: (size: number) => void;
    deltaScale?: 1 | -1;
  };

  const bindClampedResizer = (config: ResizerConfig): void => {
    let dragging = false;
    let startPos = 0;
    let startSize = 0;
    let maxSizeAtDragStart = config.minSize;

    const clampSize = (desiredSize: number, maxSize: number): number => {
      return Math.max(
        config.minSize,
        Math.min(desiredSize, Math.max(config.minSize, maxSize)),
      );
    };

    const applySize = (desiredSize: number, maxSize: number): void => {
      const clamped = clampSize(desiredSize, maxSize);
      const rounded = Math.round(clamped);
      if (config.getStoredSize() === rounded) {
        return;
      }
      config.setStoredSize(rounded);
      config.applySizeStyle(rounded);
    };

    const onMouseMove = (ev: MouseEvent): void => {
      if (!dragging) return;
      const pos = config.axis === "x" ? ev.clientX : ev.clientY;
      const delta = pos - startPos;
      applySize(
        startSize + delta * (config.deltaScale ?? -1),
        maxSizeAtDragStart,
      );
    };

    const onMouseUp = (): void => {
      if (!dragging) return;
      dragging = false;
      document.body?.classList.remove(config.cursorClass);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    config.splitterEl.addEventListener("mousedown", (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      dragging = true;
      startPos = config.axis === "x" ? ev.clientX : ev.clientY;
      startSize = config.getInitialSize();
      maxSizeAtDragStart = config.getMaxSizeFromLayout();
      document.body?.classList.add(config.cursorClass);
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    });

    window.addEventListener("resize", () => {
      const stored = config.getStoredSize();
      if (stored !== null) {
        applySize(stored, config.getMaxSizeFromLayout());
      }
    });

    const initialStored = config.getStoredSize();
    if (initialStored === null) {
      config.setStoredSize(Math.round(config.getInitialSize()));
    }
    const nextStored = config.getStoredSize();
    if (nextStored !== null) {
      applySize(nextStored, config.getMaxSizeFromLayout());
    }
  };

  bindClampedResizer({
    splitterEl: rightSplitter,
    cursorClass: "resizing-panes",
    axis: "x",
    minSize: MIN_PREVIEW_PANE_WIDTH,
    getInitialSize: () => rightPane.getBoundingClientRect().width,
    getMaxSizeFromLayout: () => {
      const mainWidth = main.getBoundingClientRect().width;
      if (mainWidth <= 0) return MIN_PREVIEW_PANE_WIDTH;

      const splitterWidth = rightSplitter.getBoundingClientRect().width || 0;
      const maxByEditorMin = mainWidth - MIN_EDITOR_PANE_WIDTH - splitterWidth;
      const maxByRatio = mainWidth * MAX_SIDE_BAR_RATIO;
      return Math.max(
        MIN_PREVIEW_PANE_WIDTH,
        Math.min(maxByEditorMin, maxByRatio),
      );
    },
    getStoredSize: () => rightPreviewWidthPx,
    setStoredSize: (size: number) => {
      rightPreviewWidthPx = size;
    },
    applySizeStyle: (size: number) => {
      rightPane.style.width = `${size}px`;
    },
    deltaScale: -1,
  });

  if (bottomSplitter && bottomPreviewBlock) {
    bindClampedResizer({
      splitterEl: bottomSplitter,
      cursorClass: "resizing-panes-y",
      axis: "y",
      minSize: MIN_BOTTOM_PREVIEW_HEIGHT,
      getInitialSize: () => bottomPreviewBlock.getBoundingClientRect().height,
      getMaxSizeFromLayout: () => {
        const centerHeight = centerPane.getBoundingClientRect().height;
        if (centerHeight <= 0) {
          return MIN_BOTTOM_PREVIEW_HEIGHT;
        }
        const maxByEditorMin = centerHeight - MIN_EDITOR_TOP_HEIGHT;
        const maxByRatio = centerHeight * MAX_BOTTOM_PREVIEW_RATIO;
        return Math.max(
          MIN_BOTTOM_PREVIEW_HEIGHT,
          Math.min(maxByEditorMin, maxByRatio),
        );
      },
      getStoredSize: () => bottomPreviewHeightPx,
      setStoredSize: (size: number) => {
        bottomPreviewHeightPx = size;
      },
      applySizeStyle: (size: number) => {
        bottomPreviewBlock.style.height = `${size}px`;
      },
      deltaScale: -1,
    });
  }
}

function onNewStyle(): void {
  if (!editor) return;
  lintStdinFilename = DEFAULT_LINT_STDIN_FILENAME;
  editor.setValue("");
  citationRows = [createCitationRow()];
  selectedCitationRowId = citationRows[0].id;
  void renderCitationRowsTable();
  setOutputMode("preview");
  renderPreviewPlaceholder();
  setStatus(t("style-editor-status-ready"));
}

async function openTemplateById(templateId: string): Promise<void> {
  if (!editor) return;
  const template = TEMPLATE_MENU_ITEMS.find((item) => item.id === templateId);
  if (!template) return;

  const url = `chrome://${addon.data.config.addonRef}/content/styleEditor/templates/${template.path}`;
  const code = await Zotero.File.getContentsFromURLAsync(url);
  applyLoadedCode(code, template.path);
  setStatus(`${t("style-editor-status-template")}: ${template.title}`);
}

async function openStyleFromPath(fullPath: string): Promise<void> {
  if (!editor) return;
  const code = await readStyleFile(fullPath);
  applyLoadedCode(code, fullPath);
  setStatus(t("style-editor-status-opened", { args: { path: fullPath } }));
}

function applyLoadedCode(code: string, sourcePath?: string): void {
  if (!editor) return;
  lintStdinFilename = normalizeLintStdinFilename(sourcePath);
  editor.setValue(code);
  setOutputMode("preview");
  renderPreviewPlaceholder();
}

function normalizeLintStdinFilename(sourcePath?: string): string {
  if (!sourcePath) {
    return DEFAULT_LINT_STDIN_FILENAME;
  }

  const normalized = String(sourcePath).replace(/\\/g, "/");
  if (normalized.includes("/snippets/")) {
    return normalized;
  }

  return DEFAULT_LINT_STDIN_FILENAME;
}

async function onOpenStyle(): Promise<void> {
  if (!editor) return;
  try {
    const banyanDir = await ensureDataDir();
    const picker = new ztoolkit.FilePicker(
      addon.data.config.addonName,
      "open",
      [["JavaScript", "*.js"]],
      undefined,
      window,
      undefined,
      banyanDir,
    );
    const picked = await picker.open();
    if (!picked) return;

    const fullPath = String(picked);
    let code = "";
    try {
      code = await readStyleFile(fullPath);
      // Validate structure before loading into editor.
      await createStyle(code);
    } catch (e) {
      showInvalidStyleFileAlert(fullPath, e);
      return;
    }

    applyLoadedCode(code, fullPath);
    setStatus(t("style-editor-status-opened", { args: { path: fullPath } }));
  } catch (e) {
    setStatus(`${t("style-editor-error-prefix")}: ${String(e)}`);
    ztoolkit.logError(e);
  }
}

function showInvalidStyleFileAlert(path: string, error: unknown): void {
  const message = t("style-editor-open-invalid-file", {
    args: { path },
  });
  setStatus(`${t("style-editor-error-prefix")}: ${message}`);
  ztoolkit.logError(error);
  try {
    Services.prompt.alert(
      window as unknown as mozIDOMWindowProxy,
      t("style-editor-error-prefix"),
      message,
    );
  } catch {
    // Ignore alert failures in environments where prompt service is unavailable.
  }
}

async function getStyleSnippetItems(): Promise<SnippetItem[]> {
  if (styleSnippetItemsCache) {
    return styleSnippetItemsCache;
  }

  const source = await loadStyleSnippetSource();
  styleSnippetItemsCache = parseStyleSnippets(source);
  return styleSnippetItemsCache;
}

async function loadStyleSnippetSource(): Promise<string> {
  const snippetURL = `chrome://${addon.data.config.addonRef}/content/styleEditor/${STYLE_SNIPPETS_FILE_NAME}`;
  return Zotero.File.getContentsFromURLAsync(snippetURL);
}

async function onApplyTemplate(): Promise<void> {
  if (!editor) return;
  try {
    const select = document.getElementById(
      "template-select",
    ) as HTMLSelectElement | null;
    const selectedId = select?.value ?? "";
    if (!selectedId) return;
    const template = TEMPLATE_MENU_ITEMS.find((item) => item.id === selectedId);
    if (!template) {
      throw new Error(`Template '${selectedId}' not found`);
    }
    const url = `chrome://${addon.data.config.addonRef}/content/styleEditor/templates/${template.path}`;
    const code = await Zotero.File.getContentsFromURLAsync(url);
    applyLoadedCode(code);
    setStatus(`${t("style-editor-status-template")}: ${template.title}`);
  } catch (e) {
    setStatus(`${t("style-editor-error-prefix")}: ${String(e)}`);
    ztoolkit.logError(e);
  }
}

async function initTemplateOptions(): Promise<void> {
  const select = document.getElementById(
    "template-select",
  ) as HTMLSelectElement | null;
  if (!select) return;

  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t("style-editor-template-placeholder");
  placeholder.selected = true;
  select.appendChild(placeholder);

  for (const item of TEMPLATE_MENU_ITEMS) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.title;
    select.appendChild(option);
  }
}

async function runLint(): Promise<void> {
  if (!editor || !monaco) return;
  const currentRunId = ++lintRunId;
  const model = editor.getModel();
  const code = editor.getValue();

  setStatus(t("style-editor-status-lint-checking"));

  const output = await runESLint(code);
  if (currentRunId !== lintRunId) {
    ztoolkit.log(
      `[style-editor lint] stale lint result ignored: runId=${currentRunId}, latest=${lintRunId}`,
    );
    return;
  }

  if (output === null) {
    monaco.editor.setModelMarkers(model, "banyan-style-lint", []);
    renderLintResults([], { disabled: true });
    setStatus(t("style-editor-lint-disabled"));
    return;
  }

  const lintItems = eslintOutputToLintItems(output);
  const markers = lintItemsToModelMarkers(lintItems);
  monaco.editor.setModelMarkers(model, "banyan-style-lint", markers);
  renderLintResults(lintItems);
  setStatus(
    t("style-editor-status-lint-done", { args: { count: lintItems.length } }),
  );
}

async function runESLint(code: string): Promise<ESLintResult[] | null> {
  const commandCandidates = await getESLintCommandCandidates();
  if (!commandCandidates?.length) return null;
  const eslintConfigPath = await getESLintConfigPath();
  if (!eslintConfigPath) return null;
  const banyanDir = PathUtils.join(Zotero.DataDirectory.dir, "banyan");
  const runtimeStrategies = buildESLintRuntimeStrategies(commandCandidates);

  let lastFailureMessage = "";
  for (const strategy of runtimeStrategies) {
    const attempt = await runESLintWithStrategy({
      code,
      strategy,
      eslintConfigPath,
      banyanDir,
    });

    if (attempt.ok) {
      return attempt.output;
    }

    lastFailureMessage = attempt.errorMessage;
    ztoolkit.log(
      `[style-editor lint] strategy failed (${strategy.reason}): ${attempt.errorMessage}`,
    );
  }
  return buildESLintExecutionErrorResult(lastFailureMessage);
}

function buildESLintRuntimeStrategies(
  commandCandidates: string[],
): ESLintRuntimeStrategy[] {
  const primaryCommand = commandCandidates[0];

  if (Zotero.isWin) {
    return [
      {
        commandPath: primaryCommand,
        reason: "windows-cmd-primary",
      },
    ];
  }

  return [
    {
      commandPath: primaryCommand,
      reason: "scaffold-default",
    },
  ];
}

async function runESLintWithStrategy(options: {
  code: string;
  strategy: ESLintRuntimeStrategy;
  eslintConfigPath: string;
  banyanDir: string;
}): Promise<
  { ok: true; output: ESLintResult[] } | { ok: false; errorMessage: string }
> {
  const { code, strategy, eslintConfigPath, banyanDir } = options;
  const eslintArguments = [
    "--config",
    eslintConfigPath,
    "--format",
    "json",
    "--stdin",
    "--stdin-filename",
    lintStdinFilename,
  ];

  ztoolkit.log(
    `[style-editor lint] trying strategy=${strategy.reason}, command=${strategy.commandPath}, --stdin-filename=${lintStdinFilename}`,
  );

  let proc: SubprocessProcess | undefined;
  try {
    proc = await Subprocess.call({
      command: strategy.commandPath,
      arguments: eslintArguments,
      workdir: banyanDir,
      stderr: "pipe",
    });

    await proc.stdin.write(code);
    await proc.stdin.close();

    const [stdout, stderr, waitResult] = await Promise.all([
      readSubprocessString(proc.stdout),
      readSubprocessString(proc.stderr),
      proc.wait(),
    ]);
    const exitCode =
      typeof waitResult?.exitCode === "number"
        ? waitResult.exitCode
        : getSubprocessExitCode(proc);

    ztoolkit.log(
      `[style-editor lint] strategy=${strategy.reason} finished: exitCode=${String(exitCode)}, stdoutLength=${stdout.length}, stderrLength=${stderr.length}`,
    );

    if (stderr.trim()) {
      ztoolkit.log(`[style-editor lint] subprocess stderr: ${stderr}`);
    }

    if (!stdout.trim()) {
      return {
        ok: false,
        errorMessage: `ESLint produced no JSON output.${stderr.trim() ? ` stderr: ${stderr.trim()}` : ""}`,
      };
    }

    try {
      return {
        ok: true,
        output: JSON.parse(stdout) as ESLintResult[],
      };
    } catch (parseError) {
      const parseErrorText = getErrorDebugString(parseError);
      ztoolkit.log(`[style-editor lint] JSON parse error: ${parseErrorText}`);
      return {
        ok: false,
        errorMessage: `Failed to parse ESLint JSON output: ${parseErrorText}.${stderr.trim() ? ` stderr: ${stderr.trim()}` : ""}`,
      };
    }
  } catch (e) {
    return {
      ok: false,
      errorMessage: `Failed to execute ESLint: ${getErrorDebugString(e)}`,
    };
  } finally {
    if (proc && getSubprocessExitCode(proc) === null) {
      try {
        await proc.kill(0);
      } catch {
        // Ignore process cleanup errors.
      }
    }
  }
}

async function readSubprocessString(
  stream: SubprocessReadable | null | undefined,
): Promise<string> {
  if (!stream?.readString) {
    return "";
  }

  let output = "";
  let chunk: string | null;
  while ((chunk = await stream.readString())) {
    output += chunk;
  }
  return output;
}

function getSubprocessExitCode(
  proc: Pick<SubprocessProcess, "exitCode" | "exitValue"> | null | undefined,
): number | null {
  if (typeof proc?.exitCode === "number") {
    return proc.exitCode;
  }
  if (typeof proc?.exitValue === "number") {
    return proc.exitValue;
  }
  return null;
}

function buildESLintExecutionErrorResult(message: string): ESLintResult[] {
  return [
    {
      messages: [
        {
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: 1,
          severity: 2,
          message,
          ruleId: "eslint-exec",
        },
      ],
    },
  ];
}

async function getESLintConfigPath(): Promise<string | null> {
  if (eslintConfigPathCache !== undefined) {
    ztoolkit.log(
      `[style-editor lint] using cached ESLint config path: ${eslintConfigPathCache}`,
    );
    return eslintConfigPathCache;
  }

  const banyanDir = await ensureDataDir();
  const configPath = PathUtils.join(banyanDir, "eslint.config.mjs");
  const pluginPath = PathUtils.join(
    banyanDir,
    "eslint-plugin-banyan-style.mjs",
  );
  const globalsPath = PathUtils.join(
    banyanDir,
    "eslint-style-utils-globals.mjs",
  );

  try {
    const hasConfig = await IOUtils.exists(configPath);
    const hasPlugin = await IOUtils.exists(pluginPath);
    const hasGlobals = await IOUtils.exists(globalsPath);

    ztoolkit.log(
      `[style-editor lint] enforcing data-dir ESLint assets only: configPath=${configPath}, pluginPath=${pluginPath}, globalsPath=${globalsPath}`,
    );

    if ((!hasConfig || !hasPlugin || !hasGlobals) && styleEditorAssets) {
      await IOUtils.makeDirectory(banyanDir, {
        createAncestors: true,
        ignoreExisting: true,
      });

      if (!hasConfig && styleEditorAssets.eslintConfigText) {
        await IOUtils.writeUTF8(configPath, styleEditorAssets.eslintConfigText);
      }
      if (!hasPlugin && styleEditorAssets.eslintPluginText) {
        await IOUtils.writeUTF8(pluginPath, styleEditorAssets.eslintPluginText);
      }
      if (!hasGlobals && styleEditorAssets.eslintStyleUtilsGlobalsText) {
        await IOUtils.writeUTF8(
          globalsPath,
          styleEditorAssets.eslintStyleUtilsGlobalsText,
        );
      }
    }

    ztoolkit.log(
      `[style-editor lint] data-dir ESLint assets: configExists=${await IOUtils.exists(configPath)}, pluginExists=${await IOUtils.exists(pluginPath)}, globalsExists=${await IOUtils.exists(globalsPath)}`,
    );

    ztoolkit.log(
      `[style-editor lint] using data-dir ESLint config: ${configPath}`,
    );
    eslintConfigPathCache = configPath;
    return configPath;
  } catch (e) {
    ztoolkit.logError(e);
    eslintConfigPathCache = null;
    return null;
  }
}

function eslintOutputToLintItems(output: ESLintResult[]): LintItem[] {
  const result = output[0];
  if (!result?.messages?.length) return [];

  return result.messages.map((msg) => {
    const line = Math.max(msg.line || 1, 1);
    const col = Math.max(msg.column || 1, 1);
    const endLine = Math.max(msg.endLine || line, line);
    const endCol = Math.max(msg.endColumn || col + 1, col + 1);
    const rule = msg.ruleId ? ` (${msg.ruleId})` : "";
    return {
      line,
      column: col,
      endLine,
      endColumn: endCol,
      message: `${msg.message}${rule}`,
      severity: msg.severity === 2 ? "error" : "warning",
    };
  });
}

function lintItemsToModelMarkers(items: LintItem[]): MonacoMarker[] {
  const monacoRef = monaco;
  if (!monacoRef) return [];

  return items.map((item) => ({
    startLineNumber: item.line,
    endLineNumber: item.endLine,
    startColumn: item.column,
    endColumn: item.endColumn,
    message: item.message,
    severity:
      item.severity === "error"
        ? monacoRef.MarkerSeverity.Error
        : monacoRef.MarkerSeverity.Warning,
  }));
}

async function getESLintCommandCandidates(): Promise<string[] | null> {
  if (eslintCommandCandidatesCache !== undefined) {
    ztoolkit.log(
      `[style-editor lint] using cached ESLint command candidates: ${JSON.stringify(eslintCommandCandidatesCache)}`,
    );
    return eslintCommandCandidatesCache;
  }

  const scaffoldDefaultPath = getDefaultESLintPath();
  const windowsCmdPath = `${scaffoldDefaultPath}.cmd`;

  while (true) {
    const [scaffoldExists, cmdExists] = await Promise.all([
      IOUtils.exists(scaffoldDefaultPath),
      Zotero.isWin ? IOUtils.exists(windowsCmdPath) : Promise.resolve(false),
    ]);

    if (Zotero.isWin) {
      ztoolkit.log(
        `[style-editor lint] windows ESLint shim probe: scaffoldPath=${scaffoldDefaultPath} exists=${String(scaffoldExists)}, cmdPath=${windowsCmdPath} exists=${String(cmdExists)}`,
      );
    }

    const candidates: string[] = [];
    if (Zotero.isWin && cmdExists) {
      candidates.push(windowsCmdPath);
    }
    if (scaffoldExists) {
      candidates.push(scaffoldDefaultPath);
    }

    if (candidates.length > 0) {
      eslintCommandCandidatesCache = candidates;
      ztoolkit.log(
        `[style-editor lint] using ESLint command candidates: ${JSON.stringify(candidates)}`,
      );
      return candidates;
    }

    const action = promptInstallESLint(scaffoldDefaultPath);
    if (action !== "retry") {
      eslintCommandCandidatesCache = null;
      return null;
    }
  }
}

function getDefaultESLintPath(): string {
  const banyanDir = PathUtils.join(Zotero.DataDirectory.dir, "banyan");
  return PathUtils.join(banyanDir, "node_modules", ".bin", "eslint");
}

function promptInstallESLint(eslintPath: string): "retry" | "ignore" {
  const promptSvc = Services.prompt;
  const banyanDir = PathUtils.join(Zotero.DataDirectory.dir, "banyan");
  const title = addon.data.config.addonName;
  const msg = t("style-editor-lint-install-eslint", {
    args: {
      path: eslintPath,
      dir: banyanDir,
    },
  });
  const buttonPos0 = promptSvc.BUTTON_POS_0 ?? 0;
  const buttonPos1 = promptSvc.BUTTON_POS_1 ?? 0;
  const buttonPos2 = promptSvc.BUTTON_POS_2 ?? 0;
  const buttonTitleIsString = promptSvc.BUTTON_TITLE_IS_STRING ?? 0;
  const flags =
    buttonPos0 * buttonTitleIsString +
    buttonPos1 * buttonTitleIsString +
    buttonPos2 * buttonTitleIsString;
  const idx = promptSvc.confirmEx(
    window as unknown as mozIDOMWindowProxy,
    title,
    msg,
    flags,
    t("style-editor-lint-btn-retry"),
    t("style-editor-lint-btn-open-node"),
    t("style-editor-lint-btn-ignore-once"),
    "",
    { value: false },
  );
  if (idx === 0) return "retry";
  if (idx === 1) {
    Zotero.launchURL("https://nodejs.org/en/download/");
  }
  return "ignore";
}

function renderLintResults(
  items: LintItem[],
  options?: { disabled?: boolean },
): void {
  const lintEl = document.getElementById(
    "output-lint-view",
  ) as HTMLElement | null;
  if (!lintEl) return;
  lintEl.replaceChildren();

  if (options?.disabled) {
    const ok = document.createElement("div");
    ok.className = "lint-item";
    ok.textContent = t("style-editor-lint-disabled");
    lintEl.appendChild(ok);
    return;
  }

  if (!items.length) {
    const ok = document.createElement("div");
    ok.className = "lint-item";
    ok.textContent = t("style-editor-lint-no-issues");
    lintEl.appendChild(ok);
    return;
  }

  const errors = items.filter((item) => item.severity === "error");
  const warnings = items.filter((item) => item.severity === "warning");

  appendLintGroup(lintEl, "error", errors);
  appendLintGroup(lintEl, "warning", warnings);
}

function appendLintGroup(
  container: HTMLElement,
  severity: LintSeverity,
  items: LintItem[],
): void {
  if (!items.length) {
    return;
  }

  const title = document.createElement("div");
  title.className = `lint-group-title ${severity}`;
  title.textContent = t(
    severity === "error"
      ? "style-editor-lint-group-errors"
      : "style-editor-lint-group-warnings",
    { args: { count: items.length } },
  );
  container.appendChild(title);

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `lint-item lint-item-action ${severity}`;
    button.textContent = `L${item.line}:${item.column} ${item.message}`;
    button.addEventListener("click", () => {
      jumpToLintLocation(item);
    });
    container.appendChild(button);
  }
}

function jumpToLintLocation(item: LintItem): void {
  if (!editor) return;

  const position = {
    lineNumber: item.line,
    column: item.column,
  };

  editor.focus();
  editor.setPosition?.(position);
  editor.revealPositionInCenter?.(position);
}

function renderInfoDocument(title: string, content: string): void {
  const renderId = ++helpDocRenderId;
  const iframe = document.getElementById(
    "output-help-iframe",
  ) as HTMLIFrameElement | null;
  iframe?.setAttribute("title", title);
  void renderInfoDocumentAsync(renderId, content);
}

async function renderInfoDocumentAsync(
  renderId: number,
  content: string,
): Promise<void> {
  const existingHelpEditor = helpDocEditor;
  if (existingHelpEditor) {
    try {
      existingHelpEditor.setValue(content);
      return;
    } catch (e) {
      ztoolkit.logError(e);
      helpDocEditor = null;
      helpDocEditorInitPromise = null;
    }
  }

  const ready = await ensureHelpDocEditor();
  if (renderId !== helpDocRenderId) {
    return;
  }

  const initializedHelpEditor = helpDocEditor;
  if (ready && initializedHelpEditor) {
    initializedHelpEditor.setValue(content);
    return;
  }
}

async function ensureHelpDocEditor(): Promise<boolean> {
  if (helpDocEditor) {
    return true;
  }
  if (helpDocEditorInitPromise) {
    return helpDocEditorInitPromise;
  }

  helpDocEditorInitPromise = (async () => {
    try {
      const helpView = document.getElementById(
        "output-help-view",
      ) as HTMLElement | null;
      if (!helpView) {
        return false;
      }

      let iframe = document.getElementById(
        "output-help-iframe",
      ) as HTMLIFrameElement | null;
      if (!iframe) {
        iframe = document.createElement("iframe");
        iframe.id = "output-help-iframe";
        iframe.className = "info-doc-editor-frame";
        iframe.setAttribute("title", "Help code viewer");
        iframe.src = "chrome://scaffold/content/monaco/monaco.html";
        helpView.replaceChildren(iframe);
      }

      const frameWindow = await waitForHelpFrameWindowReady(iframe);
      if (!frameWindow) return false;

      const loadMonaco = frameWindow.loadMonaco;
      if (!loadMonaco) return false;

      const prefersDark =
        typeof window.matchMedia === "function"
          ? window.matchMedia("(prefers-color-scheme: dark)")
          : null;

      const monacoLoaded = await loadMonaco({
        language: "typescript",
        theme: prefersDark?.matches ? "vs-dark" : "vs-light",
        fontFamily: MONACO_FONT_FAMILY,
        fontSize: editorFontSize,
        readOnly: true,
        domReadOnly: true,
        insertSpaces: true,
        tabSize: 2,
        minimap: { enabled: false },
        lineNumbers: "on",
        renderLineHighlight: "none",
        scrollBeyondLastLine: false,
        automaticLayout: true,
      });

      helpDocEditor = monacoLoaded.editor as MonacoEditor;
      helpDocEditor.setValue("");
      helpDocEditor.updateOptions?.({
        fontFamily: MONACO_FONT_FAMILY,
        fontSize: editorFontSize,
      });

      if (prefersDark) {
        prefersDark.addEventListener("change", (ev: MediaQueryListEvent) => {
          try {
            (monacoLoaded.monaco as MonacoAPI).editor.setTheme(
              ev.matches ? "vs-dark" : "vs-light",
            );
          } catch {
            // Ignore theme sync failures in help-only viewer.
          }
        });
      }

      return true;
    } catch (e) {
      ztoolkit.logError(e);
      return false;
    }
  })();

  const ready = await helpDocEditorInitPromise;
  if (!ready) {
    helpDocEditorInitPromise = null;
  }
  return ready;
}

async function waitForHelpFrameWindowReady(
  frame: HTMLIFrameElement,
): Promise<FrameMonacoWindow | null> {
  const getFrameWindow = () => frame.contentWindow as FrameMonacoWindow | null;

  const frameWindow = getFrameWindow();
  if (frameWindow?.loadMonaco) {
    return frameWindow;
  }

  await new Promise<void>((resolve) => {
    let timer = 0;
    const cleanup = (): void => {
      frame.removeEventListener("load", onLoad);
      frame.removeEventListener("error", onError);
      if (timer) {
        window.clearTimeout(timer);
      }
    };
    const done = (): void => {
      cleanup();
      resolve();
    };
    const onLoad = (): void => done();
    const onError = (): void => done();
    frame.addEventListener("load", onLoad);
    frame.addEventListener("error", onError);
    timer = window.setTimeout(() => done(), 8000);
  });

  return getFrameWindow();
}

async function refreshPreview(): Promise<void> {
  if (!editor) return;
  const editorRef = editor;

  clearPreviewDebugLogs();

  try {
    ztoolkit.log("[style-editor preview] refreshPreview start");
    const style = await createStyle(editorRef.getValue(), {
      debugSink: recordPreviewDebugLog,
    });

    const contexts = await createPreviewContexts();
    logPreviewContextsDebug(contexts);

    let citations: unknown;
    let bibliography: unknown;
    try {
      const result = await style.generate(contexts);
      citations = result.citations;
      bibliography = result.bibliography;
    } catch (e) {
      ztoolkit.log("[style-editor preview] generate failed", {
        error: String(e),
      });
      throw e;
    }

    ztoolkit.log("[style-editor preview] refreshPreview success", {
      citationsIsArray: Array.isArray(citations),
      citationsLength: Array.isArray(citations) ? citations.length : -1,
      bibliographyIsArray: Array.isArray(bibliography),
      bibliographyLength: Array.isArray(bibliography)
        ? bibliography.length
        : -1,
    });

    const safeCitations = Array.isArray(citations) ? citations : [];
    const safeBibliography = Array.isArray(bibliography) ? bibliography : [];
    renderPreview(safeCitations, safeBibliography);
    setStatus(t("style-editor-status-ready"));
  } catch (e) {
    const formattedError = formatRuntimeErrorDetails(e, {
      errorPrefix: t("style-editor-error-prefix"),
    });
    ztoolkit.logError(e);
    ztoolkit.log("[style-editor preview] refreshPreview failed", {
      error: formattedError.summary,
    });
    renderPreviewError(formattedError);
    setStatus(`${t("style-editor-error-prefix")}: ${formattedError.summary}`);
  }
}

function clearPreviewDebugLogs(): void {
  previewDebugLogs = [];
}

function recordPreviewDebugLog(message: string): void {
  previewDebugLogs.push(message);
  if (previewDebugLogs.length > MAX_PREVIEW_DEBUG_LOG_LINES) {
    previewDebugLogs.splice(
      0,
      previewDebugLogs.length - MAX_PREVIEW_DEBUG_LOG_LINES,
    );
  }
}

function renderPreviewDebugSection(container: HTMLElement): void {
  if (!previewDebugLogs.length) {
    return;
  }

  const heading = document.createElement("div");
  heading.className = "preview-heading";
  heading.textContent = "Debug";
  container.appendChild(heading);

  for (const line of previewDebugLogs) {
    const row = document.createElement("div");
    row.className = "preview-line";
    row.textContent = line;
    container.appendChild(row);
  }
}

function logPreviewContextsDebug(contexts: CitationContext[]): void {
  try {
    const summary = contexts.map((ctx) => {
      const rawCites = ctx.cites;
      const firstCite =
        Array.isArray(rawCites) && rawCites.length > 0 ? rawCites[0] : null;
      const firstItem = firstCite?.item;
      return {
        id: ctx.id,
        page: ctx.page,
        citesIsArray: Array.isArray(rawCites),
        citesTag: Object.prototype.toString.call(rawCites),
        citesLength: Array.isArray(rawCites) ? rawCites.length : -1,
        citesMapType: typeof rawCites?.map,
        firstItemTag: firstItem
          ? Object.prototype.toString.call(firstItem)
          : "(none)",
        firstItemKeys: firstItem
          ? Object.keys(firstItem as Record<string, unknown>).slice(0, 8)
          : [],
      };
    });

    ztoolkit.log("[style-editor preview] contexts summary", summary);
  } catch (e) {
    ztoolkit.log("[style-editor preview] contexts summary failed", {
      error: String(e),
    });
  }
}

async function createPreviewContexts(): Promise<CitationContext[]> {
  const contexts: CitationContext[] = [];
  for (const row of citationRows) {
    const cites = getCitationSourceCites(row.source);
    if (!cites.length) {
      continue;
    }
    contexts.push({
      id: row.id,
      page: row.page,
      cites,
      params: row.source.params,
    });
  }
  if (!contexts.length) {
    setStatus(t("style-editor-status-no-items"));
    return [];
  }
  return contexts;
}

function toPreviewTextUnits(input: unknown): TextUnit[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((unit): unit is TextUnit => {
    if (!unit || typeof unit !== "object") {
      return false;
    }
    return typeof (unit as Record<string, unknown>).value === "string";
  });
}

function getStringRecordValue(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value ? value : undefined;
}

function getBibliographyEntryId(lineRecord: Record<string, unknown>): string {
  return (
    getStringRecordValue(lineRecord, "id") ||
    getStringRecordValue(lineRecord, "entryId") ||
    getStringRecordValue(lineRecord, "key") ||
    ""
  );
}

function handlePreviewLinkClick(link: string): boolean {
  const entryId = parseBanyanEntryLink(link);
  if (!entryId) {
    return false;
  }

  const target = document.querySelector<HTMLElement>(
    `[data-banyan-entry-id="${CSS.escape(entryId)}"]`,
  );
  if (!target) {
    return true;
  }

  for (const current of document.querySelectorAll(".preview-link-target")) {
    current.classList.remove("preview-link-target");
  }
  target.classList.add("preview-link-target");
  target.setAttribute("tabindex", "-1");
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.focus({ preventScroll: true });
  return true;
}

function renderPreviewUnits(units: TextUnit[]): DocumentFragment {
  return renderUnitsToFragment(units, { onLinkClick: handlePreviewLinkClick });
}

function renderPreview(citations: unknown[], bibliography: unknown[]): void {
  const container = document.getElementById(
    "output-preview-view",
  ) as HTMLElement | null;
  if (!container) return;
  container.replaceChildren();

  const citationHeading = document.createElement("div");
  citationHeading.className = "preview-heading";
  citationHeading.textContent = t("style-editor-citations-heading");
  container.appendChild(citationHeading);

  if (!Array.isArray(citations) || citations.length === 0) {
    const empty = document.createElement("div");
    empty.className = "preview-line";
    empty.textContent = t("style-editor-empty-citations");
    container.appendChild(empty);
  } else {
    for (const citation of citations) {
      const citationRecord =
        citation && typeof citation === "object"
          ? (citation as Record<string, unknown>)
          : {};
      const citationType =
        citationRecord.type === "note-citation"
          ? "note-citation"
          : "intext-citation";

      if (citationType === "note-citation") {
        const referenceRow = document.createElement("div");
        referenceRow.className = "preview-line preview-note-reference";
        referenceRow.appendChild(
          renderPreviewUnits(toPreviewTextUnits(citationRecord.reference)),
        );
        container.appendChild(referenceRow);

        const textRow = document.createElement("div");
        textRow.className = "preview-line preview-note-text";
        textRow.appendChild(
          renderPreviewUnits(toPreviewTextUnits(citationRecord.units)),
        );
        container.appendChild(textRow);
        continue;
      }

      const row = document.createElement("div");
      row.className = "preview-line";
      row.appendChild(
        renderPreviewUnits(toPreviewTextUnits(citationRecord.units)),
      );
      container.appendChild(row);
    }
  }

  const bibliographyHeading = document.createElement("div");
  bibliographyHeading.className = "preview-heading";
  bibliographyHeading.textContent = t("style-editor-bibliography-heading");
  container.appendChild(bibliographyHeading);

  if (!Array.isArray(bibliography) || bibliography.length === 0) {
    const empty = document.createElement("div");
    empty.className = "preview-line";
    empty.textContent = t("style-editor-empty-bibliography");
    container.appendChild(empty);
    return;
  }

  for (const line of bibliography) {
    const lineRecord =
      line && typeof line === "object" ? (line as Record<string, unknown>) : {};
    const row = document.createElement("div");
    row.className = "preview-line";
    const entryId = getBibliographyEntryId(lineRecord);
    if (entryId) {
      row.dataset.banyanEntryId = entryId;
    }
    row.appendChild(renderPreviewUnits(toPreviewTextUnits(lineRecord.units)));
    container.appendChild(row);
  }

  renderPreviewDebugSection(container);
}

function renderPreviewError(formattedError: FormattedRuntimeError): void {
  const container = document.getElementById(
    "output-preview-view",
  ) as HTMLElement | null;
  if (!container) return;
  container.replaceChildren();

  const details = document.createElement("textarea");
  details.className = "preview-error-text";
  details.readOnly = true;
  details.spellcheck = false;
  details.wrap = "off";
  details.rows = Math.min(Math.max(formattedError.lines.length + 2, 8), 24);
  details.value = formattedError.copyText;
  container.appendChild(details);

  renderPreviewDebugSection(container);
}

function renderPreviewPlaceholder(): void {
  const container = document.getElementById(
    "output-preview-view",
  ) as HTMLElement | null;
  if (!container) return;
  container.replaceChildren();

  const row = document.createElement("div");
  row.className = "preview-line";
  row.textContent = t("style-editor-empty-preview");
  container.appendChild(row);

  renderPreviewDebugSection(container);
}

async function saveStyle(): Promise<void> {
  if (!editor) return;
  try {
    const code = editor.getValue();
    const style = await createStyle(code);
    const id = String(style.INFO?.id || "untitled-style");
    const fullPath = await getStyleFilePathById(id);
    const targetFilename = PathUtils.filename(fullPath);
    const fullPathExists = await IOUtils.exists(fullPath);

    const indexedStyle = addon.data.styles.files.get(id);
    const shouldPromptIndexedOverwrite =
      Boolean(indexedStyle) &&
      (!fullPathExists || indexedStyle!.filename !== targetFilename);

    if (shouldPromptIndexedOverwrite && indexedStyle) {
      const overwriteIndexed = Services.prompt.confirm(
        // @ts-expect-error openWindow type mismatch
        null,
        addon.data.config.addonName,
        t("style-editor-save-overwrite-indexed", {
          args: {
            id,
            title: indexedStyle.title || indexedStyle.id,
          },
        }),
      );
      if (!overwriteIndexed) {
        return;
      }
    }

    if (fullPathExists && !shouldPromptIndexedOverwrite) {
      const overwrite = Services.prompt.confirm(
        // @ts-expect-error openWindow type mismatch
        null,
        addon.data.config.addonName,
        t("style-editor-save-overwrite-file", { args: { path: fullPath } }),
      );
      if (!overwrite) {
        return;
      }
    }

    const updatedCode = updateStyleCodeUpdatedTimestamp(code);
    await saveStyleCodeById(id, updatedCode);
    if (updatedCode !== code) {
      editor.setValue(updatedCode);
    }

    await loadStyles(true);
    setStatus(t("style-editor-status-saved", { args: { path: fullPath } }));
  } catch (e) {
    setStatus(`${t("style-editor-error-prefix")}: ${String(e)}`);
    ztoolkit.logError(e);
  }
}

function setStatus(text: string): void {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
}
