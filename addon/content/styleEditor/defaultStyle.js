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

const CITATION_PARAMS = [
  {
    id: "show-url",
    kind: "state",
    label: "Show URL",
    defaultValue: false,
  },
];

/**
 * @returns {ScriptResult<typeof INFO.citationType>}
 */
function generate() {
  const citations = contexts.map((ctx) => ({
    id: ctx.id,
    content: text(
      "[" +
        ctx.page +
        "] " +
        ctx.cites.map((c) => c.item.title || "Untitled").join("; "),
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
    content: text(
      (item.firstCreator || "Unknown") +
        ". " +
        (item.title || "Untitled") +
        ".",
    ),
  }));

  return { citations, bibliography };
}
