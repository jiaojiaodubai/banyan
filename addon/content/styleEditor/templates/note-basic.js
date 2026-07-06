const INFO = {
  id: "template-note-basic",
  title: "Template Note Basic",
  description: "Basic note citation template",
  citationType: "note-citation",
  creator: [{ type: "author", name: "Banyan" }],
  tags: ["template", "note"],
  documentation: [],
  license: "MIT",
  updated: "2026-03-19",
};

function generate() {
  const citations = contexts.map((ctx, index) => {
    const notePrefix = ctx.params["show-index"] ? "[" + ctx.page + "] " : "";
    return {
      id: ctx.id,
      content: group(
        ctx.cites.map((c) =>
          group([
            affix(index + 1, "", ". "),
            group([c.item.firstCreator, c.item.title, c.item.date], ". "),
          ]),
        ),
        " ",
      ),
      reference: index + 1,
    };
  });

  const cites = [];
  for (const ctx of contexts) {
    for (const cite of ctx.cites) {
      if (!cites.some((c) => c.id === cite.item.id)) {
        cites.push(cite.item);
      }
    }
  }
  const bibliography = cites.map((item, index) => ({
    id: String(item.id),
    type: "bibliography-entry",
    content: group([item.firstCreator, item.title, item.date], ". "),
  }));

  return { citations, bibliography };
}
