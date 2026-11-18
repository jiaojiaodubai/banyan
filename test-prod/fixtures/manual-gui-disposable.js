/**
 * Manual GUI disposable style.
 *
 * A copy of a plain valid style with its own INFO.id, used by the GUI pass for
 * "style editor save -> index sync" and "delete the current style -> item-menu
 * fallback" (PLUGIN-02 and PLUGIN-04). It declares one quick mark so the item
 * menu can show (and refresh) this style's title. Delete only this style as
 * part of the case, never a shipped or preset style.
 */
const INFO = {
  id: "manual-gui-disposable",
  title: "手动一次性样式",
  description: "用于保存与删除用例的一次性样式",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Banyan" }],
  tags: ["manual-test"],
  documentation: [],
  license: "MIT",
  updated: "2026-10-22T00:00:00+08:00",
};

const ITEM_FIELD_PRESETS = [
  {
    id: "disposable-mark",
    label: "一次性标记",
    fields: { shortTitle: "一次性标记" },
  },
];

function generate() {
  return {
    citations: contexts.map((context) => ({
      id: context.id,
      content: text("一次性样式"),
    })),
    bibliography: [],
  };
}
