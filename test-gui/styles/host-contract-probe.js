/**
 * Host capability probe for the GUI acceptance cases in test-gui/README.md
 * (HOST-01 and HOST-01M). Install it in the Zotero data directory's banyan/
 * folder, or load it in the style editor for a preview-only run.
 */
const INFO = {
  id: "host-contract-probe",
  title: "Host contract probe",
  description: "Resolve multilingual siblings through the host capability.",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Banyan" }],
  tags: ["manual-test"],
  documentation: [],
  license: "MIT",
  updated: "2026-10-24T00:00:00+08:00",
};

async function generate() {
  const context = contexts[0];
  const item = context.cites[0].item;
  const attempts = [];
  for (const candidate of [item, { ...item }]) {
    try {
      const items = await getMultilingualItems(candidate);
      attempts.push(items.map((entry) => entry.title).join(" | "));
    } catch (error) {
      attempts.push(
        `error:${error.message}:id=${typeof candidate.id}:type=${typeof candidate.itemType}`,
      );
    }
  }
  return {
    citations: [
      {
        id: context.id,
        content: text(attempts.join(" || ")),
      },
    ],
    bibliography: [],
  };
}
