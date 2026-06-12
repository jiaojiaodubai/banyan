import fs from 'fs';
import path from 'path';

// 直接在此处设置目标目录和生成数量
const targetDir = 'C:\\Users\\TQ\\Zotero\\banyan';
const count = 10;

const styleTemplate = (
  styleId,
  title,
  updated,
  index
) => [
  '/**',
  ' * Example Style Script',
  ` * id: ${styleId}`,
  ' */',
  'const INFO = {',
  `  id: "${styleId}",`,
  `  title: "${title}",`,
  '  description: "示例样式脚本",',
  '  citationType: "intext-citation",',
  '  creator: [{ type: "author", name: "Your Name" }],',
  '  tags: ["example"],',
  '  documentation: [],',
  '  license: "MIT",',
  `  updated: "${updated}",`,
  '};',
  'const UI = {',
  '  citation: [',
  '    {',
  '      id: "param1",',
  '      type: "text",',
  '      value: "",',
  `      label: "参数1（样式${index}）",`,
  `      data: { placeholder: "请输入参数（样式${index}）" }`,
  '    }',
  '    ,',
  '    {',
  '      id: "select1",',
  '      type: "select",',
  '      value: "a",',
  `      label: "下拉参数（样式${index}）",`,
  '      data: {',
  '        options: [',
  `          { value: "a", label: "选项A-${index}" },`,
  `          { value: "b", label: "选项B-${index}" }`,
  '        ]',
  '      }',
  '    }',
  '  ],',
  '  cite: [',
  '    {',
  '      id: "citeText1",',
  '      type: "text",',
  '      value: "",',
  `      label: "逐条参数（样式${index}）",`,
  `      data: { placeholder: "逐条请输入（样式${index}）" }`,
  '    }',
  '    ,',
  '    {',
  '      id: "citeSelect1",',
  '      type: "select",',
  '      itemType: ["book", "journalArticle"],',
  '      value: "a",',
  `      label: "逐条下拉（样式${index}）",`,
  '      data: {',
  '        options: [',
  `          { value: "a", label: "逐条选项A-${index}" },`,
  `          { value: "b", label: "逐条选项B-${index}" }`,
  '        ]',
  '      }',
  '    }',
  '    ,',
  '    {',
  '      id: "suppressAuthor",',
  '      type: "checkbox",',
  '      value: false,',
  `      label: "不显示作者（样式${index}）",`,
  '      ',
  '    }',
  '  ]',
  '};',
'function getSourceContexts() {',
'  return Array.isArray(contexts) ? contexts : [];',
'}',
'',
'function getItemIdentity(item) {',
'  if (!item || typeof item !== "object") return "unknown";',
'  if (item.uri) return String(item.uri);',
'  if (item.key) return String(item.key);',
'  if (Number.isFinite(item.id)) return String(item.id);',
'  return JSON.stringify({',
'    title: item.title || "",',
'    year: item.year || item.date || "",',
'    firstCreator: item.firstCreator || "",',
'  });',
'}',
'',
'function getItemLabel(item) {',
'  if (!item || typeof item !== "object") return "unknown";',
'  return item.title || item.key || item.uri || String(item.id || "unknown");',
'}',
'',
'function generate() {',
'  const sourceContexts = getSourceContexts();',
'  const citations = sourceContexts.map(function(context) {',
'    const cites = Array.isArray(context && context.cites) ? context.cites : [];',
'    const itemText = cites',
'      .map(function(cite) {',
'        return getItemLabel(cite && cite.item);',
'      })',
'      .join("; ");',
'    const pageText = context && context.page != null ? String(context.page) : "";',
`    const citationText = pageText ? "[${title}] [" + pageText + "] " + itemText : "[${title}] " + itemText;`,
'    return {',
'      id: context.id,',
'      type: "intext-citation",',
`      units: citationText,`,
'    };',
  '  });',
'  const uniqueItems = new Map();',
'  sourceContexts.forEach(function(context) {',
'    const cites = Array.isArray(context && context.cites) ? context.cites : [];',
'    cites.forEach(function(cite) {',
'      const item = cite && cite.item;',
'      const key = getItemIdentity(item);',
'      if (!uniqueItems.has(key)) uniqueItems.set(key, item || {});',
'    });',
'  });',
'  const bibliography = Array.from(uniqueItems.entries()).map(function(entry) {',
'    const key = entry[0];',
'    const item = entry[1];',
'    const titleText = getItemLabel(item);',
'    const creatorText = item.firstCreator || "Unknown";',
'    return {',
'      id: key,',
'      type: "bibliography-entry",',
`      units: "[${title}] " + creatorText + ". " + titleText + ".",`,
'    };',
'  });',
'  return { citations: citations, bibliography: bibliography };',
'}',
].join('\n');

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function genStyleScript(styleId, title) {
  const m = String(styleId).match(/(\d+)$/);
  const index = m ? Number(m[1]) : 0;
  return styleTemplate(styleId, title, formatDate(new Date()), index);
}

function createStyleScripts(targetDir, count) {
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  for (let i = 0; i < count; i++) {
    const styleId = `test-style-${i}`;
    const title = `test-title-${i}`;
    const filePath = path.join(targetDir, `${styleId}.js`);
    fs.writeFileSync(filePath, genStyleScript(styleId, title), 'utf8');
    console.log(`Style script created: ${filePath}`);
  }
}

// 直接运行，无需命令行参数
createStyleScripts(targetDir, count);

