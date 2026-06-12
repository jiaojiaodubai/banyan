import type { StyleComponent } from "../../typings/style";

type XULCheckboxLike = Element & { checked: boolean };
type XULMenulistLike = Element & { value: string };

type RenderMode = "html" | "xul";

type RenderStyleComponentOptionsArgs = {
  container: HTMLElement;
  components: StyleComponent[];
  values: Record<string, unknown>;
  onChange: (id: string, value: string | boolean) => void;
  mode?: RenderMode;
  createXULElementCompat?: (tag: string) => Element;
};

function createWrapper(doc: Document): HTMLDivElement {
  const wrapper = doc.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "4px";
  return wrapper;
}

export function renderStyleComponentOptions({
  container,
  components,
  values,
  onChange,
  mode = "html",
  createXULElementCompat,
}: RenderStyleComponentOptionsArgs): void {
  const doc = container.ownerDocument ?? document;
  container.replaceChildren();

  for (const comp of components) {
    const wrapper = createWrapper(doc);

    if (comp.type === "checkbox") {
      if (mode === "xul") {
        if (!createXULElementCompat) {
          throw new Error("createXULElementCompat is required in xul mode");
        }
        const checkbox = createXULElementCompat("checkbox") as XULCheckboxLike;
        checkbox.setAttribute("id", `opt-${comp.id}`);
        checkbox.setAttribute("label", comp.label);
        checkbox.setAttribute("native", "true");
        checkbox.checked = Boolean(values[comp.id]);
        checkbox.addEventListener("command", () => {
          onChange(comp.id, Boolean(checkbox.checked));
        });
        wrapper.appendChild(checkbox);
      } else {
        const label = doc.createElement("label");
        label.textContent = comp.label;
        const input = doc.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(values[comp.id]);
        input.addEventListener("change", () => {
          onChange(comp.id, input.checked);
        });
        wrapper.append(label, input);
      }
      container.appendChild(wrapper);
      continue;
    }

    if (comp.type === "select") {
      if (mode === "xul") {
        if (!createXULElementCompat) {
          throw new Error("createXULElementCompat is required in xul mode");
        }
        const id = `opt-${comp.id}`;
        const xulLabel = createXULElementCompat("label");
        xulLabel.setAttribute("control", id);
        xulLabel.setAttribute("value", comp.label);

        const menulist = createXULElementCompat("menulist") as XULMenulistLike;
        menulist.setAttribute("id", id);
        menulist.setAttribute("native", "true");

        const menupopup = createXULElementCompat("menupopup");
        for (const [value, label] of Object.entries(comp.data)) {
          const menuitem = createXULElementCompat("menuitem");
          menuitem.setAttribute("value", value);
          menuitem.setAttribute("label", label);
          menupopup.appendChild(menuitem);
        }
        menulist.appendChild(menupopup);

        const current = values[comp.id];
        const initial =
          typeof current === "string" ? current : String(comp.value ?? "");
        menulist.value = initial;
        menulist.setAttribute("value", initial);

        menulist.addEventListener("command", () => {
          onChange(comp.id, String(menulist.value ?? ""));
        });

        wrapper.append(xulLabel, menulist);
      } else {
        const label = doc.createElement("label");
        label.textContent = comp.label;
        const select = doc.createElement("select");
        for (const [value, label] of Object.entries(comp.data)) {
          const el = doc.createElement("option");
          el.value = value;
          el.textContent = label;
          select.appendChild(el);
        }
        select.value = String(values[comp.id] ?? comp.value ?? "");
        select.addEventListener("change", () => {
          onChange(comp.id, select.value);
        });
        wrapper.append(label, select);
      }
      container.appendChild(wrapper);
      continue;
    }

    const id = `opt-${comp.id}`;
    if (mode === "xul") {
      if (!createXULElementCompat) {
        throw new Error("createXULElementCompat is required in xul mode");
      }
      const xulLabel = createXULElementCompat("label");
      xulLabel.setAttribute("control", id);
      xulLabel.setAttribute("value", comp.label);

      const input = doc.createElement("input");
      input.setAttribute("id", id);
      input.setAttribute("type", "text");
      input.value = String(values[comp.id] ?? "");
      if (comp.data?.placeholder) {
        input.setAttribute("placeholder", comp.data.placeholder);
      }
      input.addEventListener("input", () => {
        onChange(comp.id, String(input.value ?? ""));
      });

      wrapper.append(xulLabel as Element, input);
    } else {
      const label = doc.createElement("label");
      label.textContent = comp.label;
      const input = doc.createElement("input");
      input.type = "text";
      input.value = String(values[comp.id] ?? "");
      if (comp.data?.placeholder) {
        input.placeholder = comp.data.placeholder;
      }
      input.addEventListener("input", () => {
        onChange(comp.id, input.value);
      });
      wrapper.append(label, input);
    }

    container.appendChild(wrapper);
  }
}
