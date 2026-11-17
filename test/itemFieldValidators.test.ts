import { assert } from "chai";
import { runItemFieldValidators } from "../src/modules/sandbox/itemFieldValidators";

describe("item field validators through the style sandbox", function () {
  it("extracts and runs synchronous and asynchronous checks", async function () {
    const { createStyle } = await import("../src/modules/sandbox");
    const style = await createStyle(`
      const INFO = {
        id: "validator-probe",
        title: "Validator Probe",
        description: "",
        citationType: "intext-citation",
        creator: [],
        tags: [],
        documentation: [],
        license: "MIT",
        updated: "2026-01-01",
      };
      const ITEM_FIELD_VALIDATORS = {
        book: [
          {
            description: "必须填写标题",
            check: (item) => (item.title ? true : "缺少标题"),
          },
          {
            description: "必须是古籍",
            check: (item) =>
              getExtraValue(item, "type") === "classic" || "不是古籍",
          },
          {
            description: "多条说明",
            check: () => ["第一条", "第二条"],
          },
          {
            description: "异步检查",
            check: async () => true,
          },
          {
            description: "异步多条",
            check: async () => {
              await Promise.resolve();
              return ["异步第一条", "异步第二条"];
            },
          },
          {
            description: "超时检查",
            check: () => new Promise(() => {}),
          },
        ],
      };
      function generate() {
        return { citations: [], bibliography: [] };
      }
    `);

    assert.deepEqual(Object.keys(style.ITEM_FIELD_VALIDATORS ?? {}), ["book"]);
    const checks = style.ITEM_FIELD_VALIDATORS!.book!;
    assert.lengthOf(checks, 6);

    const entries = await runItemFieldValidators(
      checks,
      {
        id: "1",
        itemType: "book",
        title: "T",
        creators: [],
        extra: { type: "classic" },
      } as never,
      { timeoutMs: 15 },
    );

    assert.deepEqual(
      entries.map((entry) => [entry.description, entry.status, entry.error]),
      [
        ["必须填写标题", "pass", undefined],
        ["必须是古籍", "pass", undefined],
        ["多条说明", "fail", undefined],
        ["异步检查", "pass", undefined],
        ["异步多条", "fail", undefined],
        ["超时检查", "error", "timeout"],
      ],
    );
    assert.deepEqual(entries[2].messages, ["第一条", "第二条"]);
    assert.deepEqual(entries[4].messages, ["异步第一条", "异步第二条"]);
  });

  it("resolves a multilingual sibling inside an async checker", async function () {
    const { createStyle } = await import("../src/modules/sandbox");
    const { toBanyanItem } = await import("../src/utils/item");
    const { prefix } = await import("../src/modules/relations");

    const source = new Zotero.Item("book");
    source.setField("title", "中文条目");
    source.setField("language", "zh-CN");

    const sibling = new Zotero.Item("book");
    sibling.setField("title", "English sibling");
    sibling.setField("language", "en-US");

    try {
      await source.saveTx();
      await sibling.saveTx();

      // A multilingual group stores the relation on both members.
      // @ts-expect-error addRelation accepts custom predicates at runtime
      source.addRelation(prefix, Zotero.URI.getItemURI(sibling));
      // @ts-expect-error addRelation accepts custom predicates at runtime
      sibling.addRelation(prefix, Zotero.URI.getItemURI(source));
      await source.saveTx();
      await sibling.saveTx();

      const style = await createStyle(`
        const INFO = {
          id: "validator-multilingual-probe",
          title: "Validator Multilingual Probe",
          description: "",
          citationType: "intext-citation",
          creator: [],
          tags: [],
          documentation: [],
          license: "MIT",
          updated: "2026-01-01",
        };
        const ITEM_FIELD_VALIDATORS = {
          book: [
            {
              description: "必须有英文多语言对照",
              check: async (item) => {
                const siblings = await getMultilingualItems(item);
                return (
                  siblings.some((entry) =>
                    String(entry.language ?? "")
                      .toLowerCase()
                      .startsWith("en"),
                  ) || "没有英文多语言对照"
                );
              },
            },
          ],
        };
        function generate() {
          return { citations: [], bibliography: [] };
        }
      `);

      const entries = await runItemFieldValidators(
        style.ITEM_FIELD_VALIDATORS!.book!,
        toBanyanItem(source),
        { timeoutMs: 2000 },
      );

      assert.deepEqual(
        entries.map((entry) => [entry.status, entry.messages]),
        [["pass", []]],
      );
    } finally {
      for (const item of [source, sibling]) {
        try {
          if (item.id) {
            await item.eraseTx();
          }
        } catch {
          // The temporary test profile is discarded after the run.
        }
      }
    }
  });
});
