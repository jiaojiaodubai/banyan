/**
 * Manual GUI diagnostics style.
 *
 * This style is intentionally malformed in declarations the core can recover
 * from. It loads and generates, but produces load findings and console output
 * so the style editor's "sandbox feedback" panel can be checked.
 */
const INFO = {
  id: "manual-gui-diagnostics",
  title: "手动诊断样式",
  description: "故意写成非法声明的样式，用于检查诊断反馈",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Banyan" }],
  tags: ["manual-test"],
  documentation: [],
  license: "MIT",
  updated: "2026-10-22T00:00:00+08:00",
};

const STYLE_OPTIONS = [
  { id: "dup", kind: "state", label: "重复 id A", defaultValue: false },
  { id: "dup", kind: "state", label: "重复 id B", defaultValue: false },
  { id: "badKind", kind: "widget", label: "非法 kind" },
  {
    id: "styleList",
    kind: "list",
    label: "样式级 list",
    fields: [{ id: "field", kind: "value", label: "字段" }],
  },
];

const CITATION_PARAMS = [
  {
    id: "asyncValidate",
    kind: "value",
    label: "异步 validator",
    defaultValue: "",
    validate: async () => true,
  },
];

const CITE_PARAMS = [
  {
    id: "badList",
    kind: "list",
    label: "坏 list",
    fields: [{ id: "stateField", kind: "state", label: "状态字段" }],
  },
];

const ITEM_FIELD_PRESETS = [
  {
    id: "dup-preset",
    label: "重复 A",
    fields: { type: "book" },
  },
  {
    id: "dup-preset",
    label: "重复 B",
    fields: { type: "book" },
  },
  {
    id: "unknown-key",
    label: "未知键",
    fields: { "totally-unknown": "x" },
  },
  {
    id: "bad-type",
    label: "Zotero 类型",
    fields: { type: "bookSection" },
  },
];

const ITEM_FIELD_VALIDATORS = {
  book: [
    { description: "", check: () => true },
    { description: "非法 check", check: "not a function" },
    { description: "合法检查", check: () => true },
  ],
};

function generate() {
  console.trace("manual trace");
  console.info("manual info");
  console.warn("manual warn");
  console.error("manual error");
  return {
    citations: contexts.map((context) => ({
      id: context.id,
      content: text("手动诊断样式"),
    })),
    bibliography: [],
  };
}
