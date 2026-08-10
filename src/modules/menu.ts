import { relateItems } from "./relations";
import { useL10n } from "../utils/locale";
import { openStyleEditorWindow } from "./styleEditor";
import { openDialogWindow } from "./server";
import {
  normalizeExtraKey,
  toBanyanItem,
  toTitleCaseExtraKey,
} from "../utils/item";
import { getStyle } from "./styles";
import {
  renderBibliographyLineToHtml,
  renderRichTextToHtml,
  renderRichTextToText,
} from "../utils/richTextHtml";
import type { Item } from "../../typings/item";
import type {
  CitationContext,
  IntextCitation,
  NoteCitation,
  BibliographyLine,
} from "../../typings/style";

const t = useL10n(["mainWindow.ftl"]);
type LegacySupportsString = {
  data: string;
};

type LegacyTransferable = {
  addDataFlavor: (flavor: string) => void;
  setTransferData: (
    flavor: string,
    data: LegacySupportsString,
    length: number,
  ) => void;
};

type LegacyClipboardService = {
  setData: (
    transferable: LegacyTransferable,
    owner: nsIClipboardOwner | null,
    clipboardType: number,
  ) => void;
};

type LegacyFilePicker = {
  init: (parent: Window | null, title: string, mode: number) => void;
  defaultString: string;
  appendFilter: (title: string, filter: string) => void;
  appendFilters: (filterMask: number) => void;
  open: (callback: (result: number) => void) => void;
  file: { path: string };
};

type ExtraFieldDialogResult = {
  key: string;
  value: string;
};

type ConflictAction = "skip" | "overwrite" | "cancel";

type ConflictDecision = {
  action: ConflictAction;
  applyToRemaining: boolean;
};

type ParsedExtraLine = {
  raw: string;
  normalizedKey: string | null;
  value: string;
};

function showSimpleMessage(message: string): void {
  new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: 4500,
  })
    .createLine({
      text: message,
      type: "default",
    })
    .show();
}

/**
 * Register menu items in Tools menu
 */
export function registerToolsMenu() {
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: "banyan-menu-style-editor",
    icon: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
    label: t("menuitem-style-editor"),
    commandListener: () => {
      openStyleEditorWindow();
    },
  });
}

/**
 * Register context menu items for item selection
 * All Banyan menu items are grouped under a single top-level menu
 */
export function registerContextMenu() {
  ztoolkit.Menu.register("item", {
    tag: "menu",
    icon: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
    label: t("addon-name"),
    children: [
      {
        tag: "menuitem",
        label: t("menuitem-create-output"),
        isHidden: () => {
          const pane = Zotero.getActiveZoteroPane();
          const items = pane
            .getSelectedItems()
            .filter((item) => item.isRegularItem());
          return !pane.canEdit() || items.length === 0;
        },
        commandListener: () => {
          void openCreateOutputDialog();
        },
      },
      {
        tag: "menuitem",
        label: t("menuitem-write-extra-field"),
        isHidden: () => {
          const pane = Zotero.getActiveZoteroPane();
          const items = pane
            .getSelectedItems()
            .filter((item) => item.isRegularItem());
          return !pane.canEdit() || items.length === 0;
        },
        commandListener: () => {
          void openWriteExtraFieldDialog();
        },
      },
      {
        tag: "menuitem",
        label: t("menuitem-relate-items"),
        isHidden: () => {
          const pane = Zotero.getActiveZoteroPane();
          const items = pane
            .getSelectedItems()
            .filter((item) => item.isRegularItem());
          return !pane.canEdit() || items.length < 2;
        },
        commandListener: () => {
          const pane = Zotero.getActiveZoteroPane();
          const items = pane
            .getSelectedItems()
            .filter((item) => item.isRegularItem());
          relateItems(items);
        },
      },
    ],
  });
}

