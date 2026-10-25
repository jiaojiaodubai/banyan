import { assert } from "chai";
import {
  CREATOR_EXT_FIELDS,
  bindCreatorsExt,
  parseCreatorsExt,
  reconcileCreatorsExt,
} from "@banyan/core/items/creatorsExt";
import {
  parseExtraLines,
  replaceExtraFieldBlock,
} from "@banyan/core/items/extra";
import type { Creator, Item } from "@banyan/core/types/item";

const creators: Creator[] = [
  {
    creatorType: "author",
    firstName: "Ada",
    lastName: "Lovelace",
  },
  {
    creatorType: "translator",
    name: "Grace Hopper",
  },
];

describe("creator extension extra data", function () {
  it("normalizes keys and preserves duplicate extra lines", function () {
    const lines = parseExtraLines(
      'Original Date: 1865\r\ncreators_ext: {"role":"撰"}',
    );

    assert.deepEqual(
      lines.map(({ normalizedKey }) => normalizedKey),
      ["original-date", "creators-ext"],
    );
  });

  it("replaces all matching records and appends the block at the end", function () {
    assert.equal(
      replaceExtraFieldBlock(
        "creators-ext: old\nStatus: published\n\n",
        "creators-ext",
        ['creators-ext: {"role":"译"}'],
      ),
      'Status: published\ncreators-ext: {"role":"译"}',
    );
  });

  it("parses valid records and reports malformed or invalid rows", function () {
    const parsed = parseCreatorsExt({
      "creators-ext": [
        '{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","role":"著"}',
        "{bad json",
        "[]",
        '{"role":12}',
      ],
    });

    assert.lengthOf(parsed.records, 1);
    assert.equal(parsed.records[0].lineIndex, 0);
    assert.equal(parsed.records[0].record.role, "著");
    assert.lengthOf(parsed.issues, 3);
  });

  it("rejects a record whose name identity is incomplete", function () {
    const parsed = parseCreatorsExt({
      "creators-ext": [
        '{"creatorType":"author","lastName":"Lovelace","nationality":"英"}',
        '{"creatorType":"author","firstName":"Ada","nationality":"英"}',
      ],
    });

    assert.isEmpty(parsed.records);
    assert.lengthOf(parsed.issues, 2);
  });

  it("rejects a record that mixes a single name with name parts", function () {
    const parsed = parseCreatorsExt({
      "creators-ext":
        '{"creatorType":"author","name":"Lovelace","firstName":"Ada","lastName":"Lovelace","role":"著"}',
    });

    assert.isEmpty(parsed.records);
    assert.lengthOf(parsed.issues, 1);
  });

  it("binds by identity even when creators have been reordered", function () {
    const parsed = parseCreatorsExt({
      "creators-ext":
        '{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","index":1,"role":"著","nationality":"英"}',
    });
    const reordered = [creators[1], creators[0]];
    const result = reconcileCreatorsExt(parsed.records, reordered);

    assert.deepEqual([...result.bindings.keys()], [1]);
    assert.deepEqual(result.bindings.get(1), {
      role: "著",
      nationality: "英",
    });
    assert.deepEqual(result.issues, []);
  });

  it("keeps a renamed creator's data through its recorded position", function () {
    // Renamed in place: the identity no longer matches, but nothing else
    // moved, so the recorded position is still trustworthy.
    const renamed: Creator[] = [
      { creatorType: "author", firstName: "Ada", lastName: "Lovelace-Byron" },
      creators[1],
    ];
    const parsed = parseCreatorsExt({
      "creators-ext":
        '{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","index":0,"role":"著","nationality":"英"}',
    });
    const result = reconcileCreatorsExt(parsed.records, renamed);

    assert.deepEqual([...result.bindings.keys()], [0]);
    assert.deepEqual(result.bindings.get(0), {
      role: "著",
      nationality: "英",
    });
    assert.deepEqual(result.issues, []);
  });

  it("skips position fallback once an identity match shows the list moved", function () {
    // Ada still matches, but at index 1 instead of the recorded 0, so the
    // list was edited: the stale record must not take whoever is at its old
    // index.
    const afterEdit: Creator[] = [
      { creatorType: "author", firstName: "Bob", lastName: "B" },
      { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
      { creatorType: "author", firstName: "Carol", lastName: "C" },
    ];
    const parsed = parseCreatorsExt({
      "creators-ext": [
        '{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","index":0,"role":"著"}',
        '{"creatorType":"author","firstName":"Bob","lastName":"B","index":1,"role":"编"}',
        '{"creatorType":"author","firstName":"Dave","lastName":"D","index":2,"role":"译"}',
      ],
    });
    const result = reconcileCreatorsExt(parsed.records, afterEdit);

    // Ada and Bob are found by identity; Dave only had his position to go on.
    assert.deepEqual([...result.bindings.keys()].sort(), [0, 1]);
    assert.equal(result.bindings.get(1)?.role, "著");
    assert.equal(result.bindings.get(0)?.role, "编");
    assert.lengthOf(result.issues, 2);
  });

  it("does not fall back to row order for a record whose identity failed", function () {
    const parsed = parseCreatorsExt({
      "creators-ext":
        '{"creatorType":"author","firstName":"Ada","lastName":"Mistyped","role":"著"}',
    });
    const result = reconcileCreatorsExt(parsed.records, creators);

    assert.isEmpty(result.bindings);
    assert.lengthOf(result.issues, 1);
  });

  it("matches a single-name record only against a single-name creator", function () {
    const matched = reconcileCreatorsExt(
      parseCreatorsExt({
        "creators-ext":
          '{"creatorType":"translator","name":"Grace Hopper","role":"译"}',
      }).records,
      creators,
    );
    assert.deepEqual([...matched.bindings.keys()], [1]);

    // Same surname, different name mode: the personal creator must not match.
    const mismatched = reconcileCreatorsExt(
      parseCreatorsExt({
        "creators-ext":
          '{"creatorType":"author","name":"Lovelace","role":"著"}',
      }).records,
      creators,
    );
    assert.isEmpty(mismatched.bindings);
    assert.lengthOf(mismatched.issues, 1);
  });

  it("uses index fallback for records without identity fields", function () {
    const parsed = parseCreatorsExt({
      "creators-ext": '{"creatorType":"translator","index":1,"role":"译"}',
    });
    const result = reconcileCreatorsExt(parsed.records, creators);

    assert.deepEqual([...result.bindings.keys()], [1]);
  });

  it("uses row-order fallback only for records without identity or index", function () {
    const parsed = parseCreatorsExt({
      "creators-ext": [
        '{"creatorType":"author","role":"著"}',
        '{"creatorType":"translator","role":"译"}',
      ],
    });
    const result = reconcileCreatorsExt(parsed.records, creators);

    assert.deepEqual([...result.bindings.keys()], [0, 1]);
    assert.equal(result.bindings.get(1)?.role, "译");
  });

  it("passes an empty role string through unchanged", function () {
    const parsed = parseCreatorsExt({
      "creators-ext":
        '{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","role":""}',
    });
    const result = reconcileCreatorsExt(parsed.records, creators);

    assert.deepEqual(result.bindings.get(0), { role: "" });
  });

  it("binds parsed extensions onto the Banyan creator view", function () {
    const item = {
      extra: {
        "creators-ext":
          '{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","index":0,"role":"著","nationality":"英","dynasty":"唐"}',
      },
      // A copy: binding writes onto the creator, and the shared fixture must
      // stay pristine for the other cases.
      creators: [{ ...creators[0] }],
    } as unknown as Item;
    const warnings: string[] = [];

    bindCreatorsExt(item, (message) => warnings.push(message));

    assert.deepEqual(
      {
        role: item.creators[0].role,
        nationality: item.creators[0].nationality,
        dynasty: item.creators[0].dynasty,
      },
      {
        role: "著",
        nationality: "英",
        dynasty: "唐",
      },
    );
    assert.notProperty(item.creators[0], "ext");
    assert.isEmpty(warnings);
  });

  it("reports duplicate identity matches unless index disambiguates them", function () {
    const duplicates: Creator[] = [creators[0], creators[0]];
    const parsed = parseCreatorsExt({
      "creators-ext":
        '{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","index":1,"nationality":"US"}',
    });
    const result = reconcileCreatorsExt(parsed.records, duplicates);

    assert.deepEqual([...result.bindings.keys()], [1]);
    assert.isEmpty(result.issues);
  });

  it("accepts a single-string value and ignores unknown fields", function () {
    const parsed = parseCreatorsExt({
      "creators-ext":
        '{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","role":"著","zhName":"阿达","futureField":1}',
    });

    assert.lengthOf(parsed.records, 1);
    assert.equal(parsed.records[0].record.role, "著");
    assert.isEmpty(parsed.issues);
  });

  it("reads every declared extension field", function () {
    // Guards the field list against drifting from the generated union: a field
    // that is declared but missing from the list would not be read at all.
    for (const field of CREATOR_EXT_FIELDS) {
      const parsed = parseCreatorsExt({
        "creators-ext": `{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","index":0,"${field}":"v"}`,
      });
      assert.lengthOf(parsed.records, 1, `${field} should parse`);
      const result = reconcileCreatorsExt(parsed.records, creators);
      assert.deepEqual(result.bindings.get(0), { [field]: "v" }, field);
    }
  });

  it("does not treat an unknown key as an extension", function () {
    // The window writes the declared fields only: a record has to carry one of
    // them, so an unknown key is not silently kept.
    const parsed = parseCreatorsExt({
      "creators-ext":
        '{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","country":"英"}',
    });

    assert.isEmpty(parsed.records);
    assert.lengthOf(parsed.issues, 1);
  });

  it("rejects records without extensions or with mistyped fields", function () {
    const parsed = parseCreatorsExt({
      "creators-ext": [
        '{"creatorType":"author","firstName":"Ada","lastName":"Lovelace"}',
        '{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","role":"著","index":"0"}',
        '{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","role":"著","fieldMode":2}',
      ],
    });

    assert.isEmpty(parsed.records);
    assert.deepEqual(
      parsed.issues.map(({ lineIndex }) => lineIndex),
      [0, 1, 2],
    );
  });

  it("parses nothing without the key", function () {
    assert.isEmpty(parseCreatorsExt({ status: "draft" }).records);
    assert.isEmpty(parseCreatorsExt(undefined).records);
  });

  it("uses the recorded position only when its creator type matches", function () {
    const parsed = parseCreatorsExt({
      "creators-ext": '{"creatorType":"author","index":0,"role":"著"}',
    });
    const result = reconcileCreatorsExt(parsed.records, [creators[1]]);

    assert.isEmpty(result.bindings);
    assert.deepEqual(result.unmatchedRecordLineIndexes, [0]);
    assert.lengthOf(result.issues, 1);
  });

  it("skips creators that another record already claimed", function () {
    const parsed = parseCreatorsExt({
      "creators-ext": [
        '{"creatorType":"translator","name":"Grace Hopper","role":"译"}',
        '{"creatorType":"author","role":"著"}',
      ],
    });
    const result = reconcileCreatorsExt(parsed.records, creators);

    assert.deepEqual([...result.bindings.keys()], [1, 0]);
    assert.equal(result.bindings.get(0)?.role, "著");
  });

  it("reports an ambiguous identity without touching any creator", function () {
    const duplicates: Creator[] = [creators[0], creators[0]];
    const parsed = parseCreatorsExt({
      "creators-ext":
        '{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","index":2,"role":"著"}',
    });
    const result = reconcileCreatorsExt(parsed.records, duplicates);

    assert.isEmpty(result.bindings);
    assert.match(result.issues[0], /ambiguous/);
    assert.deepEqual(result.unmatchedRecordLineIndexes, [0]);
  });

  it("leaves a creator untouched and does not throw on unreadable data", function () {
    const item = {
      extra: { "creators-ext": ["{bad json", '{"role":12}'] },
      creators: [{ ...creators[0] }],
    } as unknown as Item;
    const warnings: string[] = [];

    assert.doesNotThrow(() => bindCreatorsExt(item, (m) => warnings.push(m)));
    assert.notProperty(item.creators[0], "role");
    assert.notProperty(item.creators[0], "nationality");
    assert.lengthOf(warnings, 2);
  });

  it("logs every record that could not be matched", function () {
    const item = {
      extra: {
        "creators-ext":
          '{"creatorType":"author","firstName":"Ada","lastName":"Nobody","role":"著"}',
      },
      creators: [{ ...creators[0] }],
    } as unknown as Item;
    const warnings: string[] = [];

    bindCreatorsExt(item, (message) => warnings.push(message));

    assert.lengthOf(warnings, 1);
    assert.match(warnings[0], /could not be matched/);
    assert.notProperty(item.creators[0], "role");
  });

  it("binds each record to its own creator", function () {
    const item = {
      extra: {
        "creators-ext": [
          '{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","index":0,"role":"著"}',
          '{"creatorType":"translator","name":"Grace Hopper","index":1,"nationality":"美"}',
        ],
      },
      creators: [{ ...creators[0] }, { ...creators[1] }],
    } as unknown as Item;
    const warnings: string[] = [];

    bindCreatorsExt(item, (message) => warnings.push(message));

    assert.isEmpty(warnings);
    assert.deepEqual(
      item.creators.map(({ role, nationality }) => ({ role, nationality })),
      [
        { role: "著", nationality: undefined },
        { role: undefined, nationality: "美" },
      ],
    );
  });

  /**
   * The public path a style author depends on: the Zotero item is converted
   * once, and the style reads the extensions off the Banyan creator.
   */
  describe("through toBanyanItem", function () {
    let toBanyanItem: (typeof import("../src/modules/sandbox/items"))["toBanyanItem"];

    before(async function () {
      const global = globalThis as Record<string, unknown>;
      global.ztoolkit = { log: () => {}, logError: () => {} };
      global.Zotero = {
        ItemFields: {
          getID: () => false,
          getBaseIDFromTypeAndField: () => false,
          getName: () => "",
        },
        URI: { getItemURI: () => "http://zotero.org/users/local/X/items/KEY1" },
      };
      ({ toBanyanItem } = await import("../src/modules/sandbox/items"));
    });

    after(function () {
      const global = globalThis as Record<string, unknown>;
      delete global.Zotero;
      delete global.ztoolkit;
    });

    it("exposes the stored extension on the Banyan creator", function () {
      const zoteroItem = {
        id: 1,
        firstCreator: "Lovelace",
        deleted: false,
        toJSON: () => ({
          itemType: "book",
          title: "A title",
          extra:
            'Status: draft\ncreators-ext: {"creatorType":"author","firstName":"Ada","lastName":"Lovelace","index":0,"role":"著","nationality":"英","dynasty":"唐"}',
          creators: [
            { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
          ],
        }),
        getField: (field: string) => (field === "year" ? "1843" : ""),
      } as unknown as Zotero.Item;

      const item = toBanyanItem(zoteroItem);

      assert.equal(item.creators[0].role, "著");
      assert.equal(item.creators[0].nationality, "英");
      assert.equal(item.creators[0].dynasty, "唐");
      // The extra map keeps the raw key alongside the other extra fields.
      assert.property(item.extra, "status");
      assert.property(item.extra, "creators-ext");
    });
  });
});
