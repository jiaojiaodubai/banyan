import { assert } from "chai";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The build prefixes every Fluent id with the add-on ref, so a message the
 * window asks for but the locale does not define is shown to the user verbatim
 * (the raw id, or a neighbour's text swallowed into the same line). These
 * checks keep the window's messages and the locale files in step.
 */

const LOCALES = ["en-US", "zh-CN"];
const DIALOG_FTL = "creatorsExtDialog.ftl";
const DIALOG_SCRIPT = "src/dialogs/creatorsExtDialog.ts";
const DIALOG_MARKUP = "addon/content/creatorsExtDialog.xhtml";

/** Ids the window asks for, in the source (unprefixed) form. */
function usedDialogMessageIds(): Set<string> {
  const script = readFileSync(path.resolve(DIALOG_SCRIPT), "utf8");
  const markup = readFileSync(path.resolve(DIALOG_MARKUP), "utf8");
  const ids = new Set<string>();
  // Literals, including the ones picked with a ternary in `createExtensionInput`.
  for (const match of script.matchAll(/"(creators-ext-[a-z0-9-]+)"/g)) {
    ids.add(match[1]);
  }
  for (const match of markup.matchAll(
    /data-l10n-id="(creators-ext-[a-z0-9-]+)"/g,
  )) {
    ids.add(match[1]);
  }
  return ids;
}

/** Message ids defined at column 0 in an FTL file. */
function definedMessageIds(ftl: string): Set<string> {
  const ids = new Set<string>();
  for (const line of ftl.split(/\r?\n/)) {
    const match = /^([A-Za-z][\w-]*)\s*=/.exec(line);
    if (match) {
      ids.add(match[1]);
    }
  }
  return ids;
}

function dialogFtl(locale: string): string {
  return readFileSync(path.resolve("addon/locale", locale, DIALOG_FTL), "utf8");
}

function allFtlFiles(): string[] {
  const root = path.resolve("addon/locale");
  const files: string[] = [];
  for (const locale of readdirSync(root)) {
    const dir = path.join(root, locale);
    if (!statSync(dir).isDirectory()) {
      continue;
    }
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".ftl")) {
        files.push(path.join(dir, name));
      }
    }
  }
  return files;
}

const ADDON_CONTENT = path.resolve("addon/content");

/** The add-on's own windows, i.e. every markup file in the add-on content. */
function ownMarkupFiles(): string[] {
  return readdirSync(ADDON_CONTENT, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".xhtml"))
    .map((name) => path.join(ADDON_CONTENT, name));
}

/** Locale file a window declares, e.g. `chrome://…-extraFieldDialog.ftl`. */
function windowFtlName(markup: string): string | null {
  const match = /href="__addonRef__-([^"]+)\.ftl"/.exec(markup);
  return match ? `${match[1]}.ftl` : null;
}

/** Elements that bind Fluent attributes, as their id and attribute names. */
function attributeBindings(markup: string): { id: string; attrs: string[] }[] {
  const bindings: { id: string; attrs: string[] }[] = [];
  for (const tag of markup.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    const id = /data-l10n-id="([^"]+)"/.exec(tag)?.[1];
    const attrs = /data-l10n-attrs="([^"]+)"/.exec(tag)?.[1];
    if (!id || !attrs) {
      continue;
    }
    bindings.push({ id, attrs: attrs.split(/[\s,]+/).filter(Boolean) });
  }
  return bindings;
}

/** Lines of one message, up to the next message at column 0. */
function messageBlock(ftl: string, id: string): string[] | null {
  const lines = ftl.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`${id} =`));
  if (start === -1) {
    return null;
  }
  const block = [lines[start]];
  for (let index = start + 1; index < lines.length; index++) {
    if (/^[A-Za-z][\w-]*\s*=/.test(lines[index])) {
      break;
    }
    block.push(lines[index]);
  }
  return block;
}