async function openWriteExtraFieldDialog(): Promise<void> {
  const pane = Zotero.getActiveZoteroPane();
  const selectedItems = pane
    .getSelectedItems()
    .filter((item) => item.isRegularItem());

  if (selectedItems.length === 0) {
    return;
  }

  return new Promise((resolve) => {
    const io = {
      itemCount: selectedItems.length,
      result: null as ExtraFieldDialogResult | null,
      deferred: {
        promise: Promise.resolve(),
        resolve: async () => {
          if (io.result) {
            try {
              await batchWriteExtraField(selectedItems, io.result);
            } catch (e) {
              ztoolkit.logError(e);
              showSimpleMessage(
                t("extra-field-write-failed", {
                  args: {
                    message: e instanceof Error ? e.message : String(e),
                  },
                }),
              );
            }
          }
          resolve();
        },
      },
    };

    openDialogWindow(
      `chrome://${addon.data.config.addonRef}/content/extraFieldDialog.xhtml`,
      "modal,resizable=no",
      io,
    );
  });
}

async function batchWriteExtraField(
  items: Zotero.Item[],
  payload: ExtraFieldDialogResult,
): Promise<void> {
  // Write keys in Zotero's preferred title-case form (e.g. "Type",
  // "Citation Key"); matching still uses the lowercase kebab normalization.
  const writeKey = toTitleCaseExtraKey(payload.key);
  const value = payload.value;
  const normalizedKey = normalizeExtraKey(writeKey);
  if (!normalizedKey) {
    showSimpleMessage(t("extra-field-error-invalid-key"));
    return;
  }

  let autoAction: Exclude<ConflictAction, "cancel"> | null = null;
  let updatedCount = 0;
  let skippedCount = 0;
  let aborted = false;

  for (const item of items) {
    const originalExtra = String(item.getField("extra") || "");
    const analysis = analyzeExtraField(originalExtra, normalizedKey);

    if (analysis.values.length > 0) {
      let action: ConflictAction;
      if (autoAction) {
        action = autoAction;
      } else {
        const decision = promptExtraConflict(item, writeKey, analysis.values);
        if (decision.action === "cancel") {
          aborted = true;
          break;
        }
        if (decision.applyToRemaining) {
          autoAction = decision.action;
        }
        action = decision.action;
      }

      if (action === "skip") {
        skippedCount++;
        continue;
      }
    }

    const nextExtra = mergeExtraField(
      originalExtra,
      writeKey,
      normalizedKey,
      value,
    );

    if (nextExtra === originalExtra) {
      skippedCount++;
      continue;
    }

    item.setField("extra", nextExtra);
    await item.saveTx();
    updatedCount++;
  }

  showSimpleMessage(
    t("extra-field-write-summary", {
      args: {
        updated: updatedCount,
        skipped: skippedCount,
        aborted: aborted ? 1 : 0,
      },
    }),
  );
}

function analyzeExtraField(
  extraText: string,
  normalizedKey: string,
): {
  values: string[];
} {
  const parsed = parseExtraLines(extraText);
  const values = parsed
    .filter((line) => line.normalizedKey === normalizedKey)
    .map((line) => line.value);
  return { values };
}

function parseExtraLines(extraText: string): ParsedExtraLine[] {
  return extraText.split(/\r?\n/).map((raw) => {
    const index = raw.indexOf(":");
    if (index <= 0) {
      return {
        raw,
        normalizedKey: null,
        value: "",
      };
    }

    const key = raw.slice(0, index).trim();
    return {
      raw,
      normalizedKey: normalizeExtraKey(key),
      value: raw.slice(index + 1).trim(),
    };
  });
}

function mergeExtraField(
  extraText: string,
  writeKey: string,
  normalizedKey: string,
  value: string,
): string {
  const newline = extraText.includes("\r\n") ? "\r\n" : "\n";
  const lines = extraText ? extraText.split(/\r?\n/) : [];
  const parsed = parseExtraLines(extraText);
  const newLine = `${writeKey}: ${value}`;

  const firstMatchIndex = parsed.findIndex(
    (line) => line.normalizedKey === normalizedKey,
  );

  if (firstMatchIndex === -1) {
    if (lines.length === 0) {
      return newLine;
    }
    return [...lines, newLine].join(newline);
  }

  let replaced = false;
  const out: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i].normalizedKey !== normalizedKey) {
      out.push(parsed[i].raw);
      continue;
    }

    if (!replaced) {
      out.push(newLine);
      replaced = true;
    }
  }
  return out.join(newline);
}

