export type SnippetItem = {
  name: string;
  prefix: string;
  prefixes: string[];
  description: string;
  body: string;
};

type VscodeSnippetDefinition = {
  prefix?: string | string[];
  body?: string | string[];
  description?: string;
};

type VscodeSnippetFile = Record<string, VscodeSnippetDefinition>;

export function parseStyleSnippets(source: string): SnippetItem[] {
  const parsed = JSON.parse(stripJSONComments(source)) as VscodeSnippetFile;
  const items: SnippetItem[] = [];

  for (const [name, definition] of Object.entries(parsed)) {
    if (!definition || typeof definition !== "object") {
      continue;
    }

    const prefixes = normalizeSnippetPrefixes(definition.prefix);
    const body = normalizeSnippetBody(definition.body);
    if (!prefixes.length || !body) {
      continue;
    }

    items.push({
      name,
      prefix: prefixes[0],
      prefixes,
      description: String(definition.description || ""),
      body,
    });
  }

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeSnippetPrefixes(
  prefix: VscodeSnippetDefinition["prefix"],
): string[] {
  if (typeof prefix === "string") {
    const text = prefix.trim();
    return text ? [text] : [];
  }
  if (!Array.isArray(prefix)) {
    return [];
  }

  const normalized: string[] = [];
  for (const entry of prefix) {
    if (typeof entry !== "string") {
      continue;
    }
    const text = entry.trim();
    if (text) {
      normalized.push(text);
    }
  }
  return normalized;
}

function normalizeSnippetBody(body: VscodeSnippetDefinition["body"]): string {
  if (typeof body === "string") {
    return body;
  }
  if (Array.isArray(body)) {
    return body
      .filter((line): line is string => typeof line === "string")
      .join("\n");
  }
  return "";
}

function stripJSONComments(source: string): string {
  return source.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
