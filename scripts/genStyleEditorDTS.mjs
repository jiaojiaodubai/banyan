import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const outputDir = path.join(rootDir, "addon", "content", "styleEditor");
const aiWorkplaceTypingsDir = path.join(
  rootDir,
  "docs",
  "AI Style Workplace",
  "typings",
);
const declarationFiles = [
  {
    source: path.join(rootDir, "typings", "item.d.ts"),
    target: path.join(outputDir, "item.d.ts"),
    globalize: true,
  },
  {
    source: path.join(rootDir, "typings", "unit.d.ts"),
    target: path.join(outputDir, "unit.d.ts"),
    globalize: true,
  },
  {
    source: path.join(rootDir, "typings", "style.d.ts"),
    target: path.join(outputDir, "style.d.ts"),
    globalize: true,
    references: ["./item.d.ts", "./unit.d.ts"],
    appendGlobals: `
/**
 * \`contexts\` is injected as a readonly global by the sandbox before
 * \`generate()\` is called. Missing object properties fall back to empty
 * strings at runtime, while array semantics stay unchanged.
 */
declare const contexts: ScriptContexts;
`,
  },
  {
    source: path.join(rootDir, "typings", "styleUtils.d.ts"),
    target: path.join(outputDir, "styleUtils.d.ts"),
    globalize: true,
    references: ["./style.d.ts", "./unit.d.ts"],
    generateGlobalsFromStyleUtils: true,
  },
];

const aiWorkplaceTypingsFiles = [
  "item.d.ts",
  "unit.d.ts",
  "style.d.ts",
  "styleUtils.d.ts",
].map((fileName) => ({
  source: path.join(rootDir, "typings", fileName),
  target: path.join(aiWorkplaceTypingsDir, fileName),
}));

function toGlobalDeclarationSource(sourceText, options = {}) {
  const normalizedBody = sourceText
    .replace(/^\s*import\s+type\s+[^;]+;\s*$/gm, "")
    .replace(/^export\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const referenceLines = (options.references ?? []).map(
    (refPath) => `/// <reference path="${refPath}" />`,
  );

  const generatedGlobals = options.generateGlobalsFromStyleUtils
    ? buildStyleUtilsGlobalDeclarations(sourceText)
    : "";
  const header = referenceLines.length ? `${referenceLines.join("\n")}\n\n` : "";
  const footerParts = [options.appendGlobals, generatedGlobals].filter(Boolean);
  const footer = footerParts.length
    ? `\n${footerParts.map((part) => part.trim()).join("\n\n")}\n`
    : "";
  return `${header}${normalizedBody}\n${footer}`;
}

function extractTypeExpression(sourceText, typeName) {
  const typeMatch = sourceText.match(
    new RegExp(`export\\s+type\\s+${typeName}\\s*=\\s*`),
  );
  if (!typeMatch || typeMatch.index == null) {
    throw new Error(`Failed to find exported ${typeName} type declaration.`);
  }

  const start = typeMatch.index + typeMatch[0].length;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  for (let index = start; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth -= 1;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth -= 1;
      continue;
    }
    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth -= 1;
      continue;
    }

    if (
      char === ";" &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0
    ) {
      return sourceText.slice(start, index).trim();
    }
  }

  return sourceText.slice(start).trim();
}

function extractObjectTypeBody(typeExpression, typeName) {
  const objectStart = typeExpression.indexOf("{");
  if (objectStart < 0) {
    throw new Error(`Failed to find object body in ${typeName} type declaration.`);
  }

  let depth = 0;
  for (let index = objectStart; index < typeExpression.length; index += 1) {
    const char = typeExpression[index];
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char !== "}") {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return typeExpression.slice(objectStart + 1, index);
    }
  }

  throw new Error(`Failed to parse object body for ${typeName} type declaration.`);
}

function extractTopLevelObjectKeys(body) {
  const keys = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (const line of body.split("\n")) {
    if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/);
      if (match) {
        keys.push(match[1]);
      }
    }

    for (const char of line) {
      if (char === "(") parenDepth += 1;
      else if (char === ")") parenDepth -= 1;
      else if (char === "[") bracketDepth += 1;
      else if (char === "]") bracketDepth -= 1;
      else if (char === "{") braceDepth += 1;
      else if (char === "}") braceDepth -= 1;
    }
  }

  return keys;
}

function extractObjectTypeKeysFromSource(sourceText, typeName) {
  const typeExpression = extractTypeExpression(sourceText, typeName);
  const body = extractObjectTypeBody(typeExpression, typeName);
  return extractTopLevelObjectKeys(body);
}

function buildStyleUtilsGlobalDeclarations(sourceText) {
  const styleUtilsTypeExpression = extractTypeExpression(sourceText, "StyleUtils");
  const keys = new Set(extractObjectTypeKeysFromSource(sourceText, "StyleUtils"));

  if (/\bUnitUtils\b/.test(styleUtilsTypeExpression)) {
    const unitDeclarationPath = path.join(rootDir, "typings", "unit.d.ts");
    const unitDeclarationSource = readFileSync(unitDeclarationPath, "utf8");
    for (const key of extractObjectTypeKeysFromSource(
      unitDeclarationSource,
      "UnitUtils",
    )) {
      keys.add(key);
    }
  }

  if (!keys.size) {
    throw new Error("No StyleUtils keys were found for global declaration.");
  }

  return Array.from(keys)
    .map((key) => `declare const ${key}: StyleUtils["${key}"];`)
    .join("\n");
}

async function formatGeneratedText(text, filePath) {
  const options = (await prettier.resolveConfig(filePath)) ?? {};
  return prettier.format(text, {
    ...options,
    filepath: filePath,
  });
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await mkdir(aiWorkplaceTypingsDir, { recursive: true });

  await Promise.all(
    declarationFiles.map(async (entry) => {
      const sourceText = await readFile(entry.source, "utf8");
      const outputText = entry.globalize
        ? toGlobalDeclarationSource(sourceText, entry)
        : sourceText;
      await writeFile(
        entry.target,
        await formatGeneratedText(outputText, entry.target),
        "utf8",
      );
    }),
  );

  await Promise.all(
    aiWorkplaceTypingsFiles.map(async (entry) => {
      const sourceText = await readFile(entry.source, "utf8");
      await writeFile(
        entry.target,
        await formatGeneratedText(sourceText, entry.target),
        "utf8",
      );
    }),
  );

  for (const entry of declarationFiles) {
    console.log(
      `Copied ${path.relative(rootDir, entry.source)} -> ${path.relative(rootDir, entry.target)}`,
    );
  }

  for (const entry of aiWorkplaceTypingsFiles) {
    console.log(
      `Copied ${path.relative(rootDir, entry.source)} -> ${path.relative(rootDir, entry.target)}`,
    );
  }
}

await main();