function promptExtraConflict(
  item: Zotero.Item,
  writeKey: string,
  existingValues: string[],
): ConflictDecision {
  const checkState = { value: false };
  const itemLabel =
    String(item.getField("title") || "").trim() ||
    String(item.getDisplayTitle?.() || "").trim() ||
    item.key;
  const existingText = existingValues.join("; ");

  const selected = Zotero.Prompt.confirm({
    window: Zotero.getMainWindow(),
    title: t("extra-field-conflict-title"),
    text: t("extra-field-conflict-message", {
      args: {
        item: itemLabel,
        key: writeKey,
        existing: existingText,
      },
    }),
    button0: t("extra-field-conflict-skip"),
    button1: t("extra-field-conflict-overwrite"),
    button2: Zotero.Prompt.BUTTON_TITLE_CANCEL,
    checkLabel: t("extra-field-conflict-apply-to-remaining"),
    checkbox: checkState,
  });

  if (selected === 0) {
    return { action: "skip", applyToRemaining: checkState.value };
  }
  if (selected === 1) {
    return { action: "overwrite", applyToRemaining: checkState.value };
  }
  return { action: "cancel", applyToRemaining: false };
}

/**
 * Open dialog to create citation or bibliography from selected items
 * Similar to Zotero's native "Create Bibliography from Items" feature
 */
