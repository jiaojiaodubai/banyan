import { assert } from "chai";
import {
  buildCreatorsExtWrite,
  carryOverCreatorExtensions,
  hasCreatorListChanged,
  loadCreatorsExt,
  type CreatorsExtDraft,
} from "../src/utils/creatorsExtDraft";
import {
  parseCreatorsExt,
  reconcileCreatorsExt,
} from "@banyan/core/items/creatorsExt";
import { replaceExtraFieldBlock } from "@banyan/core/items/extra";
import type { Creator } from "@banyan/core/types/item";
import type { CreatorSnapshot } from "../typings/multilingualItem";

const CREATORS_EXT_PREFIX = "creators-ext: ";

const draft = (
  overrides: Partial<CreatorsExtDraft> = {},
): CreatorsExtDraft => ({
  creatorType: "author",
  fieldMode: 0,
  firstName: "Ada",
  lastName: "Lovelace",
  role: "",
  nationality: "",
  dynasty: "",
  ...overrides,
});

const snapshot = (
  overrides: Partial<CreatorSnapshot> = {},
): CreatorSnapshot => ({
  creatorTypeID: 8,
  fieldMode: 0,
  firstName: "Ada",
  lastName: "Lovelace",
  ...overrides,
});

/** Record payload of one written line, as the read layer would parse it. */
const recordOf = (line: string): unknown =>
  JSON.parse(line.replace(CREATORS_EXT_PREFIX, ""));