describe("locale l10n integrity", function () {
  describe("creators-ext window messages", function () {
    it("defines every message the window asks for", function () {
      const ids = usedDialogMessageIds();
      assert.isNotEmpty(ids, "expected message ids in the dialog sources");

      for (const locale of LOCALES) {
        const defined = definedMessageIds(dialogFtl(locale));
        for (const id of ids) {
          assert.isTrue(
            defined.has(id),
            `${locale}: '${id}' is used by the window but missing from ${DIALOG_FTL}`,
          );
        }
      }
    });

    it("has no message left in the window's locale file", function () {
      const ids = usedDialogMessageIds();

      for (const locale of LOCALES) {
        const defined = definedMessageIds(dialogFtl(locale));
        assert.isNotEmpty(
          defined,
          `${locale}: expected messages in ${DIALOG_FTL}`,
        );
        for (const id of defined) {
          assert.isTrue(
            ids.has(id),
            `${locale}: '${id}' is defined in ${DIALOG_FTL} but nothing uses it`,
          );
        }
      }
    });
  });

  // A window asking for `data-l10n-attrs="placeholder"` needs a message with a
  // `.placeholder` attribute: a plain-value message silently leaves the element
  // without its hint.
  describe("attribute messages of the add-on's windows", function () {
    it("defines every attribute the markup binds", function () {
      let checked = 0;
      for (const file of ownMarkupFiles()) {
        const markup = readFileSync(file, "utf8");
        const ftlName = windowFtlName(markup);
        if (!ftlName) {
          continue;
        }
        for (const locale of LOCALES) {
          const ftl = readFileSync(
            path.resolve("addon/locale", locale, ftlName),
            "utf8",
          );
          for (const { id, attrs } of attributeBindings(markup)) {
            const block = messageBlock(ftl, id);
            if (!block) {
              // The window also binds ids from Zotero's own locale files.
              continue;
            }
            checked++;
            for (const attr of attrs) {
              assert.isTrue(
                block.some((line) =>
                  new RegExp(`^\\s+\\.${attr}\\s*=`).test(line),
                ),
                `${locale}/${ftlName}: '${id}' binds '${attr}' but defines no ` +
                  `'.${attr}' attribute`,
              );
            }
          }
        }
      }

      assert.isAbove(checked, 0, "expected attribute bindings in the markup");
    });
  });

  describe("Fluent locale files", function () {
    it("keeps one message assignment per line", function () {
      for (const file of allFtlFiles()) {
        const lines = readFileSync(file, "utf8").split(/\r?\n/);
        for (const [index, line] of lines.entries()) {
          const assignment = /^([A-Za-z][\w-]*)\s*=\s*(.*)$/.exec(line);
          if (!assignment) {
            continue;
          }
          // A second `identifier =` inside the value means two messages were
          // joined into one line, which silently drops the later message.
          const joined = /[A-Za-z][\w-]*-[\w-]+\s*=/.exec(assignment[2]);
          assert.isNull(
            joined,
            `${path.relative(process.cwd(), file)}:${index + 1}: ` +
              `'${joined?.[0]}' starts a message inside the value of ` +
              `'${assignment[1]}'`,
          );
        }
      }
    });

    it("defines each message in every locale", function () {
      const idsByFile = new Map<string, Set<string>>();
      for (const file of allFtlFiles()) {
        const name = path.basename(file);
        const union = idsByFile.get(name) ?? new Set<string>();
        for (const id of definedMessageIds(readFileSync(file, "utf8"))) {
          union.add(id);
        }
        idsByFile.set(name, union);
      }

      for (const [name, union] of idsByFile) {
        for (const locale of LOCALES) {
          const file = path.resolve("addon/locale", locale, name);
          const defined = definedMessageIds(readFileSync(file, "utf8"));
          for (const id of union) {
            assert.isTrue(
              defined.has(id),
              `${locale}/${name}: message '${id}' is missing from this locale`,
            );
          }
        }
      }
    });
  });
});
