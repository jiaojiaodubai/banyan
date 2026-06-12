import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function extractTypeExpression(sourceText, typeName) {
  const typeMatch = sourceText.match(
    new RegExp(`type\\s+${typeName}\\s*=\\s*`),
  );
  if (!typeMatch || typeMatch.index == null) {
    throw new Error(`Failed to parse ${typeName} from style d.ts source.`);
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
    throw new Error(`Failed to find object body in ${typeName}.`);
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

  throw new Error(`Failed to parse object body for ${typeName}.`);
}

function extractTopLevelObjectKeys(body) {
  const keys = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (const line of body.split("\n")) {
    if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      const match = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
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

/**
 * Build ESLint readonly globals from keys of `type StyleUtils = ...`
 * in the local styleUtils.d.ts.
 */
export function extractStyleUtilsReadonlyGlobals() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const styleUtilsPath = join(currentDir, "styleUtils.d.ts");
  const unitPath = join(currentDir, "unit.d.ts");
  const dts = readFileSync(styleUtilsPath, "utf8");
  const styleUtilsTypeExpression = extractTypeExpression(dts, "StyleUtils");
  const names = new Set(extractObjectTypeKeysFromSource(dts, "StyleUtils"));

  if (/\bUnitUtils\b/.test(styleUtilsTypeExpression)) {
    const unitSource = readFileSync(unitPath, "utf8");
    for (const key of extractObjectTypeKeysFromSource(
      unitSource,
      "UnitUtils",
    )) {
      names.add(key);
    }
  }

  if (!names.size) {
    throw new Error("No util names found in StyleUtils for ESLint globals.");
  }

  return Object.fromEntries(
    Array.from(names).map((name) => [name, "readonly"]),
  );
}