const creators: Creator[] = [
  { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
  { creatorType: "translator", name: "Grace Hopper" },
];

describe("creators-ext window data", function () {
  describe("load path", function () {
    it("binds records and collects the lines that bind to nothing", function () {
      const loaded = loadCreatorsExt(
        [
          "Status: draft",
          'creators-ext: {"creatorType":"author","firstName":"Ada","lastName":"Lovelace","index":0,"role":"著"}',
          "creators-ext: {broken",
          'creators-ext: {"creatorType":"editor","index":1,"role":"编著"}',
        ].join("\n"),
        creators,
      );

      assert.deepEqual([...loaded.bindings.entries()], [[0, { role: "著" }]]);
      assert.deepEqual(loaded.orphanLines, [
        "{broken",
        '{"creatorType":"editor","index":1,"role":"编著"}',
      ]);
      // One parsing problem plus one record that matched no creator.
      assert.lengthOf(loaded.issues, 2);
      assert.match(loaded.issues[0], /^Record 2: /);
      assert.match(loaded.issues[1], /could not be matched/);
    });

    it("treats other extra fields as plain fields, not orphans", function () {
      const loaded = loadCreatorsExt("Status: draft\nGenre: book", creators);

      assert.isEmpty(loaded.bindings);
      assert.isEmpty(loaded.orphanLines);
      assert.isEmpty(loaded.issues);
    });

    it("reads records from an extra field using CRLF or no key at all", function () {
      const loaded = loadCreatorsExt(
        'Status: draft\r\ncreators-ext: {"creatorType":"author","firstName":"Ada","lastName":"Lovelace","role":"著"}\r\n',
        creators,
      );

      assert.deepEqual([...loaded.bindings.entries()], [[0, { role: "著" }]]);
      assert.isEmpty(loadCreatorsExt("", creators).bindings);
    });

    it("keeps a bound record out of the orphan set after a rename", function () {
      const renamed: Creator[] = [
        { creatorType: "author", firstName: "Ada", lastName: "Lovelace-Byron" },
        creators[1],
      ];
      const loaded = loadCreatorsExt(
        'creators-ext: {"creatorType":"author","firstName":"Ada","lastName":"Lovelace","index":0,"role":"著"}',
        renamed,
      );

      assert.deepEqual([...loaded.bindings.entries()], [[0, { role: "著" }]]);
      assert.isEmpty(loaded.orphanLines);
    });
  });

  describe("reload after the creators changed elsewhere", function () {
    const reloaded: Creator[] = [
      { creatorType: "editor", firstName: "Someone", lastName: "New" },
      { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
      { creatorType: "translator", name: "Grace Hopper" },
    ];

    it("moves the entered values onto the reloaded creators", function () {
      const carried = carryOverCreatorExtensions(
        [
          draft({ role: "著", nationality: "英" }),
          draft({ role: "撰", dynasty: "唐" }),
          draft({
            creatorType: "translator",
            fieldMode: 1,
            lastName: "Grace Hopper",
            role: "译注",
          }),
        ],
        reloaded,
      );

      // Ada moved from index 0 to 1, Grace stayed last. The second draft can
      // no longer be identified, so its dynasty is left behind.
      assert.deepEqual(
        [...carried.entries()],
        [
          [1, { nationality: "英", role: "著" }],
          [2, { role: "译注" }],
        ],
      );
    });

    it("leaves values of creators that are gone behind", function () {
      const carried = carryOverCreatorExtensions(
        [
          draft({
            creatorType: "author",
            firstName: "Gone",
            lastName: "Away",
            role: "著",
          }),
        ],
        reloaded,
      );

      assert.isEmpty(carried);
    });

    it("treats a cleared field as cleared rather than refilling it", function () {
      const carried = carryOverCreatorExtensions([draft()], reloaded);

      // The entry exists but carries nothing, so the stored record must not
      // be applied on top of what the user sees.
      assert.deepEqual([...carried.entries()], [[1, {}]]);
    });

    it("does not carry a value to a creator of another type", function () {
      const carried = carryOverCreatorExtensions(
        [
          draft({
            creatorType: "editor",
            firstName: "Ada",
            lastName: "Lovelace",
            role: "编",
          }),
        ],
        reloaded,
      );

      assert.isEmpty(carried);
    });

    it("claims each reloaded creator once", function () {
      const duplicates: Creator[] = [
        { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
        { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
      ];
      const carried = carryOverCreatorExtensions(
        [draft({ role: "著" }), draft({ role: "译" }), draft({ role: "校" })],
        duplicates,
      );

      assert.deepEqual(
        [...carried.entries()],
        [
          [0, { role: "著" }],
          [1, { role: "译" }],
        ],
      );
    });
  });

  describe("save path", function () {
    it("writes the creator list and the extension block together", function () {
      const write = buildCreatorsExtWrite([
        draft({ role: "著", nationality: "英" }),
        draft({
          creatorType: "translator",
          fieldMode: 1,
          lastName: "Grace Hopper",
          role: "译",
        }),
      ]);

      assert.deepEqual(write.creators, [
        { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
        { creatorType: "translator", name: "Grace Hopper" },
      ]);
      assert.deepEqual(recordOf(write.lines[0]), {
        creatorType: "author",
        fieldMode: 0,
        index: 0,
        firstName: "Ada",
        lastName: "Lovelace",
        nationality: "英",
        role: "著",
      });
      assert.deepEqual(recordOf(write.lines[1]), {
        creatorType: "translator",
        fieldMode: 1,
        index: 1,
        name: "Grace Hopper",
        role: "译",
      });
    });

    it("drops empty rows and keeps the remaining indexes aligned", function () {
      const write = buildCreatorsExtWrite([
        draft({ role: "著" }),
        draft({ firstName: "   ", lastName: "  " }),
        draft({
          creatorType: "translator",
          firstName: "Someone",
          lastName: "Else",
          role: "译",
        }),
      ]);

      assert.lengthOf(write.creators, 2);
      assert.lengthOf(write.lines, 2);
      assert.deepEqual(recordOf(write.lines[1]), {
        creatorType: "translator",
        fieldMode: 0,
        index: 1,
        firstName: "Someone",
        lastName: "Else",
        role: "译",
      });
    });

    it("trims values and writes no record for a row without extensions", function () {
      const write = buildCreatorsExtWrite([
        draft({ firstName: " Ada ", lastName: " Lovelace ", role: " 著 " }),
        draft({ creatorType: "translator", firstName: "Grace" }),
      ]);

      assert.deepEqual(write.creators[0], {
        creatorType: "author",
        firstName: "Ada",
        lastName: "Lovelace",
      });
      assert.lengthOf(write.lines, 1);
      assert.deepEqual(recordOf(write.lines[0]), {
        creatorType: "author",
        fieldMode: 0,
        index: 0,
        firstName: "Ada",
        lastName: "Lovelace",
        role: "著",
      });
    });

    it("keeps a single-name creator in one field", function () {
      const write = buildCreatorsExtWrite([
        draft({
          fieldMode: 1,
          firstName: "ignored",
          lastName: " Grace Hopper ",
          nationality: "美",
        }),
      ]);

      assert.deepEqual(write.creators, [
        { creatorType: "author", name: "Grace Hopper" },
      ]);
      assert.deepEqual(recordOf(write.lines[0]), {
        creatorType: "author",
        fieldMode: 1,
        index: 0,
        name: "Grace Hopper",
        nationality: "美",
      });
    });

    it("writes only the rows it can bind, so stale records are cleaned up", function () {
      // Records that bind to nothing are never re-emitted: the load path
      // reports them (for the log) and the save path drops them.
      const extra = [
        "creators-ext: {not json",
        'creators-ext: {"creatorType":"author","lastName":"Gone","nationality":"英"}',
      ].join("\n");
      const loaded = loadCreatorsExt(extra, [
        { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
      ]);
      assert.lengthOf(loaded.orphanLines, 2);

      const write = buildCreatorsExtWrite([draft({ role: "著" })]);
      const rewritten = replaceExtraFieldBlock(
        `${extra}\nStatus: draft`,
        "creators-ext",
        write.lines,
      );

      // Other fields keep their place; the rebuilt block goes last.
      assert.equal(rewritten, `Status: draft\n${write.lines[0]}`);
    });

    it("round-trips what it writes back onto the creators", function () {
      const write = buildCreatorsExtWrite([
        draft({ role: "著", nationality: "英" }),
        draft({
          creatorType: "translator",
          fieldMode: 1,
          lastName: "Grace Hopper",
          role: "译注",
        }),
        draft({
          creatorType: "editor",
          firstName: "F",
          lastName: "He",
          role: "编著",
          dynasty: "唐",
        }),
      ]);

      const parsed = parseCreatorsExt({
        "creators-ext": write.lines.map((line) =>
          line.replace(CREATORS_EXT_PREFIX, ""),
        ),
      });
      assert.isEmpty(parsed.issues);

      const result = reconcileCreatorsExt(
        parsed.records,
        write.creators as unknown as Creator[],
      );
      assert.deepEqual(result.issues, []);
      assert.deepEqual(
        [...result.bindings.entries()],
        [
          [0, { role: "著", nationality: "英" }],
          [1, { role: "译注" }],
          [2, { role: "编著", dynasty: "唐" }],
        ],
      );
      assert.isEmpty(result.unmatchedRecordLineIndexes);
    });

    it("appends the rebuilt block without disturbing other extra fields", function () {
      const write = buildCreatorsExtWrite([draft({ role: "著" })]);
      const extra = replaceExtraFieldBlock(
        'Status: draft\ncreators-ext: {"role":"old"}\nGenre: book',
        "creators-ext",
        write.lines,
      );

      assert.equal(extra, `Status: draft\nGenre: book\n${write.lines[0]}`);
    });

    it("detects same-length creator edits", function () {
      const before = [snapshot()];

      assert.isFalse(hasCreatorListChanged(before, [snapshot()]));
      assert.isTrue(
        hasCreatorListChanged(before, [snapshot({ lastName: "B" })]),
      );
      assert.isTrue(
        hasCreatorListChanged(before, [snapshot({ firstName: "" })]),
      );
      assert.isTrue(
        hasCreatorListChanged(before, [snapshot({ creatorTypeID: 9 })]),
      );
      assert.isTrue(
        hasCreatorListChanged(before, [snapshot({ fieldMode: 1 })]),
      );
    });

    it("detects a reordered or resized creator list", function () {
      const before = [
        snapshot(),
        snapshot({ creatorTypeID: 9, firstName: "Grace", lastName: "Hopper" }),
      ];

      assert.isFalse(hasCreatorListChanged(before, [...before]));
      assert.isTrue(hasCreatorListChanged(before, [before[1], before[0]]));
      assert.isTrue(hasCreatorListChanged(before, [before[0]]));
      assert.isTrue(hasCreatorListChanged([], [before[0]]));
    });
  });
});
