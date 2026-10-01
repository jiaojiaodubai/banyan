import { assert } from "chai";
import { readFileSync } from "node:fs";
import path from "node:path";

// Menu items registered through `Zotero.MenuManager` are localized by the
// Fluent DOM overlay. When a message has a plain string value, Fluent replaces
// the element's children with a text node, which wipes the rendered
// `.menu-icon` (no icon) and the nested <menupopup> (submenu can no longer
// open). Every `l10nID` passed to `Zotero.MenuManager` in `src/modules/menu.ts`
// must therefore resolve to an attribute-only message (`.label = ...`).
const LOCALES = ["en-US", "zh-CN"];

function readFtl(locale: string): string {
  return readFileSync(
    path.resolve("addon/locale", locale, "mainWindow.ftl"),
    "utf8",
  );
}

/** Return the block lines of a message, or null when the message is missing. */
function messageBlock(ftl: string, id: string): string[] | null {
  const lines = ftl.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.startsWith(`${id} =`));
  if (startIndex === -1) {
    return null;
  }
  const block = [lines[startIndex]];
  for (let i = startIndex + 1; i < lines.length; i++) {
    // A new message starts at column 0 with `identifier =`
    if (/^[A-Za-z][\w-]*\s*=/.test(lines[i])) {
      break;
    }
    block.push(lines[i]);
  }
  return block;
}

/** Collect the literal `getLocaleID("...")` calls used for menu items. */
function menuL10nIds(): string[] {
  const source = readFileSync(path.resolve("src/modules/menu.ts"), "utf8");
  const ids = new Set<string>();
  for (const match of source.matchAll(/getLocaleID\(\s*"([^"]+)"\s*\)/g)) {
    ids.add(match[1]);
  }
  return [...ids];
}

describe("menu l10n messages", function () {
  it("uses attribute-only .label messages for every MenuManager l10nID", function () {
    const ids = menuL10nIds();
    assert.isNotEmpty(ids, "expected menu l10n ids in src/modules/menu.ts");

    for (const locale of LOCALES) {
      const ftl = readFtl(locale);
      for (const id of ids) {
        const block = messageBlock(ftl, id);
        if (!block) {
          assert.fail(`${locale}: missing FTL message '${id}'`);
        }
        // The message must not have a plain value: nothing after `=`.
        assert.match(
          block[0],
          new RegExp(`^${id} =\\s*$`),
          `${locale}: '${id}' must not have a plain value; ` +
            "use an attribute-only `.label = ...` message",
        );
        assert.isTrue(
          block.some((line) => /^\s+\.label\s*=/.test(line)),
          `${locale}: '${id}' must define a '.label' attribute`,
        );
      }
    }
  });
});
