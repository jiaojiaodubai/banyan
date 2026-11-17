import { assert } from "chai";
import { textCase } from "@banyan/core/units/textCase";

/**
 * Parity guard for the transplanted text-case algorithms.
 *
 * The core carries its own copy (transplanted from Zotero) so that no host can
 * influence casing: the plugin now runs this copy directly, which means this
 * test is also what keeps refactored plugin output identical to the pre-core
 * behaviour. When Zotero changes an algorithm, the two stop matching here and
 * the copy must be realigned.
 */
describe("core text-case parity with Zotero.Utilities", function () {
  const titles = [
    "the war of the worlds",
    "THE WAR OF THE WORLDS",
    "a study of : something",
    "The A B C of things",
    "¿Qué pasa? una prueba",
    "an <i>italic</i> title of sorts",
    "U.S. Taxes and You",
    "the rise of us-vs-them thinking",
    "about the «spread» of ideas",
    "a tale of two cities: the sequel",
    "   an\u00A0indented\u00A0title   ",
    "up and down as far as the eye can see",
    'the <span class="nocase">DNA</span> story',
  ];

  const names = [
    "JOHN",
    "GUTIÉRREZ-ALBILLA",
    "O'NEAL",
    "o'neal",
    "O'neal",
    "John MacGregor O'NEILL",
    "martha McMiddlename WASHINGTON",
    "李",
    "王 小 明",
    "DE LA CRUZ",
    "j.r.r. tolkien",
    "MÜLLER-STRACHWITZ",
  ];

  const sentences = [
    "THE WAR OF THE WORLDS",
    "A STUDY OF THINGS. ANOTHER ONE FOLLOWS",
    "mixed case sentence",
    "The U.S. Taxes Problem. And More",
    "an <i>italic</i> START of sorts",
    "trailing acronym U.S.A. matters",
    "keep nouns like DNA and iPhone 12 intact",
    "first sentence. second one. Third! fourth? Fifth",
  ];

  it("matches capitalizeTitle", function () {
    for (const title of titles) {
      assert.equal(
        textCase.capitalizeTitle(title),
        Zotero.Utilities.capitalizeTitle(title, true),
        `title: ${title}`,
      );
    }
  });

  it("matches capitalizeName", function () {
    for (const name of names) {
      assert.equal(
        textCase.capitalizeName(name),
        Zotero.Utilities.capitalizeName(name),
        `name: ${name}`,
      );
    }
  });

  it("matches sentenceCase", function () {
    for (const sentence of sentences) {
      assert.equal(
        textCase.sentenceCase(sentence),
        Zotero.Utilities.sentenceCase(sentence),
        `sentence: ${sentence}`,
      );
    }
  });
});
