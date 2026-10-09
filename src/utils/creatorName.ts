/**
 * Switching a creator name between Zotero's two storage modes, shared by the
 * "Extend Creator Information" and multilingual-item windows. `itemBox` splits
 * at the last space, which is Western order; CJK names read the other way round
 * and are usually written without a space.
 */

export type CreatorName = {
  /** 0 = separate last/first name, 1 = a single field. */
  fieldMode: 0 | 1;
  firstName: string;
  lastName: string;
};

/**
 * Two-character surnames, which must not be split after their first character
 * (欧阳修 → 欧阳 + 修): Chinese compound surnames plus common Japanese family
 * names. A heuristic only — a name it misses can be corrected in the fields.
 */
const TWO_CHARACTER_SURNAMES = new Set([
  // Chinese compound surnames
  "欧阳",
  "太史",
  "端木",
  "上官",
  "司马",
  "东方",
  "独孤",
  "南宫",
  "万俟",
  "闻人",
  "夏侯",
  "诸葛",
  "尉迟",
  "公羊",
  "赫连",
  "澹台",
  "皇甫",
  "宗政",
  "濮阳",
  "公冶",
  "太叔",
  "申屠",
  "公孙",
  "慕容",
  "仲孙",
  "钟离",
  "长孙",
  "宇文",
  "司徒",
  "鲜于",
  "司空",
  "闾丘",
  "子车",
  "亓官",
  "司寇",
  "巫马",
  "公西",
  "颛孙",
  "壤驷",
  "公良",
  "漆雕",
  "乐正",
  "宰父",
  "谷梁",
  "拓跋",
  "夹谷",
  "轩辕",
  "令狐",
  "段干",
  "百里",
  "呼延",
  "东郭",
  "南门",
  "羊舌",
  "微生",
  "梁丘",
  "左丘",
  "东门",
  "西门",
  // Common Japanese family names
  "佐藤",
  "铃木",
  "鈴木",
  "高桥",
  "高橋",
  "田中",
  "渡边",
  "渡邊",
  "伊藤",
  "小林",
  "中村",
  "加藤",
  "吉田",
  "山本",
  "松本",
  "井上",
  "木村",
  "清水",
  "山口",
  "池田",
  "桥本",
  "橋本",
  "石川",
  "前田",
  "藤田",
  "小川",
  "冈田",
  "岡田",
  "后藤",
  "後藤",
  "村上",
  "石井",
  "斋藤",
  "斎藤",
  "坂本",
  "远藤",
  "遠藤",
  "青木",
  "藤井",
  "西村",
  "福田",
  "太田",
  "三浦",
  "冈本",
  "岡本",
  "松田",
  "中川",
  "中野",
  "原田",
  "小野",
  "竹内",
  "田村",
  "金子",
  "和田",
  "中山",
  "石田",
  "上田",
  "山田",
  "中岛",
  "中島",
  "涩谷",
  "渋谷",
]);

/** CJK ideographs plus kana and hangul; the katakana middle dot acts as a separator. */
const CJK_PATTERN =
  /^[\u2E80-\u2EFF\u3040-\u30FA\u30FC-\u30FF\u31C0-\u31EF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF66-\uFF9F\uAC00-\uD7AF]+$/;

/** Separators written inside a transliterated name ("科林·斯科特"). */
const INNER_SEPARATOR_PATTERN = /[\u00B7\u2022\u2027.\uFF0E\u30FB\uFF65]/;

export function isCjkName(value: string): boolean {
  return CJK_PATTERN.test(value.trim());
}

/** One character, or two that are a known surname ("斯科特" is not one). */
function isSurnameRun(value: string): boolean {
  const text = value.trim();
  if (!isCjkName(text) || INNER_SEPARATOR_PATTERN.test(text)) {
    return false;
  }
  return text.length === 1 || TWO_CHARACTER_SURNAMES.has(text);
}

/**
 * How many leading characters of a whole CJK name form its surname, or 0 when
 * nothing can be split off.
 */
function leadingSurnameLength(value: string): number {
  const text = value.trim();
  if (!isCjkName(text) || INNER_SEPARATOR_PATTERN.test(text)) {
    return 0;
  }
  if (text.length < 3) {
    return 0;
  }
  return TWO_CHARACTER_SURNAMES.has(text.slice(0, 2)) ? 2 : 1;
}

/**
 * Split a single-field name into parts: a comma is Zotero's "Last, First"
 * form, an interpunct means reading order, CJK text is surname-first, and
 * anything else keeps `itemBox`'s "last word is the last name" rule.
 */
function splitSingleFieldName(value: string): CreatorName {
  const trimmed = value.trim();

  const comma = trimmed.indexOf(",");
  if (comma > 0) {
    return {
      fieldMode: 0,
      firstName: trimmed.slice(comma + 1).trim(),
      lastName: trimmed.slice(0, comma).trim(),
    };
  }

  const separated = trimmed.split(INNER_SEPARATOR_PATTERN);
  if (separated.length === 2 && separated.every(isCjkName)) {
    return { fieldMode: 0, firstName: separated[0], lastName: separated[1] };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    // "李 延寿" / "山田 太郎": every word is CJK and the first is a surname.
    if (isSurnameRun(words[0]) && isCjkName(words.slice(1).join(""))) {
      return {
        fieldMode: 0,
        firstName: words.slice(1).join(" "),
        lastName: words[0],
      };
    }
    // Western reading order: the last word is the last name.
    return {
      fieldMode: 0,
      firstName: words.slice(0, -1).join(" "),
      lastName: words[words.length - 1],
    };
  }

  const surnameLength = words.length ? leadingSurnameLength(words[0]) : 0;
  if (surnameLength > 0) {
    return {
      fieldMode: 0,
      firstName: words[0].slice(surnameLength),
      lastName: words[0].slice(0, surnameLength),
    };
  }

  return { fieldMode: 0, firstName: "", lastName: trimmed };
}

/** A CJK run of three or more characters, i.e. a transliterated name part. */
function isTransliteratedRun(value: string): boolean {
  return isCjkName(value) && Array.from(value).length >= 3;
}

/**
 * Join the parts the way the name is read: a CJK surname first and unspaced
 * ("李延寿"), a transliterated pair in reading order with the interpunct used in
 * Chinese bibliographies ("科林·斯科特"), otherwise `itemBox`'s "First Last".
 *
 * A surname the list knows always comes first; an unknown one of one or two
 * characters is still read as a Han surname ("南宮清"), and only a long run is
 * taken as a transliteration ("弗兰西斯·培根").
 */
function joinNameParts(firstName: string, lastName: string): string {
  const first = firstName.trim();
  const last = lastName.trim();
  if (!first) {
    return last;
  }
  if (!last) {
    return first;
  }
  if (isSurnameRun(last)) {
    return `${last}${first}`;
  }
  if (isCjkName(first) && isCjkName(last)) {
    return isTransliteratedRun(last) || isTransliteratedRun(first)
      ? `${first}\u00B7${last}`
      : `${last}${first}`;
  }
  return `${first} ${last}`;
}

/**
 * Change how a creator's name is stored, keeping the text the user sees.
 * Mirrors `itemBox.switchCreatorMode()`, with the CJK reading added.
 */
export function switchCreatorNameMode(
  name: CreatorName,
  fieldMode: 0 | 1,
): CreatorName {
  if (fieldMode === name.fieldMode) {
    return { ...name };
  }
  if (fieldMode === 1) {
    return {
      fieldMode: 1,
      firstName: "",
      lastName: joinNameParts(name.firstName, name.lastName),
    };
  }
  return splitSingleFieldName(name.lastName);
}
