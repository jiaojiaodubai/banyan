import { getMultilingualUris, unRelateItem } from "../modules/relations";
function createItemTypeIcon(doc: Document, item: Zotero.Item): HTMLElement {
  const icon = doc.createElement("span");
  icon.className = "icon icon-css icon-item-type";
  icon.setAttribute("aria-hidden", "true");
  icon.dataset.itemType = item.getItemTypeIconName();
  return icon;
}

export async function renderMultilingualItemsList(
  args: _ZoteroTypes.ItemPaneManagerSection.SectionHookArgs,
): Promise<void> {
  const { body, item, editable } = args;

  const doc = body.ownerDocument ?? document;
  const collation = Zotero.getLocaleCollation() as unknown as {
    compareString: (strength: number, a: string, b: string) => number;
  };
  const titles = new Map<number, string>();
  const getTitle = (item: Zotero.Item) => {
    const cached = titles.get(item.id);
    if (cached !== undefined) {
      return cached;
    }
    const title = Zotero.Items.getSortTitle(item.getDisplayTitle());
    titles.set(item.id, title);
    return title;
  };

  const items = await Promise.all(
    getMultilingualUris(item).map((uri: string) => Zotero.URI.getURIItem(uri)),
  );

  items.sort((a, b) => collation.compareString(1, getTitle(a), getTitle(b)));

  for (const relItem of items) {
    const row = doc.createElement("div");
    row.className = "row";

    const icon = createItemTypeIcon(doc, relItem);
    const label = doc.createElement("span");
    label.className = "label";
    label.append(relItem.getDisplayTitle());

    const box = doc.createElement("div");
    box.setAttribute("tabindex", "0");
    box.setAttribute("role", "button");
    box.setAttribute("aria-label", label.textContent || "");
    box.className = "box keyboard-clickable";
    box.addEventListener("click", () => {
      Zotero.getActiveZoteroPane()?.selectItem(relItem.id);
    });
    box.appendChild(icon);
    box.appendChild(label);
    row.append(box);

    if (editable) {
      const remove = doc.createXULElement("toolbarbutton");
      remove.className = "zotero-clicky zotero-clicky-minus";
      remove.setAttribute("data-l10n-id", "section-button-remove");
      remove.setAttribute("tabindex", "0");
      remove.addEventListener("command", () => {
        unRelateItem(relItem);
      });
      row.append(remove);
    }

    row.addEventListener("dragstart", (event) => {
      const internal = Zotero.Utilities.Internal as unknown as {
        onDragItems: (dragEvent: DragEvent, ids: number[]) => void;
      };
      internal.onDragItems(event as DragEvent, [relItem.id]);
    });

    body.append(row);
  }
}
