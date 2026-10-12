import { assert } from "chai";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Menu items registered through `Zotero.MenuManager` are localized by the
// Fluent DOM overlay. When a message has a plain string value, Fluent replaces
// the element's children with a text node, which wipes the rendered
// `.menu-icon` (no icon) and the nested <menupopup> (submenu can no longer
// open). Every id passed as `l10nID` must therefore resolve to an
// attribute-only message. The entries live in the feature modules that
// contribute them (`typings/menu.d.ts`), so the ids are collected from every
// `l10nID: getLocaleID("...")` call in `src`.
const LOCALES = ["en-US", "zh-CN"];

const L10N_ID_CALL = /l10nID:\s*getLocaleID\(\s*"([^"]+)"\s*\)/g;
/** Ids that render a menu or menu-item label, which must be a `.label`. */
const NEEDS_LABEL = /^(?:addon-name|menuitem-)/;

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

function sourceFiles(): string[] {
  const srcDir = path.resolve("src");
  return readdirSync(srcDir, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => path.join(srcDir, entry));
}

/** Collect the literal `l10nID: getLocaleID("...")` ids used across `src`. */
function menuL10nIds(): string[] {
  const ids = new Set<string>();
  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(L10N_ID_CALL)) {
      ids.add(match[1]);
    }
  }
  return [...ids];
}

describe("menu l10n messages", function () {
  it("uses attribute-only messages for every MenuManager l10nID", function () {
    const ids = menuL10nIds();
    assert.isNotEmpty(ids, "expected l10nID calls in src");

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
            "use an attribute-only message",
        );
        if (NEEDS_LABEL.test(id)) {
          assert.isTrue(
            block.some((line) => /^\s+\.label\s*=/.test(line)),
            `${locale}: '${id}' must define a '.label' attribute`,
          );
        }
      }
    }
  });
});
