import type {
  BibliographyRequestData,
  CitationDialogRequestData,
  StyleListEntry,
} from "../../typings/server";
import type { CitationParams, Cite } from "@banyan/core/types/style";
import { textToRichText } from "@banyan/core/richText/richText";
import { toBanyanItem } from "./sandbox/items";
import {
  openBibliographyDialog,
  openCitationDialog,
  openStyleDialog,
} from "./server";
import { LAST_USED_STYLE_PREF } from "./styles";
import { getPref } from "../utils/prefs";
import { createLogger } from "../utils/logger";

const log = createLogger("debug");

/**
 * Debug-only entry points that open the server-owned dialogs without a
 * front-end driving them, using the current library selection.
 */

const DEBUG_DOCUMENT_ID = "banyan-debug";
const DEBUG_CITATION_PARAMS: CitationParams = {
  sortBy: "cite",
  prefix: "",
  suffix: "",
};

export function getDebugStyleList(): StyleListEntry[] {
  return Array.from(addon.data.styles.files.values())
    .map((style) => ({
      id: style.id,
      title: style.title,
      citationType: style.citationType,
      description: style.description,
      updated: style.updated,
      optionParams: style.optionParams ?? [],
    }))
    .toSorted((a, b) => a.title.localeCompare(b.title));
}

function getDebugStyleIdentifier(): { id: string; title: string } | null {
  const styles = getDebugStyleList();
  const lastUsed = String(getPref(LAST_USED_STYLE_PREF) ?? "");
  const style =
    styles.find((entry) => entry.id === lastUsed) ?? styles.at(0) ?? null;
  return style ? { id: style.id, title: style.title } : null;
}

function getDebugCites(): Cite[] | null {
  const pane = Zotero.getActiveZoteroPane();
  const items = pane?.getSelectedItems() ?? [];
  const regularItems = items.filter((item) => item.isRegularItem());
  if (!regularItems.length) {
    return null;
  }
  return regularItems.map((item) => ({ item: toBanyanItem(item) }));
}

export function getDebugCitationRequestData(): CitationDialogRequestData | null {
  const style = getDebugStyleIdentifier();
  if (!style) {
    return null;
  }
  return {
    documentId: DEBUG_DOCUMENT_ID,
    style,
    // An empty citation dialog is useful in debug: the maintainer can pick
    // items inside it even when the library pane has no selection.
    source: {
      cites: getDebugCites() ?? [],
      params: { ...DEBUG_CITATION_PARAMS },
    },
  };
}

export function getDebugBibliographyRequestData(): BibliographyRequestData | null {
  const style = getDebugStyleIdentifier();
  const cites = getDebugCites();
  if (!style || !cites) {
    return null;
  }
  return {
    documentId: DEBUG_DOCUMENT_ID,
    style,
    line: {
      id: "banyan-debug-line",
      type: "bibliography-entry",
      content: textToRichText(
        cites
          .map((cite) => cite.item.title ?? "")
          .filter(Boolean)
          .join(" / "),
      ),
    },
    extraSource: { cites, params: { ...DEBUG_CITATION_PARAMS } },
  };
}

export async function openDebugStyleDialog(): Promise<void> {
  const style = getDebugStyleIdentifier();
  if (!style) {
    log.warn("no style available for the style dialog");
    return;
  }
  await openStyleDialog({ ...style, documentId: DEBUG_DOCUMENT_ID });
}

export async function openDebugCitationDialog(): Promise<void> {
  const data = getDebugCitationRequestData();
  if (!data) {
    log.warn("no style available for the citation dialog");
    return;
  }
  await openCitationDialog(data);
}

export async function openDebugBibliographyDialog(): Promise<void> {
  const data = getDebugBibliographyRequestData();
  if (!data) {
    log.warn("select at least one regular item first");
    return;
  }
  await openBibliographyDialog(data);
}

export async function dialogExample(): Promise<void> {
  const dialogData: {
    unloadCallback: () => void;
    unloadLock?: { promise: Promise<void>; resolve: () => void };
    [key: string | number]: unknown;
  } = {
    unloadCallback: () => {
      addon.data.dialog = undefined;
    },
  };

  const dialogHelper = new ztoolkit.Dialog(2, 2)
    .addCell(0, 0, {
      tag: "h1",
      properties: { innerHTML: "Debug Tools" },
    })
    .addButton("Open style dialog", "style", {
      noClose: true,
      callback: () => void openDebugStyleDialog(),
    })
    .addButton("Open citation dialog", "citation", {
      noClose: true,
      callback: () => void openDebugCitationDialog(),
    })
    .addButton("Open bibliography dialog", "bibliography", {
      noClose: true,
      callback: () => void openDebugBibliographyDialog(),
    })
    .addButton("Close", "cancel")
    .setDialogData(dialogData)
    .open("Banyan Debug");

  addon.data.dialog = dialogHelper;
  await dialogData.unloadLock?.promise;
}
