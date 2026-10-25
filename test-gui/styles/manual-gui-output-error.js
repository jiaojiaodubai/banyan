/**
 * Manual GUI output-error style.
 *
 * `generate()` exists, so the style loads, but it returns nothing. Selecting it
 * for a citation or refresh should produce one `generate-output` alert.
 */
const INFO = {
  id: "manual-gui-output-error",
  title: "手动输出错误样式",
  description: "generate 不返回任何结果，用于检查只弹一次错误对话框",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Banyan" }],
  tags: ["manual-test"],
  documentation: [],
  license: "MIT",
  updated: "2026-10-22T00:00:00+08:00",
};

function generate() {}
