import { openDialogWindow } from "../utils/window";
import { config } from "../../package.json";
import { getStyle } from "./styles";
import { toBanyanItem } from "./sandbox/items";
import { getLocaleID, useL10n } from "../utils/locale";
import { showSimpleMessage } from "../utils/message";
import { getRegularSelection } from "../utils/selection";
import {
  renderBibliographyLineToHtml,
  renderRichTextToHtml,
  renderRichTextToText,
} from "@banyan/core/richText/render";
import type { Item } from "@banyan/core/types/item";
import type { ItemMenuContribution } from "../../typings/menu";
import type {
  BibliographyLine,
  CitationContext,
  IntextCitation,
  NoteCitation,
  StyleOptionValues,
} from "@banyan/core/types/style";
import { createLogger } from "../utils/logger";

const log = createLogger("create-output");
const t = useL10n(["createOutputDialog.ftl"]);

type CreateOutputResult = {
  styleId: string;
  styleOptions?: StyleOptionValues;
  outputType: "citation" | "bibliography";
  outputFormat: "html" | "text";
  outputMethod: "clipboard" | "file";
};

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

export const createOutputItemMenu: ItemMenuContribution = {
  id: "create-output",
  build() {
    return [
      {
        menuType: "menuitem",
        l10nID: getLocaleID("menuitem-create-output"),
        onShowing: (_event, context) => {
          const { canEdit, items } = getRegularSelection();
          context.setVisible(canEdit && items.length > 0);
        },
        onCommand: () => {
          void openCreateOutputDialog();
        },
      },
    ];
  },
};

// Built from the compile-time config: module bodies run before `src/index.ts`
// assigns the `addon` global.
const DIALOG_URL = `chrome://${config.addonRef}/content/createOutputDialog.xhtml`;

/** Data the dialog writes back; `result` stays null when it is cancelled. */
type CreateOutputIO = {
  items: Item[];
  result: CreateOutputResult | null;
  /** Rendered output; filled in by `render()` before the dialog closes. */
  fragment: string | null;
  /**
   * Generate while the dialog is still open, and await it before closing.
   *
   * The dialog is parentless modal: `openWindow` blocks until it closes, and a
   * style sandbox continuation that resumes on the task the closed window left
   * behind never settles (its generation queue stops running). Generation
   * therefore has to happen inside the modal loop; the native file picker, on
   * the other hand, is disabled while that modal window is up, so it runs after
   * `openWindow` returns, on the caller's own task.
   */
  render: () => Promise<void>;
};

/**
 * Open dialog to create citation or bibliography from selected items
 * Similar to Zotero's native "Create Bibliography from Items" feature
 */
export async function openCreateOutputDialog(): Promise<void> {
  const pane = Zotero.getActiveZoteroPane();
  if (!pane) {
    return;
  }
  const selectedItems = pane
    .getSelectedItems()
    .filter((item) => item.isRegularItem());

  if (selectedItems.length === 0) {
    return;
  }

  const items = selectedItems.map((item) => toBanyanItem(item));
  const io: CreateOutputIO = {
    items,
    result: null,
    fragment: null,
    render: async () => {
      if (!io.result) {
        return;
      }
      try {
        io.fragment = await renderOutput(items, io.result);
      } catch (e) {
        log.error("生成结果失败", e);
        showSimpleMessage(
          `Failed to generate output: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
  };

  // Blocks until the dialog closes, after its `render()` has finished.
  openDialogWindow(DIALOG_URL, "modal,resizable=no", io);

  if (io.result && io.fragment !== null) {
    await deliverOutput(io.fragment, io.result);
  }
}

/** Generate the output text for the chosen style and output shape. */
async function renderOutput(
  items: Item[],
  options: CreateOutputResult,
): Promise<string> {
  const { styleId, outputType, outputFormat } = options;

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

  const result = await style.generate(contexts, options.styleOptions);

  if (outputType === "citation") {
    return result.citations
      .map((citation: IntextCitation | NoteCitation) => {
        return outputFormat === "html"
          ? renderRichTextToHtml(citation.content)
          : renderRichTextToText(citation.content);
      })
      .join(outputFormat === "html" ? "<br/>" : "\n");
  }
  return result.bibliography
    .map((line: BibliographyLine) => {
      return outputFormat === "html"
        ? renderBibliographyLineToHtml(line)
        : renderRichTextToText(line.content);
    })
    .join(outputFormat === "html" ? "" : "\n");
}

/** Copy the output, or save it with a native picker once the dialog is gone. */
async function deliverOutput(
  fragment: string,
  options: CreateOutputResult,
): Promise<void> {
  const { outputType, outputFormat, outputMethod } = options;

  if (outputMethod === "clipboard") {
    await copyToClipboard(fragment, outputFormat);
    showSimpleMessage(t("create-output-status-copied"));
    return;
  }

  const fileContent =
    outputFormat === "html" ? wrapHtmlOutput(fragment) : fragment;
  if (await saveToFile(fileContent, outputFormat, outputType)) {
    showSimpleMessage(t("create-output-status-saved"));
  }
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

  // A plain-text flavor accompanies HTML.
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
 *
 * The picker comes from the toolkit's Zotero `FilePicker` wrapper: the raw
 * `nsIFilePicker.init()` no longer takes a `Window` in the current beta, it
 * needs the parent's `browsingContext`, and passing a window throws before the
 * dialog is ever shown.
 */
async function saveToFile(
  content: string,
  format: "html" | "text",
  outputType: "citation" | "bibliography",
): Promise<boolean> {
  const extension = format === "html" ? "html" : "txt";
  const parent = Zotero.getMainWindow() ?? undefined;
  const picker = new ztoolkit.FilePicker(
    "Save Output",
    "save",
    [
      [
        format === "html" ? "HTML Files" : "Text Files",
        format === "html" ? "*.html;*.htm" : "*.txt",
      ],
    ],
    `banyan-${outputType}.${extension}`,
    parent,
    "all",
  );

  const picked = await picker.open();
  if (!picked) {
    return false;
  }

  await IOUtils.writeUTF8(picked, content);
  return true;
}
