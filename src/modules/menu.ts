import { relateItems } from "./relations";
import { useL10n } from "../utils/locale";
import { openStyleEditorWindow } from "./styleEditor";
import { openDialogWindow } from "./server";
import { toBanyanItem } from "../utils/item";
import { getStyle } from "./styles";
import { escapeAttribute, escapeHtml, sanitizeLink } from "../utils/html";
import type { Item } from "../../typings/item";
import type {
  CitationContext,
  IntextCitation,
  NoteCitation,
  BibliographyLine,
} from "../../typings/style";
import type { RichText } from "../../typings/unit";
import { getRichTextSegments, RichTextSegment } from "../utils/richText";

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
              ztoolkit.getGlobal("alert")(
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

function renderBibliographyLineToHtml(line: BibliographyLine): string {
  const inner = renderRichTextToHtml(line.content);
  if (line.type === "bibliography-title") {
    return `<h1>${inner}</h1>`;
  }
  return `<p>${inner}</p>`;
}

/**
 * Render RichText to HTML
 */
function renderRichTextToHtml(richText: RichText): string {
  const out: string[] = [];
  let currentLink = "";
  let currentLinkParts: string[] = [];

  const flushLink = () => {
    if (!currentLink) {
      return;
    }
    out.push(
      `<a href="${escapeAttribute(currentLink)}">${currentLinkParts.join("")}</a>`,
    );
    currentLink = "";
    currentLinkParts = [];
  };

  for (const unit of getRichTextSegments(richText)) {
    const html = renderUnitVisualToHtml(unit);
    const link = sanitizeLink(unit.link);
    if (!link) {
      flushLink();
      out.push(html);
      continue;
    }

    if (currentLink && currentLink !== link) {
      flushLink();
    }
    currentLink = link;
    currentLinkParts.push(html);
  }

  flushLink();
  return out.join("");
}

function renderUnitVisualToHtml(unit: RichTextSegment): string {
  let text = escapeHtml(unit.value);
  if (unit.bold) text = `<strong>${text}</strong>`;
  if (unit.italic) text = `<em>${text}</em>`;
  if (unit.script === "superscript") text = `<sup>${text}</sup>`;
  if (unit.script === "subscript") text = `<sub>${text}</sub>`;
  const style: string[] = [];
  if (unit.color) style.push(`color:${escapeAttribute(unit.color)}`);
  if (unit.backgroundColor) {
    style.push(`background-color:${escapeAttribute(unit.backgroundColor)}`);
  }
  if (style.length) text = `<span style="${style.join(";")}">${text}</span>`;
  return text;
}

/**
 * Render RichText to plain text
 */
function renderRichTextToText(richText: RichText): string {
  return richText.text;
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
