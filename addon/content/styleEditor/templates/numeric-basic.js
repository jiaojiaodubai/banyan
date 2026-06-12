const INFO = {
  id: "template-numeric-basic",
  title: "Template Numeric Basic",
  description: "Basic numeric in-text citation template",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Banyan" }],
  tags: ["template", "numeric"],
  documentation: [],
  license: "MIT",
  updated: "2026-03-19",
};

const UI = {
  citation: [
    {
      id: "show-year",
      label: "Show year",
      type: "checkbox",
      value: true,
    },
  ],
  cite: [],
};

function generate() {
  const unique = new Map();
  for (const ctx of contexts) {
    for (const cite of ctx.cites) {
      unique.set(cite.item.id, cite.item);
    }
  }

  const citations = contexts.map((ctx) => ({
    id: ctx.id,
    units: text(
      "[" +
        ctx.cites.map((_, i) => i + 1).join(",") +
        "] " +
        ctx.cites
          .map((c) => {
            const year = c.item.year ? " (" + c.item.year + ")" : "";
            return (
              (c.item.firstCreator || c.item.title || c.item.key) +
              (ctx.params["show-year"] ? year : "")
            );
          })
          .join("; "),
    ),
  }));

  const bibliography = Array.from(unique.values()).map((item, index) => ({
    id: String(item.id),
    type: "bibliography-entry",
    units: text(
      "[" +
        (index + 1) +
        "] " +
        (item.firstCreator || "Unknown") +
        ". " +
        (item.title || item.key) +
        ".",
    ),
  }));

  return { citations, bibliography };
}
