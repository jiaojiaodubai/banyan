import { assert } from "chai";
import {
  isCjkName,
  switchCreatorNameMode,
  type CreatorName,
} from "../src/utils/creatorName";

/** Merge two parts into the single-field form. */
const merge = (firstName: string, lastName: string): CreatorName =>
  switchCreatorNameMode({ fieldMode: 0, firstName, lastName }, 1);

/** Split a single-field name into the two-field form. */
const split = (name: string): CreatorName =>
  switchCreatorNameMode({ fieldMode: 1, firstName: "", lastName: name }, 0);

describe("creator name mode switching", function () {
  it("mirrors itemBox for Western names", function () {
    assert.deepEqual(merge("Dejan", "Iliev"), {
      fieldMode: 1,
      firstName: "",
      lastName: "Dejan Iliev",
    });
    assert.deepEqual(split("Dejan Iliev"), {
      fieldMode: 0,
      firstName: "Dejan",
      lastName: "Iliev",
    });
    // All but the last word becomes the first name, as itemBox does.
    assert.deepEqual(split("Ludwig van Beethoven"), {
      fieldMode: 0,
      firstName: "Ludwig van",
      lastName: "Beethoven",
    });
  });

  it("keeps a single name that has nothing to split on", function () {
    assert.deepEqual(split("Cher"), {
      fieldMode: 0,
      firstName: "",
      lastName: "Cher",
    });
    assert.deepEqual(merge("", "洪卓民"), {
      fieldMode: 1,
      firstName: "",
      lastName: "洪卓民",
    });
  });

  it("recognises CJK text", function () {
    assert.isTrue(isCjkName("李延寿"));
    assert.isTrue(isCjkName("金玟庭"));
    assert.isTrue(isCjkName("山田太郎"));
    assert.isTrue(isCjkName(" 洪卓民 "));
    assert.isFalse(isCjkName("Iliev"));
    assert.isFalse(isCjkName("科林·斯科特"));
    assert.isFalse(isCjkName(""));
  });

  it("splits a CJK name after the surname", function () {
    assert.deepEqual(split("李延寿"), {
      fieldMode: 0,
      firstName: "延寿",
      lastName: "李",
    });
    assert.deepEqual(split("洪卓民"), {
      fieldMode: 0,
      firstName: "卓民",
      lastName: "洪",
    });
    assert.deepEqual(split("金玟庭"), {
      fieldMode: 0,
      firstName: "玟庭",
      lastName: "金",
    });
  });

  it("keeps a two-character run whole when it is not a known surname", function () {
    // Nothing to split off, and a two-character run may be a transliterated
    // family name, so it stays whole.
    assert.deepEqual(split("布什"), {
      fieldMode: 0,
      firstName: "",
      lastName: "布什",
    });
    // A known surname plus a given name does split.
    assert.deepEqual(split("欧阳修"), {
      fieldMode: 0,
      firstName: "修",
      lastName: "欧阳",
    });
    assert.deepEqual(split("司马光"), {
      fieldMode: 0,
      firstName: "光",
      lastName: "司马",
    });
    // An unlisted leading pair is not assumed to be a surname.
    assert.deepEqual(split("端方林"), {
      fieldMode: 0,
      firstName: "方林",
      lastName: "端",
    });
  });

  it("merges a CJK name without a space, surname first", function () {
    assert.deepEqual(merge("延寿", "李"), {
      fieldMode: 1,
      firstName: "",
      lastName: "李延寿",
    });
    assert.deepEqual(merge("修", "欧阳"), {
      fieldMode: 1,
      firstName: "",
      lastName: "欧阳修",
    });
  });

  it("reads an unlisted compound surname in the Chinese order", function () {
    // 南宮 (traditional) and 歐陽 are not in the surname list, but a two-
    // character CJK surname is still written before the given name.
    assert.deepEqual(merge("清", "南宮"), {
      fieldMode: 1,
      firstName: "",
      lastName: "南宮清",
    });
    assert.deepEqual(merge("修", "歐陽"), {
      fieldMode: 1,
      firstName: "",
      lastName: "歐陽修",
    });
    assert.deepEqual(merge("文华", "南宮"), {
      fieldMode: 1,
      firstName: "",
      lastName: "南宮文华",
    });
  });

  it("keeps a known surname first even with a long given name", function () {
    // The list decides for names it knows: 美咲子 is three characters, but
    // 山田 is a Japanese surname, not a transliteration.
    assert.deepEqual(merge("美咲子", "山田"), {
      fieldMode: 1,
      firstName: "",
      lastName: "山田美咲子",
    });
  });

  it("takes a long unlisted surname, or a long given name, as a transliteration", function () {
    assert.deepEqual(merge("弗兰西斯", "培根"), {
      fieldMode: 1,
      firstName: "",
      lastName: "弗兰西斯·培根",
    });
    assert.deepEqual(merge("伊曼努尔", "康德"), {
      fieldMode: 1,
      firstName: "",
      lastName: "伊曼努尔·康德",
    });
  });

  it("keeps the Western reading for a transliterated name", function () {
    // 斯科特 is three characters, so it is a transliterated surname, not a
    // Chinese one: the parts keep their reading order.
    assert.deepEqual(merge("科林", "斯科特"), {
      fieldMode: 1,
      firstName: "",
      lastName: "科林·斯科特",
    });
    assert.deepEqual(split("科林 斯科特"), {
      fieldMode: 0,
      firstName: "科林",
      lastName: "斯科特",
    });
    assert.deepEqual(split("科林·斯科特"), {
      fieldMode: 0,
      firstName: "科林",
      lastName: "斯科特",
    });
  });

  it("reads a spaced CJK name as surname first", function () {
    assert.deepEqual(split("李 延寿"), {
      fieldMode: 0,
      firstName: "延寿",
      lastName: "李",
    });
    assert.deepEqual(split("山田 太郎"), {
      fieldMode: 0,
      firstName: "太郎",
      lastName: "山田",
    });
    // A three-character leading word is not a surname: Western order applies.
    assert.deepEqual(split("格雷 斯科特"), {
      fieldMode: 0,
      firstName: "格雷",
      lastName: "斯科特",
    });
    // A CJK surname followed by a non-CJK word is not a CJK name either.
    assert.deepEqual(split("李 Smith"), {
      fieldMode: 0,
      firstName: "李",
      lastName: "Smith",
    });
  });

  it("reads a Japanese name as surname first", function () {
    assert.deepEqual(split("山田太郎"), {
      fieldMode: 0,
      firstName: "太郎",
      lastName: "山田",
    });
    assert.deepEqual(merge("太郎", "山田"), {
      fieldMode: 1,
      firstName: "",
      lastName: "山田太郎",
    });
  });

  it("reads Zotero's comma form as 'last, first'", function () {
    assert.deepEqual(split("Iliev, Dejan"), {
      fieldMode: 0,
      firstName: "Dejan",
      lastName: "Iliev",
    });
    assert.deepEqual(split("李, 延寿"), {
      fieldMode: 0,
      firstName: "延寿",
      lastName: "李",
    });
    assert.deepEqual(split("Iliev,"), {
      fieldMode: 0,
      firstName: "",
      lastName: "Iliev",
    });
  });

  it("returns a copy when the name is already in the requested mode", function () {
    const name = { fieldMode: 0 as const, firstName: "A", lastName: "B" };
    const same = switchCreatorNameMode(name, 0);

    assert.deepEqual(same, name);
    assert.notStrictEqual(same, name);
  });
});
