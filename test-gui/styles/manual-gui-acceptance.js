/**
 * Manual GUI acceptance style, used by test-gui/README.md (HOST-02 and
 * PLUGIN-01/02/04). The declarations deliberately exercise every parameter
 * shape the core supports: state/value/list, rich values, presets,
 * applicable/forcedValue, sync validators, a throwing validator and an async
 * validator.
 */
const INFO = {
  id: "manual-gui-acceptance",
  title: "手动验收样式",
  description: "用于参数面板、快捷标记和字段检查的手工验收样式",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Banyan" }],
  tags: ["manual-test"],
  documentation: [],
  license: "MIT",
  updated: "2026-10-22T00:00:00+08:00",
};

const STYLE_OPTIONS = [
  {
    id: "mode",
    kind: "state",
    label: "模式（测试）",
    description: "切到“完整”后，观察“形式”是否被强制锁定。",
    states: { auto: "自动", full: "完整" },
    defaultValue: "auto",
  },
  {
    id: "form",
    kind: "state",
    label: "形式（测试）",
    description: "模式为“完整”时，核心应把该参数强制为“短”。",
    states: { short: "短", long: "长" },
    defaultValue: "short",
    forcedValue: (values) => (values.mode === "full" ? "short" : null),
  },
  {
    id: "prefix",
    kind: "value",
    label: "前缀（校验测试）",
    description:
      "输入 bad 应显示校验错误；输入 throw 应触发同步异常，面板仍继续渲染。",
    defaultValue: "",
    presets: ["参见", "见"],
    validate: (value) => {
      if (value === "throw") throw new Error("manual validator throw");
      if (value === "bad") return "manual invalid value";
      return true;
    },
  },
  {
    id: "asyncCheck",
    kind: "value",
    label: "异步校验（契约测试）",
    description:
      "正常同步校验通过；异步 validator 的契约由「手动诊断样式」覆盖。",
    defaultValue: "",
    validate: () => true,
  },
  {
    id: "comment",
    kind: "value",
    label: "富文本注释（测试）",
    description: "点“编辑”，确认富文本面板、格式按钮和预览正常。",
    format: "rich",
    defaultValue: "<em>示例</em>",
  },
  {
    id: "maxNames",
    kind: "value",
    label: "最多作者数（presets 测试）",
    defaultValue: "3",
    presets: ["1", "3", "99"],
  },
  {
    id: "debug",
    kind: "state",
    label: "输出诊断日志（测试）",
    description:
      "打开后 generate 会写 trace/info/warn/error，用于核对日志去处和编辑器反馈分组。",
    defaultValue: false,
  },
];

const CITATION_PARAMS = [
  {
    id: "header",
    kind: "value",
    label: "引注前缀（测试）",
    defaultValue: "默认",
  },
  {
    id: "variant",
    kind: "state",
    label: "引注级状态（多条目可见）",
    description: "只有一条引注时隐藏；再加入一条后应出现。",
    states: { normal: "普通", special: "特殊" },
    defaultValue: "normal",
    applicable: (citation) => citation.cites.length > 1,
  },
  {
    id: "citationNote",
    kind: "value",
    label: "引注级富文本（测试）",
    format: "rich",
    defaultValue: "<b>引注注</b>",
  },
];

const CITE_PARAMS = [
  {
    id: "locator",
    kind: "value",
    label: "定位符（applicable 测试）",
    description: "仅 book 条目显示；非 book 条目应隐藏。",
    defaultValue: "",
    presets: ["p.", "pp.", "§"],
    applicable: (cite) => cite.item.itemType === "book",
  },
  {
    id: "detail",
    kind: "value",
    label: "详情（forcedValue 测试）",
    description: "book 条目应显示只读的 book-detail；非 book 条目可编辑。",
    defaultValue: "自由值",
    forcedValue: (cite) =>
      cite.item.itemType === "book" ? "book-detail" : null,
  },
  {
    id: "pages",
    kind: "list",
    label: "页码范围（列表/默认值测试）",
    description:
      "默认行留作 default provenance 检查；输入 1 应显示错误并阻止提交。",
    min: 1,
    max: 3,
    defaultValue: [{}],
    fields: [
      {
        id: "start",
        kind: "value",
        label: "起",
        defaultValue: "1",
      },
      {
        id: "end",
        kind: "value",
        label: "止",
        defaultValue: "1",
        validate: (value) => (value === "1" ? "结束页不能是 1" : true),
      },
    ],
  },
  {
    id: "richDetail",
    kind: "value",
    label: "逐条富文本（测试）",
    format: "rich",
    defaultValue: "<i>逐条</i>",
  },
];

const ITEM_FIELD_PRESETS = [
  {
    id: "classic",
    label: "古籍（测试）",
    visible: (item) => item.itemType === "book",
    fields: {
      language: "zh-CN",
      publisher: "测试出版社",
    },
  },
  {
    id: "ask-jurisdiction",
    label: "补法域（测试，应用时询问）",
    visible: (item) => item.itemType === "book",
    fields: { jurisdiction: null },
  },
  {
    id: "conflict",
    label: "写入 publisher（测试冲突）",
    visible: (item) => item.itemType === "book",
    fields: { publisher: "manual-gui" },
  },
];

const ITEM_FIELD_VALIDATORS = {
  book: [
    {
      description: "标题非空（异步通过）",
      check: async (item) => Boolean(item.title) || "缺少标题",
    },
    {
      description: "语言已填写（失败示例）",
      check: (item) => Boolean(item.language) || "缺少语言",
    },
    {
      description: "异步失败示例",
      check: async () => {
        await Promise.resolve();
        return "异步失败示例";
      },
    },
  ],
};

function generate() {
  const sourceContexts = Array.isArray(contexts) ? contexts : [];

  if (options.debug === true) {
    console.trace("manual trace");
    console.info("manual info");
    console.warn("manual warn");
    console.error("manual error");
  }

  const citations = sourceContexts.map((context) => {
    const cites = Array.isArray(context.cites) ? context.cites : [];
    const citeText = cites
      .map((cite) => {
        const params = cite.params || {};
        const pages = Array.isArray(params.pages) ? params.pages : [];
        const pageText = pages
          .map((row) => `${row.start || ""}-${row.end || ""}`)
          .join(", ");
        return [
          params.locator || "",
          params.detail || "",
          pageText,
          params.richDetail || "",
        ]
          .filter(Boolean)
          .join("/");
      })
      .join("; ");

    return {
      id: context.id,
      content: group(
        [
          text("[Manual GUI]"),
          text(`mode=${options.mode || ""}`),
          text(`form=${options.form || ""}`),
          text(`prefix=${options.prefix || ""}`),
          text("comment="),
          htmlToUnit(String(options.comment || "")),
          text(`header=${context.params.header || ""}`),
          text(`variant=${context.params.variant || ""}`),
          text(`cites=${citeText || "none"}`),
        ],
        " ",
      ),
    };
  });

  const seen = new Set();
  const bibliography = [];
  sourceContexts.forEach((context) => {
    (context.cites || []).forEach((cite) => {
      const item = cite.item || {};
      const key = String(item.id || item.title || "");
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      bibliography.push({
        id: key,
        type: "bibliography-entry",
        content: group(
          [
            text(String(item.firstCreator || "")),
            text(String(item.title || "Untitled")),
            text(String(item.year || "")),
          ],
          " · ",
        ),
      });
    });
  });

  return { citations, bibliography };
}
