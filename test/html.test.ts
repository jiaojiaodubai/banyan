import { assert } from "chai";
import {
  escapeAttribute,
  escapeHtml,
  parseBanyanEntryLink,
  sanitizeLink,
} from "../src/utils/html";
import type { RichText } from "../typings/unit";

import { renderRichTextToHtml as renderRichTextVisualToHtml } from "../src/utils/richTextHtml";

describe("html utilities", function () {
  it("escapes text and attribute-sensitive characters", function () {
    assert.equal(
      escapeHtml(`<a title="x">Tom & Jerry's</a>`),
      "&lt;a title=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
    );
    assert.equal(
      escapeAttribute(`https://example.test/?q="x"&v='y'`),
      "https://example.test/?q=&quot;x&quot;&amp;v=&#39;y&#39;",
    );
  });

  it("allows only supported link protocols", function () {
    assert.equal(
      sanitizeLink(" https://example.test/a "),
      "https://example.test/a",
    );
    assert.equal(
      sanitizeLink("http://example.test/a"),
      "http://example.test/a",
    );
    assert.equal(sanitizeLink("doi:10.1000/xyz123"), "doi:10.1000/xyz123");
    assert.equal(
      sanitizeLink("banyan://entry/abc-123"),
      "banyan://entry/abc-123",
    );

    assert.isUndefined(sanitizeLink("javascript:alert(1)"));
    assert.isUndefined(sanitizeLink("data:text/html,<script></script>"));
    assert.isUndefined(sanitizeLink("file:///C:/secret.txt"));
    assert.isUndefined(sanitizeLink("//example.test/path"));
    assert.isUndefined(sanitizeLink(""));
    assert.isUndefined(sanitizeLink(null));
  });

  it("accepts only entry-scoped banyan links", function () {
    assert.equal(parseBanyanEntryLink("banyan://entry/item%201"), "item 1");
    assert.isUndefined(sanitizeLink("banyan://settings"));
    assert.isUndefined(sanitizeLink("banyan://entry/abc?open=true"));
  });

  it("renders non-interactive rich text previews without links while preserving superscript", function () {
    const richText: RichText = {
      text: "[3]",
      marks: [
        { type: "script", start: 0, end: 3, value: "superscript" },
        { type: "link", start: 0, end: 3, value: "https://example.test" },
      ],
    };

    assert.equal(
      renderRichTextVisualToHtml(richText, { includeLinks: false }),
      "<sup>[3]</sup>",
    );
    assert.equal(
      renderRichTextVisualToHtml(richText),
      '<a href="https://example.test"><sup>[3]</sup></a>',
    );
  });
});
