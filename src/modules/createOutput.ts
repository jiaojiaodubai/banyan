import { openDialogWindow } from "../utils/window";
import { getStyle } from "./styles";
import { toBanyanItem } from "../utils/item";
import { getLocaleID } from "../utils/locale";
import { showSimpleMessage } from "../utils/message";
import { getRegularSelection } from "../utils/selection";
import {
  renderBibliographyLineToHtml,
  renderRichTextToHtml,
  renderRichTextToText,
} from "../utils/richTextHtml";
import type { Item } from "../../typings/item";
import type { ItemMenuContribution } from "../../typings/menu";
import type {
  BibliographyLine,
  CitationContext,
  IntextCitation,
  NoteCitation,
} from "../../typings/style";
import { createLogger } from "../utils/logger";

const log = createLogger("create-output");

type CreateOutputResult = {
  styleId: string;
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

type LegacyFilePicker = {
  init: (parent: Window | null, title: string, mode: number) => void;
  defaultString: string;
  appendFilter: (title: string, filter: string) => void;
  appendFilters: (filterMask: number) => void;
  open: (callback: (result: number) => void) => void;
  file: { path: string };
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

  return new Promise((resolve) => {
    const io = {
      items,
      result: null as CreateOutputResult | null,
      deferred: {
        promise: Promise.resolve(),
        resolve: async () => {
          if (io.result) {
            try {
              await generateAndOutputResult(items, io.result);
            } catch (e) {
              log.error("Failed to generate output", e);
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
  options: CreateOutputResult,
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
