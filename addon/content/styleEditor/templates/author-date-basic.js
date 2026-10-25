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

const CITATION_PARAMS = [
  {
    id: "paren",
    kind: "state",
    label: "Use parentheses",
    defaultValue: true,
  },
];

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
        const author = c.item.firstCreator || c.item.title || "Untitled";
        const year = c.item.year || c.item.date || "n.d.";
        return author + ", " + year;
      })
      .join("; ");
    const citationText = ctx.params.paren ? "(" + body + ")" : body;
    return {
      id: ctx.id,
      content: text(citationText),
    };
  });

  const bibliography = Array.from(unique.values()).map((item) => ({
    id: String(item.id),
    type: "bibliography-entry",
    content: text(
      (item.firstCreator || "Unknown") +
        ". (" +
        (item.year || item.date || "n.d.") +
        "). " +
        (item.title || "Untitled") +
        ".",
    ),
  }));

  return { citations, bibliography };
}
