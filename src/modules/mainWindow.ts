import { relateItems, prefix, getMultilingualUris } from "./relations";
import { useL10n, getLocaleID } from "../utils/locale";
import { renderMultilingualItemsList } from "../components/multilingualBox";

const t = useL10n(["mainWindow.ftl"]);

export function registerStyleSheet(win: _ZoteroTypes.MainWindow) {
  const doc = win.document;
  const styles = ztoolkit.UI.createElement(doc, "link", {
    properties: {
      type: "text/css",
      rel: "stylesheet",
      href: `chrome://${addon.data.config.addonRef}/content/zoteroPane.css`,
    },
  });
  doc.documentElement?.appendChild(styles);
}

const headerIcon = "chrome://zotero/skin/itempane/16/related.svg";
const sidenavIcon = "chrome://zotero/skin/itempane/20/related.svg";
const addIcon = "chrome://zotero/skin/16/universal/plus.svg";

type ItemNotifier = {
  _banyanMultilingualObserver?: true;
  notify: (event: string, type: string, ids: Array<number | string>) => void;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function registerItemPaneSection() {
  // Cached item to pass to notifier
  let currentItem: Zotero.Item | null = null;
  let notifierID: string | null = null;

  Zotero.ItemPaneManager.registerSection({
    paneID: "multilingual",
    pluginID: addon.data.config.addonID,
    header: {
      l10nID: getLocaleID("item-section-multilingual-head-text"),
      icon: headerIcon,
      // darkIcon: headerIcon,
    },
    sidenav: {
      l10nID: getLocaleID("item-section-multilingual-sidenav-tooltip"),
      icon: sidenavIcon,
      // darkIcon: sidenavIcon,
    },
    sectionButtons: [
      {
        type: "add",
        icon: addIcon,
        darkIcon: addIcon,
        l10nID: getLocaleID("item-section-multilingual-add-tooltip"),
        onClick: async ({ body, item, editable }) => {
          if (!item || !editable || !item.isRegularItem()) return;

          const section = body.closest("collapsible-section") as unknown as {
            empty?: boolean;
            open?: boolean;
          } | null;
          if (section) {
            section.empty = false;
            section.open = true;
          }

          const io = {
            dataIn: null as unknown as string[] | null,
            dataOut: null as unknown as string[] | null,
            deferred: createDeferred<void>(),
            itemTreeID: "banyan-multilingual-select-item-dialog",
            filterLibraryIDs: [item.libraryID],
            onlyRegularItems: true,
          };

          Zotero.getMainWindow()?.openDialog(
            "chrome://zotero/content/selectItemsDialog.xhtml",
            "",
            "chrome,dialog=no,centerscreen,resizable=yes",
            io,
          );

          await io.deferred.promise;
          if (!io.dataOut || !io.dataOut.length) {
            return;
          }

          const relItems = await Zotero.Items.getAsync(io.dataOut);
          if (!relItems.length) {
            return;
          }
          if (relItems[0].libraryID !== item.libraryID) {
            ztoolkit.getGlobal("alert")(
              t("link-multilingual-item-error-different-library"),
            );
            return;
          }

          await relateItems([item, ...relItems]);
        },
      },
    ],
    onInit: ({ body, item, refresh }) => {
      currentItem = item ?? null;
      body.id = "banyan-multilingual-body";

      const observer: ItemNotifier = {
        _banyanMultilingualObserver: true,
        notify(event: string, _type: string, ids: Array<number | string>) {
          if (!currentItem || !currentItem.id) return;

          if (event === "modify" && ids.includes(currentItem.id)) {
            refresh();
            return;
          }

          if (event === "modify" || event === "delete") {
            const relations = currentItem.getRelations() as Record<
              string,
              string[]
            >;
            const uris = relations[prefix] ?? [];
            if (!uris.length) return;
            const relatedIDs = new Set(
              uris
                .map((uri) => Zotero.URI.getURIItemID(uri))
                .filter((id): id is number => typeof id === "number"),
            );
            for (const id of ids) {
              if (typeof id === "number" && relatedIDs.has(id)) {
                refresh();
                return;
              }
            }
          }
        },
      };

      notifierID = Zotero.Notifier.registerObserver(
        observer,
        ["item"],
        "banyan-multilingual-section",
      );

      const doc = body.ownerDocument ?? document;
      const placeholder = doc.createElement("div");
      placeholder.className = "banyan-multilingual-loading";
      placeholder.textContent = t("item-section-multilingual-loading");
      body.replaceChildren(placeholder);
    },
    onDestroy: () => {
      if (notifierID !== null) {
        Zotero.Notifier.unregisterObserver(notifierID);
        notifierID = null;
      }
      currentItem = null;
    },
    onItemChange: ({ item, editable, setEnabled, setSectionButtonStatus }) => {
      currentItem = item ?? null;
      const enabled = !!currentItem && currentItem.isRegularItem();
      setEnabled(enabled);
      setSectionButtonStatus("add", { hidden: !enabled || !editable });
    },
    onRender: ({ body }) => {
      const doc = body.ownerDocument ?? document;
      const placeholder = doc.createElement("div");
      placeholder.className = "banyan-multilingual-loading";
      placeholder.textContent = t("item-section-multilingual-loading");
      body.replaceChildren(placeholder);
    },
    onAsyncRender: async (args) => {
      const { body, item, setSectionSummary } = args;
      const section = body.closest("collapsible-section") as unknown as {
        setCount?: (count: number) => void;
        empty?: boolean;
        open?: boolean;
      } | null;
      body.replaceChildren();
      if (!item) {
        setSectionSummary(
          t("item-section-multilingual-summary", { args: { count: 0 } }),
        );
        section?.setCount?.(0);
        return;
      }
      const uris = getMultilingualUris(item);
      if (!uris.length) {
        setSectionSummary(
          t("item-section-multilingual-summary", { args: { count: 0 } }),
        );
        section?.setCount?.(0);
        return;
      }
      setSectionSummary(
        t("item-section-multilingual-summary", {
          args: { count: uris.length },
        }),
      );
      section?.setCount?.(uris.length);
      await renderMultilingualItemsList(args);
    },
  });
}
