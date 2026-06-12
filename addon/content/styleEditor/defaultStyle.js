const INFO = {
  id: "my-style",
  title: "My Style",
  description: "Example Banyan style",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Your Name" }],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "2026-03-19",
};

const UI = {
  citation: [
    {
      id: "show-url",
      label: "Show URL",
      type: "checkbox",
      value: false,
    },
  ],
  cite: [],
};

/**
 * @returns {ScriptResult<typeof INFO.citationType>}
 */
function generate() {
  const citations = contexts.map((ctx) => ({
    id: ctx.id,
    units: text(
      "[" +
        ctx.page +
        "] " +
        ctx.cites.map((c) => c.item.title || c.item.key).join("; "),
    ),
  }));

  const unique = new Map();
  for (const ctx of contexts) {
    for (const cite of ctx.cites) {
      unique.set(cite.item.id, cite.item);
    }
  }
  const bibliography = Array.from(unique.values()).map((item) => ({
    id: String(item.id),
    type: "bibliography-entry",
    units: text(
      (item.firstCreator || "Unknown") + ". " + (item.title || item.key) + ".",
    ),
  }));

  return { citations, bibliography };
}
