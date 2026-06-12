const INFO = {
  id: "template-author-date-basic",
  title: "Template Author-Date Basic",
  description: "Basic author-date in-text citation template",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Banyan" }],
  tags: ["template", "author-date"],
  documentation: [],
  license: "MIT",
  updated: "2026-03-19",
};

const UI = {
  citation: [
    {
      id: "paren",
      label: "Use parentheses",
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

  const citations = contexts.map((ctx) => {
    const body = ctx.cites
      .map((c) => {
        const author = c.item.firstCreator || c.item.title || c.item.key;
        const year = c.item.year || c.item.date || "n.d.";
        return author + ", " + year;
      })
      .join("; ");
    const citationText = ctx.params.paren ? "(" + body + ")" : body;
    return {
      id: ctx.id,
      units: text(citationText),
    };
  });

  const bibliography = Array.from(unique.values()).map((item) => ({
    id: String(item.id),
    type: "bibliography-entry",
    units: text(
      (item.firstCreator || "Unknown") +
        ". (" +
        (item.year || item.date || "n.d.") +
        "). " +
        (item.title || item.key) +
        ".",
    ),
  }));

  return { citations, bibliography };
}