async function openCreateOutputDialog(): Promise<void> {
  const pane = Zotero.getActiveZoteroPane();
  const selectedItems = pane
    .getSelectedItems()
    .filter((item) => item.isRegularItem());

  if (selectedItems.length === 0) {
    return;
  }

  const items = selectedItems.map((item) => toBanyanItem(item));

  return new Promise((resolve) => {
    const io = {
      items,
      result: null as {
        styleId: string;
        outputType: "citation" | "bibliography";
        outputFormat: "html" | "text";
        outputMethod: "clipboard" | "file";
      } | null,
      deferred: {
        promise: Promise.resolve(),
        resolve: async () => {
          if (io.result) {
            try {
              await generateAndOutputResult(items, io.result);
            } catch (e) {
              ztoolkit.logError(e);
              showSimpleMessage(
                `Failed to generate output: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }
          resolve();
        },
      },
    };

    openDialogWindow(
      `chrome://${addon.data.config.addonRef}/content/createOutputDialog.xhtml`,
      "modal,resizable=no",
      io,
    );
  });
}

/**
 * Generate citation or bibliography and output according to user selection
 */
async function generateAndOutputResult(
  items: Item[],
  options: {
    styleId: string;
    outputType: "citation" | "bibliography";
    outputFormat: "html" | "text";
    outputMethod: "clipboard" | "file";
  },
): Promise<void> {
  const { styleId, outputType, outputFormat, outputMethod } = options;

  // Get style file info
  const styleFile = addon.data.styles.files.get(styleId);
  if (!styleFile) {
    throw new Error(`Style file not found: ${styleId}`);
  }

  // Load style (will use cache if already loaded)
  const style = await getStyle({ id: styleId, title: styleFile.title });

  const contexts: CitationContext[] = items.map((item, index) => ({
    id: `ctx-${index}`,
    page: 0,
    cites: [{ item, params: {} }],
    params: {
      sortBy: "cite",
      prefix: "",
      suffix: "",
    },
  }));

  const result = await style.generate(contexts);

  let outputFragment: string;
  if (outputType === "citation") {
    outputFragment = result.citations
      .map((citation: IntextCitation | NoteCitation) => {
        return outputFormat === "html"
          ? renderRichTextToHtml(citation.content)
          : renderRichTextToText(citation.content);
      })
      .join(outputFormat === "html" ? "<br/>" : "\n");
  } else {
    outputFragment = result.bibliography
      .map((line: BibliographyLine) => {
        return outputFormat === "html"
          ? renderBibliographyLineToHtml(line)
          : renderRichTextToText(line.content);
      })
      .join(outputFormat === "html" ? "" : "\n");
  }

  if (outputMethod === "clipboard") {
    await copyToClipboard(outputFragment, outputFormat);
    return;
  }

  const fileContent =
    outputFormat === "html" ? wrapHtmlOutput(outputFragment) : outputFragment;
  await saveToFile(fileContent, outputFormat, outputType);
}

/**
 * Wrap HTML output with proper HTML structure
 */
function wrapHtmlOutput(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Banyan Output</title>
</head>
<body>
${content}
</body>
</html>`;
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(
  text: string,
  format: "html" | "text",
): Promise<void> {
  const Cc = Components.classes as unknown as Record<
    string,
    {
      createInstance: <T>(iid: T) => nsQIResult<T>;
      getService: <T>(iid: T) => nsQIResult<T>;
    }
  >;
  const Ci = Components.interfaces;

  const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(
    Ci.nsITransferable,
  ) as LegacyTransferable;

  const clipboardService = Cc["@mozilla.org/widget/clipboard;1"].getService(
    Ci.nsIClipboard,
  ) as unknown as LegacyClipboardService;

  // Add HTML flavor if format is HTML
  if (format === "html") {
    const htmlString = Cc["@mozilla.org/supports-string;1"].createInstance(
      Ci.nsISupportsString,
    ) as LegacySupportsString;
    htmlString.data = text;
    transferable.addDataFlavor("text/html");
    transferable.setTransferData("text/html", htmlString, text.length * 2);
  }

  // Always add plain text flavor
  const plainText = format === "html" ? stripHtml(text) : text;
  const textString = Cc["@mozilla.org/supports-string;1"].createInstance(
    Ci.nsISupportsString,
  ) as LegacySupportsString;
  textString.data = plainText;
  transferable.addDataFlavor("text/plain");
  transferable.setTransferData("text/plain", textString, plainText.length * 2);

  clipboardService.setData(
    transferable,
    null,
    Ci.nsIClipboard.kGlobalClipboard ?? 0,
  );
}

/**
 * Strip HTML tags from text
 */
function stripHtml(html: string): string {
  // Simple HTML stripping - remove tags
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
}

/**
 * Save text to file
 */
async function saveToFile(
  content: string,
  format: "html" | "text",
  outputType: "citation" | "bibliography",
): Promise<void> {
  const Cc = Components.classes as unknown as Record<
    string,
    {
      createInstance: <T>(iid: T) => nsQIResult<T>;
      getService: <T>(iid: T) => nsQIResult<T>;
    }
  >;
  const Ci = Components.interfaces;

  const fp = Cc["@mozilla.org/filepicker;1"].createInstance(
    Ci.nsIFilePicker,
  ) as unknown as LegacyFilePicker;

  const win = Zotero.getMainWindow();
  if (!win) {
    throw new Error("Main window not found");
  }

  fp.init(win, "Save Output", Ci.nsIFilePicker.modeSave ?? 0);

  // Set default filename and filter
  const extension = format === "html" ? "html" : "txt";
  const defaultName = `banyan-${outputType}.${extension}`;
  fp.defaultString = defaultName;

  if (format === "html") {
    fp.appendFilter("HTML Files", "*.html;*.htm");
  } else {
    fp.appendFilter("Text Files", "*.txt");
  }
  fp.appendFilters(Ci.nsIFilePicker.filterAll ?? 0);

  const result = await new Promise<number>((resolve) => {
    fp.open((res: number) => resolve(res));
  });

  const returnOK = Ci.nsIFilePicker.returnOK ?? 0;
  const returnReplace = Ci.nsIFilePicker.returnReplace ?? 1;
  if (result !== returnOK && result !== returnReplace) {
    return;
  }

  // Write file
  await IOUtils.writeUTF8(fp.file.path, content);
}
